import { log } from './config.js';
import { parseJsonArray } from '@openclaw/minimax-client';
import { getMiniMax } from './lib/minimax.js';
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

function validateInstructions(parsed: Record<string, unknown>[]): ExtractedInstruction[] {
  return parsed.map(item => ({
    instruction: String(item.instruction ?? ''),
    confidence: Number(item.confidence ?? 0.5),
    sourceContext: String(item.sourceContext ?? '').slice(0, 100),
    scope: (item.scope === 'household' ? 'household' : 'personal') as 'household' | 'personal',
  })).filter(i => i.instruction.length > 0);
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
      const result = await getMiniMax().chat({
        systemPrompt: BEHAVIOR_SYSTEM_PROMPT,
        userPrompt: prompt,
        maxTokens: 8192,
        temperature: 0.1,
        tag: 'behavior',
      });
      const parsed = parseJsonArray<Record<string, unknown>>(result.content);
      const instructions = validateInstructions(parsed);
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
