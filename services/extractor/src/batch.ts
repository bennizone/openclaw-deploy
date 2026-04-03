import { config, log } from './config.js';
import { MiniMaxChatClient, parseJsonArray, stripThinkTags } from '@openclaw/minimax-client';
import type { ExtractionWindow } from './window.js';

let _minimax: MiniMaxChatClient | null = null;
function getMiniMax(): MiniMaxChatClient {
  if (!_minimax) {
    _minimax = new MiniMaxChatClient({
      apiKey: config.minimaxApiKey,
      baseUrl: config.minimaxBaseUrl,
      logFn: (level, msg) => log(level, 'minimax', msg),
    });
  }
  return _minimax;
}

// --- Batch Fact Extraction ---

const BATCH_FACT_SYSTEM = `Du extrahierst dauerhafte Fakten aus MEHREREN Konversations-Turns gleichzeitig.

Jeder Turn ist mit <turn_N> markiert. Extrahiere Fakten NUR aus USER-Nachrichten.

WAS EXTRAHIEREN:
- Persoenliche Fakten, Praeferenzen, Beziehungen, Entscheidungen, Haushalt-Regeln
- User bestaetigt oder korrigiert etwas

NICHT EXTRAHIEREN:
- Assistenten-Aussagen ohne User-Bestaetigung
- Geraetezustaende, Sensorwerte, API-Infos, Smalltalk
- Bereits in <known_facts> vorhandene Fakten

Antworte AUSSCHLIESSLICH mit einem JSON-Array. Kein Markdown, keine Erklaerungen.
Format:
[
  {
    "turnIndex": 5,
    "fact": "Benni arbeitet als Software-Entwickler",
    "type": "preference|personal|decision|correction|project|deadline",
    "confidence": 0.0-1.0,
    "sourceContext": "kurzes Originalzitat max 100 Zeichen",
    "scope": "personal|household"
  }
]

Wenn keine Fakten: leeres Array [].
Sprache: Deutsch wenn Konversation Deutsch ist.`;

function formatBatchFactPrompt(windows: ExtractionWindow[]): string {
  let prompt = '';

  // Combined known facts
  const allKnown = new Set<string>();
  for (const w of windows) {
    for (const f of w.knownFacts) allKnown.add(f);
  }
  if (allKnown.size > 0) {
    prompt += '<known_facts>\n';
    for (const f of allKnown) prompt += `- ${f}\n`;
    prompt += '</known_facts>\n\n';
  }

  const userName = windows[0].agentDisplayName;

  for (const w of windows) {
    prompt += `<turn_${w.turnIndex}>\n`;
    if (w.context.length > 0) {
      prompt += '[Kontext]\n';
      for (const t of w.context) {
        prompt += `${userName}: ${t.userText}\nAssistent: ${t.assistantText}\n\n`;
      }
    }
    prompt += `[Aktuell]\n${userName}: ${w.current.userText}\nAssistent: ${w.current.assistantText}\n`;
    if (w.followup.length > 0) {
      prompt += '[Followup]\n';
      for (const t of w.followup) {
        prompt += `${userName}: ${t.userText}\nAssistent: ${t.assistantText}\n\n`;
      }
    }
    prompt += `</turn_${w.turnIndex}>\n\n`;
  }

  return prompt;
}

interface BatchFactResult {
  turnIndex: number;
  facts: Array<{
    fact: string;
    type: string;
    confidence: number;
    sourceContext: string;
    scope?: string;
  }>;
}

