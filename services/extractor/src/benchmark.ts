/**
 * Benchmark: 3-way comparison of extraction quality.
 *
 * Runs all sessions through the new extraction pipeline (user-only, known-facts-aware)
 * and verifies each candidate with both Qwen and MiniMax.
 *
 * Output: benchmark/results.json with full comparison data.
 */

import { readdirSync } from 'fs';
import { writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { config, log } from './config.js';
import { initQdrant, ensureCollections, searchSimilar, collectionName } from './qdrant.js';
import { parseFile } from './parser.js';
import { buildWindow } from './window.js';
import { extractFacts, type ExtractedFact } from './extractor.js';
import { embed } from './embedder.js';
import { verifyFact, verifyFactMiniMax } from './verifier.js';
import { validateFact } from './validator.js';

interface CandidateResult {
  fact: string;
  type: string;
  confidence: number;
  scope: string;
  sourceContext: string;
  sessionId: string;
  agentId: string;
  turnIndex: number;
  turnUserText: string;
  turnAssistantText: string;
  knownFactsProvided: string[];
  validation: { valid: boolean; reason?: string };
  verification: {
    qwen: { verified: boolean; reason: string };
    minimax: { verified: boolean; reason: string };
  };
}

interface BenchmarkResults {
  meta: {
    date: string;
    sessions: number;
    turns: number;
    extractionModel: string;
    verifierQwen: string;
    verifierMiniMax: string;
  };
  candidates: CandidateResult[];
  summary: {
    totalTurns: number;
    turnsWithCandidates: number;
    totalCandidates: number;
    validatorAccepted: number;
    validatorRejected: number;
    qwenAccepted: number;
    qwenRejected: number;
    minimaxAccepted: number;
    minimaxRejected: number;
    bothAccepted: number;
    bothRejected: number;
    disagreements: number;
  };
}

function getSessionFiles(): Array<{ path: string; agentId: string }> {
  const files: Array<{ path: string; agentId: string }> = [];

  for (const agent of config.agents) {
    const sessionsDir = join(config.openclawStateDir, 'agents', agent, 'sessions');
    try {
      const entries = readdirSync(sessionsDir);
      for (const entry of entries) {
        if (entry.endsWith('.jsonl')) {
          files.push({ path: join(sessionsDir, entry), agentId: agent });
        }
      }
    } catch {
      log('debug', 'benchmark', `No sessions dir for agent ${agent}`);
    }
  }

  return files;
}

async function main(): Promise<void> {
  log('info', 'benchmark', '═══════════════════════════════════════════');
  log('info', 'benchmark', 'Extraction Benchmark — 3-way comparison');
  log('info', 'benchmark', '═══════════════════════════════════════════');

  // Init Qdrant (for known facts lookup)
  initQdrant();
  await ensureCollections();

  const sessionFiles = getSessionFiles();
  log('info', 'benchmark', `Found ${sessionFiles.length} session files`);

  const candidates: CandidateResult[] = [];
  let totalTurns = 0;
  let turnsWithCandidates = 0;
  let sessionCount = 0;

  for (const { path, agentId } of sessionFiles) {
    const { turns } = parseFile(path);
    if (turns.length === 0) continue;

    sessionCount++;
    log('info', 'benchmark', `Processing ${path} (${turns.length} turns, agent: ${agentId})`);

    for (let i = 0; i < turns.length; i++) {
      totalTurns++;
      const turn = turns[i];
      const window = buildWindow(turns, i);

      // Embed current turn text for known facts lookup
      const turnText = `${turn.userText} ${turn.assistantText}`.slice(0, 500);
      let knownFacts: string[] = [];

      try {
        const embResult = await embed(turnText);

        // Search relevant collections for known facts
        const collections = turn.agentId === 'household'
          ? [collectionName('household')]
          : [collectionName(turn.agentId), collectionName('household')];

        for (const coll of collections) {
          try {
            const similar = await searchSimilar(coll, embResult.vector, config.knownFactsLimit, config.knownFactsScoreThreshold);
            for (const s of similar) {
              if (!knownFacts.includes(s.fact)) {
                knownFacts.push(s.fact);
              }
            }
          } catch {
            // Collection might be empty
          }
        }
      } catch (err) {
        log('debug', 'benchmark', `Embedding failed for turn ${i}: ${(err as Error).message}`);
      }

      // Set known facts on window
      window.knownFacts = knownFacts;

      // Extract with new benchmark prompt
      const facts = await extractFacts(window);

      if (facts.length === 0) continue;
      turnsWithCandidates++;

      // Process each candidate
      for (const fact of facts) {
        log('info', 'benchmark', `Candidate: [${fact.scope}/${fact.type}] "${fact.fact.slice(0, 60)}..." — verifying...`);

        // Validate
        const validation = validateFact(fact);

        // Verify with both models (even if validation fails, for comparison)
        const [qwenResult, minimaxResult] = await Promise.all([
          verifyFact(fact.fact, window),
          verifyFactMiniMax(fact.fact, window),
        ]);

        candidates.push({
          fact: fact.fact,
          type: fact.type,
          confidence: fact.confidence,
          scope: fact.scope ?? 'personal',
          sourceContext: fact.sourceContext,
          sessionId: turn.sessionId,
          agentId: turn.agentId,
          turnIndex: turn.turnIndex,
          turnUserText: turn.userText.slice(0, 300),
          turnAssistantText: turn.assistantText.slice(0, 300),
          knownFactsProvided: knownFacts,
          validation,
          verification: {
            qwen: qwenResult,
            minimax: minimaxResult,
          },
        });

        const qMark = qwenResult.verified ? '✓' : '✗';
        const mMark = minimaxResult.verified ? '✓' : '✗';
        log('info', 'benchmark', `  Qwen: ${qMark} (${qwenResult.reason}) | MiniMax: ${mMark} (${minimaxResult.reason})`);
      }
    }
  }

  // Summary
  const validatorAccepted = candidates.filter(c => c.validation.valid).length;
  const validatorRejected = candidates.filter(c => !c.validation.valid).length;
  const qwenAccepted = candidates.filter(c => c.verification.qwen.verified).length;
  const qwenRejected = candidates.filter(c => !c.verification.qwen.verified).length;
  const minimaxAccepted = candidates.filter(c => c.verification.minimax.verified).length;
  const minimaxRejected = candidates.filter(c => !c.verification.minimax.verified).length;
  const bothAccepted = candidates.filter(c => c.verification.qwen.verified && c.verification.minimax.verified).length;
  const bothRejected = candidates.filter(c => !c.verification.qwen.verified && !c.verification.minimax.verified).length;
  const disagreements = candidates.filter(c => c.verification.qwen.verified !== c.verification.minimax.verified).length;

  const results: BenchmarkResults = {
    meta: {
      date: new Date().toISOString(),
      sessions: sessionCount,
      turns: totalTurns,
      extractionModel: config.extractionModel,
      verifierQwen: `${config.verifierUrl} / ${config.verifierModel}`,
      verifierMiniMax: `${config.minimaxBaseUrl} / ${config.extractionModel}`,
    },
    candidates,
    summary: {
      totalTurns,
      turnsWithCandidates,
      totalCandidates: candidates.length,
      validatorAccepted,
      validatorRejected,
      qwenAccepted,
      qwenRejected,
      minimaxAccepted,
      minimaxRejected,
      bothAccepted,
      bothRejected,
      disagreements,
    },
  };

  const outPath = resolve(import.meta.dirname, '..', 'benchmark', 'results.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  // Print summary
  console.log('\n═══════════════════════════════════════════');
  console.log('BENCHMARK RESULTS');
  console.log('═══════════════════════════════════════════');
  console.log(`Sessions: ${sessionCount} | Turns: ${totalTurns} | Turns with candidates: ${turnsWithCandidates}`);
  console.log(`Total candidates: ${candidates.length}`);
  console.log('');
  console.log(`Validator:  ${validatorAccepted} accepted / ${validatorRejected} rejected`);
  console.log(`Qwen:       ${qwenAccepted} accepted / ${qwenRejected} rejected`);
  console.log(`MiniMax:    ${minimaxAccepted} accepted / ${minimaxRejected} rejected`);
  console.log(`Both agree: ${bothAccepted} accepted, ${bothRejected} rejected`);
  console.log(`Disagree:   ${disagreements}`);
  console.log('');
  console.log('─── Candidates accepted by BOTH verifiers ───');
  for (const c of candidates.filter(c => c.verification.qwen.verified && c.verification.minimax.verified)) {
    console.log(`  [${c.scope}/${c.type}] ${c.fact}`);
  }
  console.log('');
  console.log('─── Candidates rejected by BOTH verifiers ───');
  for (const c of candidates.filter(c => !c.verification.qwen.verified && !c.verification.minimax.verified)) {
    console.log(`  [${c.scope}/${c.type}] ${c.fact}`);
    console.log(`    Qwen: ${c.verification.qwen.reason}`);
    console.log(`    MiniMax: ${c.verification.minimax.reason}`);
  }
  console.log('');
  console.log('─── Disagreements ───');
  for (const c of candidates.filter(c => c.verification.qwen.verified !== c.verification.minimax.verified)) {
    const qMark = c.verification.qwen.verified ? '✓' : '✗';
    const mMark = c.verification.minimax.verified ? '✓' : '✗';
    console.log(`  [${c.scope}/${c.type}] ${c.fact}`);
    console.log(`    Qwen: ${qMark} ${c.verification.qwen.reason}`);
    console.log(`    MiniMax: ${mMark} ${c.verification.minimax.reason}`);
  }
  console.log('');
  console.log(`Results saved to: ${outPath}`);
}

main().catch(err => {
  log('error', 'benchmark', `Fatal: ${(err as Error).message}`);
  console.error(err);
  process.exit(1);
});
