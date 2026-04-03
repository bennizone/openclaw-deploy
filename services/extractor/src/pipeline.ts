import { config, log } from './config.js';
import type { Turn } from './parser.js';
import { buildWindow } from './window.js';
import { extractFacts } from './extractor.js';
import { extractBehavior, cleanWindowForBehavior } from './behavior-extractor.js';
import { embed } from './embedder.js';
import { checkDuplicate, upsertFact, collectionName, searchSimilar, targetInstructionCollections, type FactPayload } from './qdrant.js';
import { setOffset, logProcessing } from './offset.js';
import { validateFact } from './validator.js';
import { verifyFactMiniMax, verifyBehaviorMiniMax } from './verifier.js';

function targetCollections(agentId: string, scope: string): string[] {
  return scope === 'household'
    ? [collectionName('household')]
    : [collectionName(agentId)];
}

function searchCollections(agentId: string): string[] {
  return agentId === 'household'
    ? [collectionName('household')]
    : [collectionName(agentId), collectionName('household')];
}

/**
 * Process a single turn through the extraction pipeline:
 * 1. Embed turn text, fetch known facts from Qdrant (parallel across collections)
 * 2. Extract facts (MiniMax, user-only prompt, known-facts-aware)
 * 3. Per candidate: validate → verify (MiniMax) → embed → dedup → write
 */
