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
import { batchExtractFacts, batchExtractBehavior, batchVerifyFacts, batchVerifyBehaviors } from './batch.js';
import { extractAndVerify } from './lib/sdk-extractor.js';

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
 * Process a single turn using the Claude Agent SDK (EXTRACTOR_ENGINE=sdk).
 * 1 SDK call per turn: combined fact + behavior extraction with inline verification.
 * Falls back to legacy processTurn() on SDK failure.
 */
async function processTurnSdk(
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
  let semanticDupes = 0;
  let behaviorWritten = 0;
  let behaviorSemanticDupes = 0;

  try {
    // Step 1: Known facts lookup (same as legacy)
    const knownFactsSet = new Set<string>();
    const turnText = `${turn.userText} ${turn.assistantText}`.slice(0, 500);
    try {
      const turnEmbed = await embed(turnText);
      const collections = searchCollections(turn.agentId);
      const results = await Promise.all(
        collections.map(coll =>
          searchSimilar(coll, turnEmbed.vector, config.knownFactsLimit, config.knownFactsScoreThreshold)
            .catch((err) => { log('debug', 'pipeline-sdk', `Known facts search failed for ${coll}: ${(err as Error).message}`); return []; })
        )
      );
      for (const hits of results) {
        for (const s of hits) knownFactsSet.add(s.fact);
      }
    } catch (err) {
      log('debug', 'pipeline-sdk', `Known facts lookup failed: ${(err as Error).message}`);
    }
    window.knownFacts = [...knownFactsSet];

    if (knownFactsSet.size > 0) {
      log('debug', 'pipeline-sdk', `Turn ${turn.turnIndex}: ${knownFactsSet.size} known facts`);
    }

    // Step 2: SDK extraction — 1 call for facts + behaviors with inline verification
    const { facts, behaviors } = await extractAndVerify(window);
    extracted = facts.length;

    if (facts.length > 0) {
      log('info', 'pipeline-sdk', `Turn ${turn.turnIndex}: ${facts.length} fact candidates`);
    }

    // Step 3: Facts — validate → embed → dedup → write
    for (const fact of facts) {
      const validation = validateFact(fact);
      if (!validation.valid) {
        log('debug', 'pipeline-sdk', `Validator rejected: "${fact.fact.slice(0, 50)}" (${validation.reason})`);
        continue;
      }

      let embeddingResult;
      try {
        embeddingResult = await embed(fact.fact);
      } catch (err) {
        log('warn', 'pipeline-sdk', `Embedding failed for "${fact.fact.slice(0, 40)}": ${(err as Error).message}`);
        continue;
      }

      const targets = targetCollections(turn.agentId, fact.scope ?? 'personal');
      for (const collection of targets) {
        const [isDup, similarFacts] = await Promise.all([
          checkDuplicate(collection, turn.sessionId, turn.turnIndex, fact.fact),
          searchSimilar(collection, embeddingResult.vector, 3, config.semanticDedupThreshold)
            .catch((err) => { log('warn', 'pipeline-sdk', `Semantic dedup failed: ${(err as Error).message}`); return []; }),
        ]);

        if (isDup) {
          skipped++;
          log('debug', 'pipeline-sdk', `Exact duplicate skipped in ${collection}`);
          continue;
        }

        if (similarFacts.length > 0) {
          semanticDupes++;
          log('info', 'pipeline-sdk', `Semantic dupe (${similarFacts[0].score.toFixed(3)}): "${fact.fact.slice(0, 50)}" ≈ "${similarFacts[0].fact.slice(0, 50)}"`);
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
        if (fact.scope === 'household') payload.scope = 'household';

        await upsertFact(collection, { vector: embeddingResult.vector, payload });
        written++;
        log('info', 'pipeline-sdk', `Written to ${collection}: [${fact.scope}/${fact.type}] ${fact.fact.slice(0, 60)}`);
      }
    }

    // Step 4: Behaviors — validate → embed → dedup → write
    if (behaviors.length > 0) {
      log('info', 'pipeline-sdk', `Turn ${turn.turnIndex}: ${behaviors.length} behavior candidates`);
    }

    for (const behavior of behaviors) {
      if (behavior.instruction.length < 5 || behavior.instruction.length > 500) continue;
      if (behavior.confidence < 0.7) continue;

      let embeddingResult;
      try {
        embeddingResult = await embed(behavior.instruction);
      } catch (err) {
        log('warn', 'pipeline-sdk', `Behavior embedding failed: ${(err as Error).message}`);
        continue;
      }

      const targets = targetInstructionCollections(turn.agentId, behavior.scope ?? 'personal');
      for (const collection of targets) {
        const [isDup, similarFacts] = await Promise.all([
          checkDuplicate(collection, turn.sessionId, turn.turnIndex, behavior.instruction),
          searchSimilar(collection, embeddingResult.vector, 3, config.semanticDedupThreshold)
            .catch((err) => { log('warn', 'pipeline-sdk', `Behavior dedup failed: ${(err as Error).message}`); return []; }),
        ]);

        if (isDup) {
          behaviorSemanticDupes++;
          continue;
        }

        if (similarFacts.length > 0) {
          behaviorSemanticDupes++;
          log('info', 'pipeline-sdk', `Behavior semantic dupe (${similarFacts[0].score.toFixed(3)}): "${behavior.instruction.slice(0, 50)}"`);
          continue;
        }

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
        log('info', 'pipeline-sdk', `Behavior written to ${collection}: ${behavior.instruction.slice(0, 60)}`);
      }
    }

    setOffset(filePath, byteOffset, turn.turnIndex);
    logProcessing({
      filePath,
      turnIndex: turn.turnIndex,
      factsExtracted: extracted,
      factsWritten: written,
      skippedDup: skipped,
      semanticDupes,
      behaviorExtracted: behaviors.length,
      behaviorWritten,
      behaviorSemanticDupes,
    });

  } catch (err) {
    const msg = (err as Error).message;
    log('warn', 'pipeline-sdk', `SDK failed for turn ${turn.turnIndex}, falling back to legacy: ${msg}`);
    return processTurn(turns, index, filePath, byteOffset);
  }

  return { extracted, written, skipped };
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
  if (config.extractorEngine === 'sdk') {
    return processTurnSdk(turns, index, filePath, byteOffset);
  }
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

/**
 * Process a batch of turns through the extraction pipeline.
 * Uses batch MiniMax calls: 1 request for N turns extraction + 1 for verification.
 * Falls back to single-turn processing if batch parsing fails.
 */
export async function processTurnBatch(
  turns: Turn[],
  startIndex: number,
  count: number,
  filePath: string,
  byteOffset: number,
): Promise<{ extracted: number; written: number; skipped: number }> {
  const endIndex = Math.min(startIndex + count, turns.length);
  const batchTurns = turns.slice(startIndex, endIndex);

  if (batchTurns.length === 0) return { extracted: 0, written: 0, skipped: 0 };
  if (batchTurns.length === 1) return processTurn(turns, startIndex, filePath, byteOffset);

  log('info', 'batch', `Processing batch of ${batchTurns.length} turns (${startIndex}-${endIndex - 1})`);

  // Build windows for all turns in the batch
  const windows = batchTurns.map((_, i) => {
    const window = buildWindow(turns, startIndex + i);
    const turn = turns[startIndex + i];
    window.agentDisplayName = config.agentNames[turn.agentId] ?? turn.agentId;
    return window;
  });

  // Fetch known facts for all turns (parallel, deduplicated)
  const knownFactsSet = new Set<string>();
  try {
    const embedPromises = batchTurns.map(turn => {
      const text = `${turn.userText} ${turn.assistantText}`.slice(0, 500);
      return embed(text).catch(() => null);
    });
    const embedResults = await Promise.all(embedPromises);

    for (const turn of batchTurns) {
      const collections = searchCollections(turn.agentId);
      for (const embedResult of embedResults) {
        if (!embedResult) continue;
        const results = await Promise.all(
          collections.map(coll =>
            searchSimilar(coll, embedResult.vector, config.knownFactsLimit, config.knownFactsScoreThreshold)
              .catch(() => [])
          )
        );
        for (const hits of results) {
          for (const s of hits) knownFactsSet.add(s.fact);
        }
        break; // One embedding search per agent is enough for known facts
      }
    }
  } catch (err) {
    log('debug', 'batch', `Known facts lookup failed: ${(err as Error).message}`);
  }

  // Assign known facts to all windows
  const knownFacts = [...knownFactsSet];
  for (const w of windows) w.knownFacts = knownFacts;

  let totalExtracted = 0;
  let totalWritten = 0;
  let totalSkipped = 0;

  // --- Batch Fact Extraction ---
  let allFacts: Array<{ turnIndex: number; facts: Array<{ fact: string; type: string; confidence: number; sourceContext: string; scope?: string }> }>;
  try {
    allFacts = await batchExtractFacts(windows);
  } catch (err) {
    log('warn', 'batch', `Batch extraction failed, falling back to single-turn: ${(err as Error).message}`);
    // Fallback to single-turn processing
    for (let i = startIndex; i < endIndex; i++) {
      const result = await processTurn(turns, i, filePath, byteOffset);
      totalExtracted += result.extracted;
      totalWritten += result.written;
      totalSkipped += result.skipped;
    }
    return { extracted: totalExtracted, written: totalWritten, skipped: totalSkipped };
  }

  // Collect all candidates for batch verification
  const verificationCandidates: Array<{ fact: string; turnIdx: number; windowIdx: number }> = [];
  for (const entry of allFacts) {
    for (const fact of entry.facts) {
      const validation = validateFact({
        fact: fact.fact,
        type: fact.type as 'preference' | 'personal' | 'decision' | 'correction' | 'project' | 'deadline',
        confidence: fact.confidence,
        sourceContext: fact.sourceContext,
        scope: (fact.scope ?? 'personal') as 'personal' | 'household',
      });
      if (validation.valid) {
        const windowIdx = windows.findIndex(w => w.turnIndex === entry.turnIndex);
        if (windowIdx >= 0) {
          verificationCandidates.push({ fact: fact.fact, turnIdx: entry.turnIndex, windowIdx });
        }
      }
    }
    totalExtracted += entry.facts.length;
  }

  // Batch verify all facts
  let verifiedFlags: boolean[];
  try {
    verifiedFlags = await batchVerifyFacts(verificationCandidates.map(c => c.fact), windows[0]);
  } catch {
    // Fallback: verify individually
    verifiedFlags = [];
    for (const c of verificationCandidates) {
      const v = await verifyFactMiniMax(c.fact, windows[c.windowIdx]);
      verifiedFlags.push(v.verified);
    }
  }

  // Write verified facts
  for (let i = 0; i < verificationCandidates.length; i++) {
    if (!verifiedFlags[i]) continue;

    const candidate = verificationCandidates[i];
    const turnEntry = allFacts.find(e => e.turnIndex === candidate.turnIdx);
    const factData = turnEntry?.facts.find(f => f.fact === candidate.fact);
    if (!factData) continue;

    const turn = batchTurns.find(t => t.turnIndex === candidate.turnIdx);
    if (!turn) continue;

    let embeddingResult;
    try {
      embeddingResult = await embed(candidate.fact);
    } catch (err) {
      log('warn', 'batch', `Embedding failed: ${(err as Error).message}`);
      continue;
    }

    const targets = targetCollections(turn.agentId, factData.scope ?? 'personal');
    for (const collection of targets) {
      const [isDup, similarFacts] = await Promise.all([
        checkDuplicate(collection, turn.sessionId, turn.turnIndex, candidate.fact),
        searchSimilar(collection, embeddingResult.vector, 3, config.semanticDedupThreshold).catch(() => []),
      ]);

      if (isDup || similarFacts.length > 0) {
        totalSkipped++;
        continue;
      }

      const payload: FactPayload = {
        fact: candidate.fact,
        type: factData.type as FactPayload['type'],
        confidence: factData.confidence,
        sourceContext: factData.sourceContext,
        agentId: turn.agentId,
        sessionId: turn.sessionId,
        turnIndex: turn.turnIndex,
        timestamp: turn.timestamp,
        extractedAt: new Date().toISOString(),
        embeddingSource: embeddingResult.source,
      };
      if (factData.scope === 'household') payload.scope = 'household';

      await upsertFact(collection, { vector: embeddingResult.vector, payload });
      totalWritten++;
      log('info', 'batch', `Written: [${factData.scope}/${factData.type}] ${candidate.fact.slice(0, 60)}`);
    }
  }

  // --- Batch Behavior Extraction ---
  try {
    const cleanedWindows = windows.map(w => cleanWindowForBehavior(w));
    const allBehaviors = await batchExtractBehavior(cleanedWindows);

    const behaviorCandidates: Array<{ instruction: string; sourceContext: string; turnIdx: number; windowIdx: number; scope: string; confidence: number }> = [];
    for (const entry of allBehaviors) {
      for (const b of entry.behaviors) {
        if (b.instruction.length < 5 || b.instruction.length > 500) continue;
        if (b.confidence < 0.7) continue;
        const windowIdx = cleanedWindows.findIndex(w => w.turnIndex === entry.turnIndex);
        if (windowIdx >= 0) {
          behaviorCandidates.push({ ...b, turnIdx: entry.turnIndex, windowIdx });
        }
      }
    }

    // Batch verify behaviors
    let behaviorVerified: boolean[];
    try {
      behaviorVerified = await batchVerifyBehaviors(
        behaviorCandidates.map(c => ({ instruction: c.instruction, sourceContext: c.sourceContext })),
        cleanedWindows[0],
      );
    } catch {
      behaviorVerified = [];
      for (const c of behaviorCandidates) {
        const v = await verifyBehaviorMiniMax(c.instruction, c.sourceContext, cleanedWindows[c.windowIdx]);
        behaviorVerified.push(v.verified);
      }
    }

    for (let i = 0; i < behaviorCandidates.length; i++) {
      if (!behaviorVerified[i]) continue;

      const c = behaviorCandidates[i];
      const turn = batchTurns.find(t => t.turnIndex === c.turnIdx);
      if (!turn) continue;

      let embeddingResult;
      try {
        embeddingResult = await embed(c.instruction);
      } catch { continue; }

      const targets = targetInstructionCollections(turn.agentId, c.scope ?? 'personal');
      for (const collection of targets) {
        const [isDup, similar] = await Promise.all([
          checkDuplicate(collection, turn.sessionId, turn.turnIndex, c.instruction),
          searchSimilar(collection, embeddingResult.vector, 3, config.semanticDedupThreshold).catch(() => []),
        ]);

        if (isDup || similar.length > 0) continue;

        await upsertFact(collection, {
          vector: embeddingResult.vector,
          payload: {
            fact: c.instruction,
            type: 'behavior',
            confidence: c.confidence,
            sourceContext: c.sourceContext,
            agentId: turn.agentId,
            sessionId: turn.sessionId,
            turnIndex: turn.turnIndex,
            timestamp: turn.timestamp,
            extractedAt: new Date().toISOString(),
            embeddingSource: embeddingResult.source,
            scope: c.scope ?? 'personal',
          },
        });
        totalWritten++;
        log('info', 'batch', `Behavior written: ${c.instruction.slice(0, 60)}`);
      }
    }
  } catch (err) {
    log('warn', 'batch', `Batch behavior pass failed (non-fatal): ${(err as Error).message}`);
  }

  // Update offset to last turn in batch
  const lastTurn = batchTurns[batchTurns.length - 1];
  setOffset(filePath, byteOffset, lastTurn.turnIndex);

  log('info', 'batch', `Batch done: ${totalExtracted} extracted, ${totalWritten} written, ${totalSkipped} skipped`);
  return { extracted: totalExtracted, written: totalWritten, skipped: totalSkipped };
}