export async function batchExtractFacts(windows: ExtractionWindow[]): Promise<BatchFactResult[]> {
  const prompt = formatBatchFactPrompt(windows);

  const result = await getMiniMax().chat({
    systemPrompt: BATCH_FACT_SYSTEM,
    userPrompt: prompt,
    maxTokens: 4096,
    temperature: 0.1,
    tag: 'batch-extractor',
    timeoutMs: 90_000,
  });

  const parsed = parseJsonArray<Record<string, unknown>>(stripThinkTags(result.content));

  // Group by turnIndex
  const byTurn = new Map<number, BatchFactResult['facts']>();
  for (const item of parsed) {
    const turnIndex = Number(item.turnIndex ?? -1);
    if (turnIndex < 0) continue;
    if (!byTurn.has(turnIndex)) byTurn.set(turnIndex, []);
    byTurn.get(turnIndex)!.push({
      fact: String(item.fact ?? ''),
      type: String(item.type ?? 'personal'),
      confidence: Number(item.confidence ?? 0.5),
      sourceContext: String(item.sourceContext ?? '').slice(0, 100),
      scope: String(item.scope ?? 'personal'),
    });
  }

  const results: BatchFactResult[] = [];
  for (const [turnIndex, facts] of byTurn) {
    results.push({ turnIndex, facts: facts.filter(f => f.fact.length > 0) });
  }

  log('info', 'batch', `Batch extracted ${parsed.length} facts from ${windows.length} turns in 1 request`);
  return results;
}

// --- Batch Behavior Extraction ---

const BATCH_BEHAVIOR_SYSTEM = `Du erkennst Verhaltensanweisungen aus MEHREREN Konversations-Turns gleichzeitig.

Jeder Turn ist mit <turn_N> markiert. Suche NUR in USER-Nachrichten.

Verhaltensanweisung = DAUERHAFTE Arbeitsregel, die auch in zukuenftigen Gespraechen gilt.
KEINE einmaligen Bitten, Fragen, Praeferenzen oder Entscheidungen.

Antworte AUSSCHLIESSLICH mit einem JSON-Array:
[
  {
    "turnIndex": 5,
    "instruction": "kurze Regel als Imperativ",
    "confidence": 0.0-1.0,
    "sourceContext": "max 100 Zeichen Originalzitat",
    "scope": "personal|household"
  }
]

Wenn KEINE Verhaltensanweisungen: leeres Array [].
Sprache: Deutsch.`;

interface BatchBehaviorResult {
  turnIndex: number;
  behaviors: Array<{
    instruction: string;
    confidence: number;
    sourceContext: string;
    scope: string;
  }>;
}

export async function batchExtractBehavior(windows: ExtractionWindow[]): Promise<BatchBehaviorResult[]> {
  const prompt = formatBatchFactPrompt(windows); // Same format, different system prompt

  const result = await getMiniMax().chat({
    systemPrompt: BATCH_BEHAVIOR_SYSTEM,
    userPrompt: prompt,
    maxTokens: 4096,
    temperature: 0.1,
    tag: 'batch-behavior',
    timeoutMs: 90_000,
  });

  const parsed = parseJsonArray<Record<string, unknown>>(stripThinkTags(result.content));

  const byTurn = new Map<number, BatchBehaviorResult['behaviors']>();
  for (const item of parsed) {
    const turnIndex = Number(item.turnIndex ?? -1);
    if (turnIndex < 0) continue;
    if (!byTurn.has(turnIndex)) byTurn.set(turnIndex, []);
    byTurn.get(turnIndex)!.push({
      instruction: String(item.instruction ?? ''),
      confidence: Number(item.confidence ?? 0.5),
      sourceContext: String(item.sourceContext ?? '').slice(0, 100),
      scope: String(item.scope ?? 'personal'),
    });
  }

  const results: BatchBehaviorResult[] = [];
  for (const [turnIndex, behaviors] of byTurn) {
    results.push({ turnIndex, behaviors: behaviors.filter(b => b.instruction.length > 0) });
  }

  log('info', 'batch', `Batch extracted ${parsed.length} behaviors from ${windows.length} turns in 1 request`);
  return results;
}

// --- Batch Verification ---

