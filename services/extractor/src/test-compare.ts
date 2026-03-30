/**
 * Quality comparison: MiniMax (from Qdrant) vs Qwen 3.5 (with/without thinking)
 *
 * Reads all session files, builds extraction windows, calls Qwen for each turn,
 * and compares against the MiniMax facts already stored in Qdrant.
 *
 * Usage: npx tsx src/test-compare.ts
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { parseFile, agentIdFromPath } from './parser.js';
import { buildWindow, formatWindowPrompt } from './window.js';
import { config, log } from './config.js';

// ── Types ──

interface ExtractedFact {
  fact: string;
  type: string;
  confidence: number;
  sourceContext: string;
  scope: string;
}

interface TurnResult {
  sessionId: string;
  agentId: string;
  turnIndex: number;
  userText: string;
  prompt: string;
  minimax: ExtractedFact[];
  qwenNoThink: ExtractedFact[];
  qwenThink: ExtractedFact[];
}

// ── Qdrant: read MiniMax reference facts ──

async function getQdrantFactsForTurn(
  agentId: string,
  sessionId: string,
  turnIndex: number,
): Promise<ExtractedFact[]> {
  // Search in agent collection + household
  const collections = agentId === 'household'
    ? ['memories_household']
    : [`memories_${agentId}`, 'memories_household'];

  const facts: ExtractedFact[] = [];

  for (const collection of collections) {
    try {
      const resp = await fetch(`${config.qdrantUrl}/collections/${collection}/points/scroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            must: [
              { key: 'sessionId', match: { value: sessionId } },
              { key: 'turnIndex', match: { value: turnIndex } },
            ],
          },
          limit: 50,
          with_payload: true,
        }),
      });

      if (!resp.ok) continue;
      const data = await resp.json() as { result?: { points?: Array<{ payload: Record<string, unknown> }> } };
      for (const point of data.result?.points ?? []) {
        const p = point.payload;
        // Dedup by fact text
        if (!facts.some(f => f.fact === p.fact)) {
          facts.push({
            fact: String(p.fact ?? ''),
            type: String(p.type ?? ''),
            confidence: Number(p.confidence ?? 0),
            sourceContext: String(p.sourceContext ?? ''),
            scope: String(p.scope ?? 'personal'),
          });
        }
      }
    } catch {
      // Collection might not exist yet
    }
  }

  return facts;
}

// ── Qwen caller ──

const QWEN_URL = process.env.VERIFIER_URL || 'http://localhost:8080';

const SYSTEM_PROMPT = readFileSync(resolve(import.meta.dirname, 'extractor.ts'), 'utf-8')
  .match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1] ?? '';

// Fallback: hardcode if regex fails
const EXTRACTION_SYSTEM_PROMPT = SYSTEM_PROMPT || `Du bist ein Spezialist für die Extraktion dauerhafter Fakten aus Konversationen.

Analysiere den gegebenen Konversationsausschnitt und extrahiere AUSSCHLIESSLICH
Informationen die dauerhaft relevant sind:
- Persönliche Fakten (Name, Beruf, Familie, Wohnort)
- Präferenzen (mag/mag nicht, bevorzugt, lehnt ab)
- Entscheidungen (hat entschieden, plant zu)
- Korrekturen (hat frühere Aussage korrigiert/revidiert — besonders wichtig!)
- Projekte und laufende Aufgaben
- Wichtige Termine oder Deadlines

NICHT extrahieren:
- Smalltalk ohne Informationsgehalt
- Reine Fragen ohne Antwortkontext
- Temporäre Zustände ("bin gerade müde")
- Technische Setup-Gespräche über den Assistenten selbst

Bestimme für jeden Fakt den SCOPE:
- "personal" — betrifft nur die sprechende Person
- "household" — betrifft den Haushalt oder mehrere Bewohner

Antworte AUSSCHLIESSLICH mit einem JSON-Array.
Format:
[{"fact":"...","type":"preference|personal|decision|correction|project|deadline","confidence":0.0-1.0,"sourceContext":"...","scope":"personal|household"}]

Wenn keine Fakten: leeres Array [].
Sprache: Deutsch wenn Konversation Deutsch ist.`;

interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
}

async function callQwen(
  userPrompt: string,
  enableThinking: boolean,
): Promise<ExtractedFact[]> {
  try {
    const body: Record<string, unknown> = {
      model: 'Qwen3.5-9B-Q4_K_M',
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: enableThinking ? 8192 : 2000,
      temperature: 0.1,
      chat_template_kwargs: { enable_thinking: enableThinking },
    };

    const resp = await fetch(`${QWEN_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000), // 2min timeout for thinking mode
    });

    if (!resp.ok) {
      console.error(`  Qwen ${enableThinking ? 'think' : 'no-think'}: HTTP ${resp.status}`);
      return [];
    }

    const data = (await resp.json()) as OpenAIResponse;
    const raw = data.choices?.[0]?.message?.content ?? '';
    return parseFactsJson(raw);
  } catch (err) {
    console.error(`  Qwen ${enableThinking ? 'think' : 'no-think'} error: ${(err as Error).message}`);
    return [];
  }
}

// ── JSON parser (same logic as extractor.ts) ──

function stripThinkTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

function parseFactsJson(raw: string): ExtractedFact[] {
  const cleaned = stripThinkTags(raw);
  let jsonStr = cleaned;

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const arrStart = jsonStr.indexOf('[');
  const arrEnd = jsonStr.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    jsonStr = jsonStr.slice(arrStart, arrEnd + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: Record<string, unknown>) => ({
      fact: String(item.fact ?? ''),
      type: String(item.type ?? 'personal'),
      confidence: Number(item.confidence ?? 0.5),
      sourceContext: String(item.sourceContext ?? '').slice(0, 100),
      scope: (item.scope === 'household' ? 'household' : 'personal'),
    })).filter((f: ExtractedFact) => f.fact.length > 0);
  } catch {
    console.error(`  JSON parse error: ${jsonStr.slice(0, 100)}`);
    return [];
  }
}

// ── Find all session files ──

function findAllSessionFiles(): string[] {
  const files: string[] = [];
  const agentsDir = join(config.openclawStateDir, 'agents');

  let agents: string[];
  try {
    agents = readdirSync(agentsDir);
  } catch {
    return files;
  }

  for (const agent of agents) {
    if (!config.agents.includes(agent as typeof config.agents[number])) continue;
    const sessDir = join(agentsDir, agent, 'sessions');
    try {
      const sessions = readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));
      for (const s of sessions) {
        files.push(join(sessDir, s));
      }
    } catch {
      continue;
    }
  }

  return files.sort();
}

// ── CLI args ──
// Usage: npx tsx src/test-compare.ts [--phase 1|2|all]
//   Phase 1: no-thinking only → saves intermediate results
//   Phase 2: thinking only → loads phase 1 results, combines
//   all (default): runs both phases back-to-back

const PHASE_ARG = process.argv.find(a => a === '1' || a === '2') ?? 'all';
const INTERMEDIATE_PATH = resolve(import.meta.dirname, '..', 'test-phase1.json');

interface TurnEntry {
  sessionId: string;
  agentId: string;
  turnIndex: number;
  userText: string;
  prompt: string;
  minimax: ExtractedFact[];
}

// ── Main ──

async function main() {
  console.log(`=== Memory Extraction Quality Comparison (phase: ${PHASE_ARG}) ===`);
  console.log(`Qwen: ${QWEN_URL}`);
  console.log(`Qdrant (MiniMax ref): ${config.qdrantUrl}`);
  console.log();

  // ── Prepare all turns + MiniMax reference ──

  const files = findAllSessionFiles();
  console.log(`Found ${files.length} session files`);

  const entries: TurnEntry[] = [];

  for (const filePath of files) {
    const { turns } = parseFile(filePath, 0, 0);
    if (turns.length === 0) continue;

    const agentId = agentIdFromPath(filePath);
    const sessionId = turns[0].sessionId;

    for (let i = 0; i < turns.length; i++) {
      const window = buildWindow(turns, i);
      const prompt = formatWindowPrompt(window);
      const minimax = await getQdrantFactsForTurn(agentId, sessionId, i);

      entries.push({
        sessionId,
        agentId,
        turnIndex: i,
        userText: turns[i].userText.slice(0, 200),
        prompt,
        minimax,
      });
    }
  }

  console.log(`Prepared ${entries.length} turns (MiniMax ref loaded from Qdrant)\n`);

  // ── Phase 1: Qwen NO-THINKING ──

  let noThinkResults: ExtractedFact[][] = [];
  let durationNoThink = '0';

  if (PHASE_ARG === '1' || PHASE_ARG === 'all') {
    console.log('═══════════════════════════════════════');
    console.log('PHASE 1: Qwen WITHOUT thinking');
    console.log('═══════════════════════════════════════\n');

    const startNoThink = Date.now();

    for (let idx = 0; idx < entries.length; idx++) {
      const e = entries[idx];
      console.log(`[${idx + 1}/${entries.length}] ${e.agentId}/${e.sessionId.slice(0, 8)} turn ${e.turnIndex}: "${e.userText.slice(0, 60)}"`);
      const facts = await callQwen(e.prompt, false);
      noThinkResults.push(facts);

      if (facts.length > 0 || e.minimax.length > 0) {
        for (const f of e.minimax) console.log(`  [MM] [${f.scope}/${f.type}] ${f.fact}`);
        for (const f of facts) console.log(`  [QN] [${f.scope}/${f.type}] ${f.fact}`);
      }
    }

    durationNoThink = ((Date.now() - startNoThink) / 1000).toFixed(1);
    const totalNoThinkFacts = noThinkResults.reduce((s, r) => s + r.length, 0);
    console.log(`\nPhase 1 done: ${totalNoThinkFacts} facts in ${durationNoThink}s`);

    // Save intermediate results for phase 2
    writeFileSync(INTERMEDIATE_PATH, JSON.stringify({
      entries: entries.map(e => ({ ...e, prompt: e.prompt.slice(0, 500) })),
      noThinkResults,
      durationNoThink,
    }, null, 2));
    console.log(`Intermediate results saved to ${INTERMEDIATE_PATH}`);
  }

  if (PHASE_ARG === '1') {
    console.log('\nPhase 1 complete. Change threads, then run: npx tsx src/test-compare.ts 2');
    return;
  }

  // ── Phase 2: Qwen WITH THINKING ──

  // Load phase 1 results if running phase 2 separately
  if (PHASE_ARG === '2') {
    console.log('Loading Phase 1 results...');
    const saved = JSON.parse(readFileSync(INTERMEDIATE_PATH, 'utf-8'));
    noThinkResults = saved.noThinkResults;
    durationNoThink = saved.durationNoThink;
    console.log(`Loaded ${noThinkResults.length} no-think results (${durationNoThink}s)\n`);
  }

  console.log('═══════════════════════════════════════');
  console.log('PHASE 2: Qwen WITH thinking');
  console.log('═══════════════════════════════════════\n');

  const startThink = Date.now();
  const thinkResults: ExtractedFact[][] = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx];
    console.log(`[${idx + 1}/${entries.length}] ${e.agentId}/${e.sessionId.slice(0, 8)} turn ${e.turnIndex}: "${e.userText.slice(0, 60)}"`);
    const facts = await callQwen(e.prompt, true);
    thinkResults.push(facts);

    if (facts.length > 0 || e.minimax.length > 0) {
      for (const f of e.minimax) console.log(`  [MM] [${f.scope}/${f.type}] ${f.fact}`);
      for (const f of facts) console.log(`  [QT] [${f.scope}/${f.type}] ${f.fact}`);
    }
  }

  const durationThink = ((Date.now() - startThink) / 1000).toFixed(1);
  const totalThinkFacts = thinkResults.reduce((s, r) => s + r.length, 0);
  console.log(`\nPhase 2 done: ${totalThinkFacts} facts in ${durationThink}s`);

  // ── Build combined results ──

  const results: TurnResult[] = entries.map((e, idx) => ({
    ...e,
    prompt: e.prompt.slice(0, 500),
    qwenNoThink: noThinkResults[idx],
    qwenThink: thinkResults[idx],
  }));

  // ── Summary ──

  const mmTotal = results.reduce((s, r) => s + r.minimax.length, 0);
  const qnTotal = results.reduce((s, r) => s + r.qwenNoThink.length, 0);
  const qtTotal = results.reduce((s, r) => s + r.qwenThink.length, 0);

  const turnsWithFacts = results.filter(r => r.minimax.length > 0 || r.qwenNoThink.length > 0 || r.qwenThink.length > 0);

  const mmHousehold = results.reduce((s, r) => s + r.minimax.filter(f => f.scope === 'household').length, 0);
  const qnHousehold = results.reduce((s, r) => s + r.qwenNoThink.filter(f => f.scope === 'household').length, 0);
  const qtHousehold = results.reduce((s, r) => s + r.qwenThink.filter(f => f.scope === 'household').length, 0);

  console.log('\n═══════════════════════════════════════');
  console.log('FINAL SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`Total turns: ${results.length}`);
  console.log(`Turns with any facts: ${turnsWithFacts.length}`);
  console.log();
  console.log(`Timing:`);
  console.log(`  Phase 1 (no-think): ${durationNoThink}s`);
  console.log(`  Phase 2 (think):    ${durationThink}s`);
  console.log();
  console.log(`Facts extracted:`);
  console.log(`  MiniMax M2.7:      ${mmTotal} (${mmHousehold} household, ${mmTotal - mmHousehold} personal)`);
  console.log(`  Qwen no-thinking:  ${qnTotal} (${qnHousehold} household, ${qnTotal - qnHousehold} personal)`);
  console.log(`  Qwen thinking:     ${qtTotal} (${qtHousehold} household, ${qtTotal - qtHousehold} personal)`);
  console.log();

  // Disagreements
  const mmOnlyTurns = results.filter(r => r.minimax.length > 0 && r.qwenNoThink.length === 0 && r.qwenThink.length === 0);
  const qwenOnlyTurns = results.filter(r => r.minimax.length === 0 && (r.qwenNoThink.length > 0 || r.qwenThink.length > 0));
  const noThinkOnlyTurns = results.filter(r => r.qwenNoThink.length > 0 && r.qwenThink.length === 0);
  const thinkOnlyTurns = results.filter(r => r.qwenThink.length > 0 && r.qwenNoThink.length === 0);

  console.log(`Disagreements:`);
  console.log(`  MiniMax found facts, Qwen (both) didn't: ${mmOnlyTurns.length} turns`);
  console.log(`  Qwen found facts, MiniMax didn't:        ${qwenOnlyTurns.length} turns`);
  console.log(`  No-think found, think didn't:            ${noThinkOnlyTurns.length} turns`);
  console.log(`  Think found, no-think didn't:            ${thinkOnlyTurns.length} turns`);

  if (mmOnlyTurns.length > 0) {
    console.log('\n  MiniMax-only examples:');
    for (const r of mmOnlyTurns.slice(0, 5)) {
      console.log(`    ${r.agentId} turn ${r.turnIndex}: "${r.userText.slice(0, 80)}"`);
      for (const f of r.minimax) console.log(`      -> ${f.fact}`);
    }
  }

  if (qwenOnlyTurns.length > 0) {
    console.log('\n  Qwen-only examples:');
    for (const r of qwenOnlyTurns.slice(0, 5)) {
      console.log(`    ${r.agentId} turn ${r.turnIndex}: "${r.userText.slice(0, 80)}"`);
      for (const f of [...r.qwenNoThink, ...r.qwenThink]) console.log(`      -> ${f.fact}`);
    }
  }

  // Save full results
  const outPath = resolve(import.meta.dirname, '..', 'test-results.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results saved to: ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