export async function processTurn(
  turns: Turn[],
  index: number,
  filePath: string,
  byteOffset: number,
): Promise<{ extracted: number; written: number; skipped: number }> {
  const turn = turns[index];
  const window = buildWindow(turns, index);
  window.agentDisplayName = config.agentNames[turn.agentId] ?? turn.agentId;

  let extracted = 0;
  let written = 0;
  let skipped = 0;
  let validatorRejected = 0;
  let verifierRejected = 0;
  let semanticDupes = 0;
  let behaviorExtracted = 0;
  let behaviorWritten = 0;
  let behaviorVerifierRejected = 0;
  let behaviorSemanticDupes = 0;

  try {
    // Step 1: Embed turn text and fetch known facts (parallel across collections)
    const knownFactsSet = new Set<string>();
    const turnText = `${turn.userText} ${turn.assistantText}`.slice(0, 500);
    try {
      const turnEmbed = await embed(turnText);
      const collections = searchCollections(turn.agentId);

      const results = await Promise.all(
        collections.map(coll =>
          searchSimilar(coll, turnEmbed.vector, config.knownFactsLimit, config.knownFactsScoreThreshold)
            .catch((err) => { log('debug', 'pipeline', `Known facts search failed for ${coll}: ${(err as Error).message}`); return []; })
        )
      );
      for (const hits of results) {
        for (const s of hits) {
          knownFactsSet.add(s.fact);
        }
      }
    } catch (err) {
      log('debug', 'pipeline', `Known facts lookup failed: ${(err as Error).message}`);
    }
    window.knownFacts = [...knownFactsSet];

    if (knownFactsSet.size > 0) {
      log('debug', 'pipeline', `Turn ${turn.turnIndex}: ${knownFactsSet.size} known facts found`);
    }

    // Step 2: Extract facts
    const facts = await extractFacts(window);
    extracted = facts.length;

    if (facts.length > 0) {
      log('info', 'pipeline', `Turn ${turn.turnIndex}: ${facts.length} candidates extracted`);
    }

    for (const fact of facts) {
      // Step 3a: Validate (length, confidence)
      const validation = validateFact(fact);
      if (!validation.valid) {
        validatorRejected++;
        log('debug', 'pipeline', `Validator rejected: "${fact.fact.slice(0, 50)}" (${validation.reason})`);
        continue;
      }

      // Step 3b: Verify with MiniMax
      const verification = await verifyFactMiniMax(fact.fact, window);
      if (!verification.verified) {
        verifierRejected++;
        log('info', 'pipeline', `Verifier rejected: "${fact.fact.slice(0, 50)}" (${verification.reason})`);
        continue;
      }

      // Step 3c: Embed the fact
      let embeddingResult;
      try {
        embeddingResult = await embed(fact.fact);
      } catch (err) {
        log('warn', 'pipeline', `Embedding failed for fact "${fact.fact.slice(0, 40)}...": ${(err as Error).message}`);
        continue;
      }

      // Step 3d: Write to target collection(s)
      const targets = targetCollections(turn.agentId, fact.scope ?? 'personal');

      for (const collection of targets) {
        // Exact dedup + semantic dedup in parallel
        const [isDup, similarFacts] = await Promise.all([
          checkDuplicate(collection, turn.sessionId, turn.turnIndex, fact.fact),
          searchSimilar(collection, embeddingResult.vector, 3, config.semanticDedupThreshold)
            .catch((err) => { log('warn', 'pipeline', `Semantic dedup search failed: ${(err as Error).message}`); return []; }),
        ]);

        if (isDup) {
          skipped++;
          log('debug', 'pipeline', `Exact duplicate skipped in ${collection}`);
          continue;
        }

        if (similarFacts.length > 0) {
          semanticDupes++;
          log('info', 'pipeline', `Semantic duplicate skipped (score ${similarFacts[0].score.toFixed(3)}): "${fact.fact.slice(0, 50)}" ≈ "${similarFacts[0].fact.slice(0, 50)}"`);
          continue;
        }

        const payload: FactPayload = {
          fact: fact.fact,
          type: fact.type,
          confidence: fact.confidence,
          sourceContext: fact.sourceContext,
          agentId: turn.agentId,
          sessionId: turn.sessionId,
          turnIndex: turn.turnIndex,
          timestamp: turn.timestamp,
          extractedAt: new Date().toISOString(),
          embeddingSource: embeddingResult.source,
        };

        if (fact.scope === 'household') {
          payload.scope = 'household';
        }

        await upsertFact(collection, { vector: embeddingResult.vector, payload });
        written++;
        log('info', 'pipeline', `Written to ${collection}: [${fact.scope}/${fact.type}] ${fact.fact.slice(0, 60)}`);
      }
    }

    // --- Pass 2: Behavior Extraction ---
    try {
      const cleanedWindow = cleanWindowForBehavior(window);
      const behaviors = await extractBehavior(cleanedWindow);
      behaviorExtracted = behaviors.length;

      if (behaviors.length > 0) {
        log('info', 'pipeline', `Turn ${turn.turnIndex}: ${behaviors.length} behavior candidates`);
      }

      for (const behavior of behaviors) {
        // Validate
        if (behavior.instruction.length < 5 || behavior.instruction.length > 500) continue;
        if (behavior.confidence < 0.7) continue;

        // Verify
        const verification = await verifyBehaviorMiniMax(
          behavior.instruction,
          behavior.sourceContext,
          cleanedWindow,
        );
        if (!verification.verified) {
          behaviorVerifierRejected++;
          log('info', 'pipeline', `Behavior rejected: "${behavior.instruction.slice(0, 50)}" (${verification.reason})`);
          continue;
        }

        // Embed
        let embeddingResult;
        try {
          embeddingResult = await embed(behavior.instruction);
        } catch (err) {
          log('warn', 'pipeline', `Behavior embedding failed: ${(err as Error).message}`);
          continue;
        }

        // Target collections
        const targets = targetInstructionCollections(turn.agentId, behavior.scope ?? 'personal');

        for (const collection of targets) {
          // Dedup (exact + semantic in parallel)
          const [isDup, similarFacts] = await Promise.all([
            checkDuplicate(collection, turn.sessionId, turn.turnIndex, behavior.instruction),
            searchSimilar(collection, embeddingResult.vector, 3, config.semanticDedupThreshold)
              .catch((err) => { log('warn', 'pipeline', `Behavior dedup failed: ${(err as Error).message}`); return []; }),
          ]);

          if (isDup) {
            behaviorSemanticDupes++;
            continue;
          }

          if (similarFacts.length > 0) {
            behaviorSemanticDupes++;
            log('info', 'pipeline', `Behavior semantic dupe (${similarFacts[0].score.toFixed(3)}): "${behavior.instruction.slice(0, 50)}"`);
            continue;
          }

          // Upsert
          const payload: FactPayload = {
            fact: behavior.instruction,
            type: 'behavior',
            confidence: behavior.confidence,
            sourceContext: behavior.sourceContext,
            agentId: turn.agentId,
            sessionId: turn.sessionId,
            turnIndex: turn.turnIndex,
            timestamp: turn.timestamp,
            extractedAt: new Date().toISOString(),
            embeddingSource: embeddingResult.source,
            scope: behavior.scope ?? 'personal',
          };

          await upsertFact(collection, { vector: embeddingResult.vector, payload });
          behaviorWritten++;
          log('info', 'pipeline', `Behavior written to ${collection}: ${behavior.instruction.slice(0, 60)}`);
        }
      }
    } catch (err) {
      log('warn', 'pipeline', `Behavior pass failed (non-fatal): ${(err as Error).message}`);
    }

    setOffset(filePath, byteOffset, turn.turnIndex);
    logProcessing({ filePath, turnIndex: turn.turnIndex, factsExtracted: extracted, factsWritten: written, skippedDup: skipped, validatorRejected, verifierRejected, semanticDupes, behaviorExtracted, behaviorWritten, behaviorVerifierRejected, behaviorSemanticDupes });

  } catch (err) {
    const msg = (err as Error).message;
    log('error', 'pipeline', `Turn ${turn.turnIndex} in ${filePath}: ${msg}`);
    logProcessing({ filePath, turnIndex: turn.turnIndex, factsExtracted: extracted, factsWritten: written, skippedDup: skipped, validatorRejected, verifierRejected, semanticDupes, behaviorExtracted, behaviorWritten, behaviorVerifierRejected, behaviorSemanticDupes, error: msg });
  }

  return { extracted, written, skipped };
}