const BATCH_VERIFY_SYSTEM = `Du pruefst mehrere behauptete Fakten gleichzeitig.

Fuer JEDEN Fakt pruefe:
1. Hat der USER das selbst gesagt oder explizit bestaetigt?
2. Ist es ein DAUERHAFTER Fakt (nicht momentaner Zustand)?
3. Wurde es in Folge-Turns zurueckgenommen?

Antworte AUSSCHLIESSLICH mit einem JSON-Array. Fuer JEDEN Fakt (gleiche Reihenfolge):
[
  {"index": 0, "verified": true, "reason": "kurze Begruendung"},
  {"index": 1, "verified": false, "reason": "kurze Begruendung"}
]`;

export async function batchVerifyFacts(
  facts: string[],
  contextWindow: ExtractionWindow,
): Promise<boolean[]> {
  if (facts.length === 0) return [];

  const userName = contextWindow.agentDisplayName;
  let prompt = `Pruefe die folgenden ${facts.length} Fakten:\n\n`;
  for (let i = 0; i < facts.length; i++) {
    prompt += `[${i}] "${facts[i]}"\n`;
  }

  const result = await getMiniMax().chat({
    systemPrompt: BATCH_VERIFY_SYSTEM,
    userPrompt: prompt,
    maxTokens: 2000,
    temperature: 0.1,
    tag: 'batch-verifier',
    timeoutMs: 60_000,
  });

  const parsed = parseJsonArray<{ index: number; verified: boolean }>(stripThinkTags(result.content));

  // Build boolean array in order
  const verified = new Array(facts.length).fill(false);
  for (const item of parsed) {
    if (typeof item.index === 'number' && item.index >= 0 && item.index < facts.length) {
      verified[item.index] = Boolean(item.verified);
    }
  }

  const verifiedCount = verified.filter(Boolean).length;
  log('info', 'batch', `Batch verified ${verifiedCount}/${facts.length} facts in 1 request`);
  return verified;
}

const BATCH_VERIFY_BEHAVIOR_SYSTEM = `Du pruefst mehrere behauptete Verhaltensanweisungen gleichzeitig.

Fuer JEDE Anweisung pruefe:
1. Hat der USER diese Anweisung SELBST gegeben?
2. Ist es eine DAUERHAFTE Arbeitsregel (nicht einmalige Bitte)?
3. Wurde sie in Folge-Turns zurueckgenommen?
4. Gilt sie auch in ZUKUENFTIGEN Gespraechen?

Antworte AUSSCHLIESSLICH mit einem JSON-Array:
[
  {"index": 0, "verified": true, "reason": "kurze Begruendung"},
  {"index": 1, "verified": false, "reason": "kurze Begruendung"}
]`;

export async function batchVerifyBehaviors(
  behaviors: Array<{ instruction: string; sourceContext: string }>,
  contextWindow: ExtractionWindow,
): Promise<boolean[]> {
  if (behaviors.length === 0) return [];

  let prompt = `Pruefe die folgenden ${behaviors.length} Verhaltensanweisungen:\n\n`;
  for (let i = 0; i < behaviors.length; i++) {
    prompt += `[${i}] Anweisung: "${behaviors[i].instruction}" (Zitat: "${behaviors[i].sourceContext}")\n`;
  }

  const result = await getMiniMax().chat({
    systemPrompt: BATCH_VERIFY_BEHAVIOR_SYSTEM,
    userPrompt: prompt,
    maxTokens: 2000,
    temperature: 0.1,
    tag: 'batch-behavior-verifier',
    timeoutMs: 60_000,
  });

  const parsed = parseJsonArray<{ index: number; verified: boolean }>(stripThinkTags(result.content));

  const verified = new Array(behaviors.length).fill(false);
  for (const item of parsed) {
    if (typeof item.index === 'number' && item.index >= 0 && item.index < behaviors.length) {
      verified[item.index] = Boolean(item.verified);
    }
  }

  const verifiedCount = verified.filter(Boolean).length;
  log('info', 'batch', `Batch verified ${verifiedCount}/${behaviors.length} behaviors in 1 request`);
  return verified;
}
