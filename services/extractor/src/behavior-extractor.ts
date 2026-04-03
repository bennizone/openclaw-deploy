import { config, log } from './config.js';
import type { ExtractionWindow } from './window.js';
import { formatWindowPrompt } from './window.js';

export interface ExtractedInstruction {
  instruction: string;
  confidence: number;
  sourceContext: string;
  scope: 'personal' | 'household';
}

const BEHAVIOR_SYSTEM_PROMPT = `Du erkennst Verhaltensanweisungen in Konversationen.

Eine Verhaltensanweisung ist wenn der User dem Assistenten sagt WIE er sich verhalten soll.
Das sind dauerhafte Arbeitsregeln — KEINE einmaligen Bitten oder Fragen.

BEISPIELE fuer Verhaltensanweisungen:
- "Such zukuenftig in Deutschland" → JA (dauerhafte Regel)
- "Frag immer erst nach dem Raum" → JA (dauerhafte Regel)
- "Bezieh dich nicht auf Sonarr" → JA (dauerhafte Regel)
- "Antworte mir auf Deutsch" → JA (dauerhafte Regel)

KEINE Verhaltensanweisungen:
- "Kannst du mal X recherchieren?" → NEIN (einmalige Bitte)
- "Wie warm ist es?" → NEIN (Frage)
- "Ich mag Pizza" → NEIN (Praeferenz, kein Verhalten)
- "Wir nehmen Tool X" → NEIN (Entscheidung, kein Verhalten)
- "Analysiere diese Datei auf Token-Waste" → NEIN (einmaliger Analyse-Auftrag)
- "Konsolidiere die Teilergebnisse" → NEIN (einmalige Aufgabe)
- "Erstelle eine Patch-Tabelle" → NEIN (einmaliger Arbeitsauftrag)

Schluesselunterscheidung: Behavior gilt auch in ZUKUENFTIGEN Gespraechen.
Einmaliger Auftrag ist nur fuer dieses Gespraech relevant.

AUFBAU: <known_facts>, <context>, <current>, <followup> — wie beim Fact-Extractor.
Extrahiere NUR aus der USER-Nachricht in <current>.

Antworte AUSSCHLIESSLICH mit einem JSON-Array:
[{"instruction": "kurze Regel als Imperativ", "confidence": 0.0-1.0, "sourceContext": "max 100 Zeichen Originalzitat", "scope": "personal|household"}]

Wenn KEINE Verhaltensanweisung: leeres Array [].
Formuliere als klare Regel: "Bei Serien-Releases nach Deutschland-Terminen suchen" statt "Benni moechte dass...".
Sprache: Deutsch.`;

interface OpenAIResponse {
  choices: { message: { content: string } }[];
}

function cleanText(text: string): string {
  return text
    .replace(/\[Erinnerungen[^\]]*\][\s\S]*?\[\/Erinnerungen\]/g, '')
    .replace(/\[Regeln[^\]]*\][\s\S]*?\[\/Regeln\]/g, '')
    .replace(/\[SPRACHNACHRICHT[^\]]*\][\s\S]*?(?=\n\n|\n[A-Z])/g, '')
    .replace(/Conversation info \(untrusted metadata\)[^\n]*\n/g, '')
    .replace(/Sender \(untrusted metadata\)[^\n]*\n/g, '')
    .replace(/\[Audio\]\nUser text:\n/g, '')
    .replace(/\[WhatsApp[^\]]*\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanWindowForBehavior(window: ExtractionWindow): ExtractionWindow {
  return {
    ...window,
    current: { ...window.current, userText: cleanText(window.current.userText) },
    context: window.context.map(t => ({ ...t, userText: cleanText(t.userText) })),
    followup: window.followup.map(t => ({ ...t, userText: cleanText(t.userText) })),
    knownFacts: [],
  };
}

function stripThinkTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

function parseInstructionsJson(raw: string): ExtractedInstruction[] {
  const cleaned = stripThinkTags(raw);

  let jsonStr = cleaned;

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  // Find array boundaries
  const arrStart = jsonStr.indexOf('[');
  const arrEnd = jsonStr.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    jsonStr = jsonStr.slice(arrStart, arrEnd + 1);
  }

  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) return [];

  return parsed.map((item: Record<string, unknown>) => ({
    instruction: String(item.instruction ?? ''),
    confidence: Number(item.confidence ?? 0.5),
    sourceContext: String(item.sourceContext ?? '').slice(0, 100),
    scope: (item.scope === 'household' ? 'household' : 'personal') as 'household' | 'personal',
  })).filter(i => i.instruction.length > 0);
}

async function callMiniMaxBehavior(userPrompt: string): Promise<string> {
  const body = {
    model: config.extractionModel,
    messages: [
      { role: 'system', content: BEHAVIOR_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 2000,
    temperature: 0.1,
  };

  const resp = await fetch(`${config.minimaxBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.minimaxApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 429) {
    log('warn', 'behavior', 'Rate limited (429), waiting 60s...');
    await new Promise(r => setTimeout(r, 60000));
    const retry = await fetch(`${config.minimaxBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.minimaxApiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!retry.ok) throw new Error(`MiniMax retry failed: ${retry.status}`);
    const data = (await retry.json()) as OpenAIResponse;
    return data.choices[0].message.content;
  }

  if (resp.status >= 500) {
    throw new Error(`MiniMax server error: ${resp.status}`);
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`MiniMax error ${resp.status}: ${text}`);
  }

  const data = (await resp.json()) as OpenAIResponse;
  return data.choices[0].message.content;
}

/**
 * Extract behavioral instructions from a window using MiniMax.
 * Retries on 5xx with exponential backoff.
 */
export async function extractBehavior(window: ExtractionWindow): Promise<ExtractedInstruction[]> {
  const prompt = formatWindowPrompt(window);

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const raw = await callMiniMaxBehavior(prompt);
      const instructions = parseInstructionsJson(raw);
      log('debug', 'behavior', `Extracted ${instructions.length} instructions from turn ${window.turnIndex}`, {
        instructions: instructions.map(i => `[${i.scope}] ${i.instruction}`),
      });
      return instructions;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('server error') && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        log('warn', 'behavior', `Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${msg}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (msg.includes('server error') || msg.includes('MiniMax error')) {
        log('error', 'behavior', `MiniMax failed after ${attempt + 1} attempts: ${msg}`);
        throw new Error(`MiniMax unavailable: ${msg}`);
      }
      // JSON parse error — log and return empty
      log('warn', 'behavior', `Parse error on turn ${window.turnIndex}: ${msg}`);
      return [];
    }
  }

  return [];
}
