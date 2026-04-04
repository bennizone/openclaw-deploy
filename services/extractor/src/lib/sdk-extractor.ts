import { query } from '@anthropic-ai/claude-agent-sdk';
import { config, log } from '../config.js';
import type { ExtractionWindow } from '../window.js';
import { formatWindowPrompt } from '../window.js';
import { cleanWindowForBehavior } from '../behavior-extractor.js';
import type { ExtractedFact } from '../extractor.js';
import type { ExtractedInstruction } from '../behavior-extractor.js';

export interface ExtractionResult {
  facts: ExtractedFact[];
  behaviors: ExtractedInstruction[];
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact:          { type: 'string' },
          type:          { type: 'string', enum: ['preference', 'personal', 'decision', 'correction'] },
          confidence:    { type: 'number' },
          sourceContext: { type: 'string' },
          scope:         { type: 'string', enum: ['personal', 'household'] },
        },
        required: ['fact', 'type', 'confidence', 'sourceContext', 'scope'],
        additionalProperties: false,
      },
    },
    behaviors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          instruction:   { type: 'string' },
          confidence:    { type: 'number' },
          sourceContext: { type: 'string' },
          scope:         { type: 'string', enum: ['personal', 'household'] },
        },
        required: ['instruction', 'confidence', 'sourceContext', 'scope'],
        additionalProperties: false,
      },
    },
  },
  required: ['facts', 'behaviors'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Du analysierst einen Konversations-Turn und extrahierst dauerhafte Fakten und Verhaltensregeln.

## FACTS

AUFBAU DES PROMPTS:
- <known_facts>: Bereits gespeicherte Fakten. Vermeide Duplikate, erkenne Widersprueche.
- <context>: Vorherige Turns — nur zum Verstaendnis. NICHT daraus extrahieren.
- <current>: Der aktuelle Turn — extrahiere NUR aus der USER-Nachricht.
- <followup>: Folge-Turns — pruefen ob der User sich korrigiert hat.

EXTRAHIEREN:
- Wer ist die Person: Name, Beruf, Familie, Wohnort, Hobbys, Haustiere, Geburtstage
- Beziehungen: "mein Bruder heisst X", "Domi hat am 22. April Geburtstag"
- Praeferenzen: "ich mag X", "ich schaue Y auf Z", "ich bevorzuge A ueber B"
- Kontext einbacken: Statt nur "Benni mag X" schreibe "Benni mag X weil Y" wenn der Grund erkennbar ist.
- Smart-Home/Haushalt: Geraete, Raeume, Regeln, Routinen, Bewohner
- User KORRIGIERT einen bekannten Fakt ("nein, nicht X sondern Y")

NICHT EXTRAHIEREN:
- Fragen (NIEMALS — auch nicht als Fakt umformuliert)
- Technische Arbeit: Code, Configs, Patches, Bugs, Error-Counts, API-Details
- Einmalige Auftraege und Session-spezifische Analyse-Ergebnisse
- Projekt-Management: Tasks, Phasen, Deadlines
- Telefonnummern, E-Mail-Adressen, Passwoerter, API-Keys (NIEMALS PII!)
- Bereits in <known_facts> vorhandene Fakten (ausser Korrektur)

TESTFRAGE: "Beschreibt das den MENSCHEN oder seine aktuelle ARBEIT?" Nur Menschen-Fakten.
KORREKTUREN: Wenn der User in <followup> sich korrigiert → type "correction".
SCOPE: "personal" = eine Person, "household" = Haushalt/Wohnung/Smart-Home.
Verwende den Namen der Person im Fact wenn bekannt. Sprache: Deutsch.

## BEHAVIORS

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

Schluesselunterscheidung: Behavior gilt auch in ZUKUENFTIGEN Gespraechen.
Einmaliger Auftrag ist nur fuer dieses Gespraech relevant.

REFORMULIERUNG (WICHTIG):
Formuliere die Anweisung so KONKRET, dass ein LLM sie ohne weiteren Kontext befolgen kann.
Beschreibe WANN die Regel greift und WAS konkret anders gemacht werden soll.

Schlecht: "Bei Serien-Releases nach Deutschland suchen"
Gut: "Wenn du Release-Daten, Episoden-Verfuegbarkeit oder Staffel-Status nennst, nenne IMMER den deutschen Release-Termin, nicht den US-Termin."

Schlecht: "Frag nach dem Raum"
Gut: "Wenn ein Smart-Home-Befehl ohne Raumangabe kommt, frage ZUERST in welchem Raum — fuehre den Befehl NICHT ohne Raum aus."

## INLINE-VERIFIKATION

PRUEFFE JEDEN KANDIDATEN bevor du ihn ausgibst:
- Hat der User das selbst gesagt (nicht nur der Assistent)?
- Gilt es auch in 3 Monaten noch?
- Wurde es in Folge-Turns zurueckgenommen?
- Nur bei confidence >= 0.7 aufnehmen.

## OUTPUT

Antworte im vorgegebenen JSON-Schema. Leere Arrays wenn nichts gefunden.
Extrahiere NUR aus der USER-Nachricht in <current>.`;

// PII patterns to filter after parsing
const PII_PHONE = /(\+?\d[\d\s\-().]{6,}\d)/g;
const PII_EMAIL = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function hasPii(text: string): boolean {
  return PII_PHONE.test(text) || PII_EMAIL.test(text);
}

function filterPii<T extends { fact?: string; instruction?: string }>(items: T[]): T[] {
  // Reset regex state after hasPii (stateful lastIndex)
  PII_PHONE.lastIndex = 0;
  PII_EMAIL.lastIndex = 0;
  return items.filter(item => {
    const text = item.fact ?? item.instruction ?? '';
    PII_PHONE.lastIndex = 0;
    PII_EMAIL.lastIndex = 0;
    return !hasPii(text);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Extract facts + behaviors from a conversation window using the Claude Agent SDK
 * with MiniMax M2.7 backend and Structured Output.
 * Replaces separate extractFacts() + extractBehavior() + verifyFactMiniMax() + verifyBehaviorMiniMax() calls.
 */
export async function extractAndVerify(window: ExtractionWindow): Promise<ExtractionResult> {
  const sdkEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
    ANTHROPIC_AUTH_TOKEN: config.minimaxApiKey,
    ANTHROPIC_MODEL: 'MiniMax-M2.7',
    ANTHROPIC_SMALL_FAST_MODEL: 'MiniMax-M2.7',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };

  const cleanedWindow = cleanWindowForBehavior(window);
  const factsPrompt = formatWindowPrompt(window);
  const behaviorPrompt = formatWindowPrompt(cleanedWindow);

  const userPrompt = `<facts_window hint="Analysiere dieses Window fuer Facts">
${factsPrompt}
</facts_window>

<behavior_window hint="Analysiere dieses Window fuer Behaviors (Systemtext bereinigt)">
${behaviorPrompt}
</behavior_window>`;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let structuredOutput: unknown = null;

      for await (const message of query({
        prompt: userPrompt,
        options: {
          systemPrompt: SYSTEM_PROMPT,
          env: sdkEnv,
          maxTurns: 5,  // SDK zählt den Prompt selbst als Turn; 5 gibt genug Puffer
          permissionMode: 'bypassPermissions',
          outputFormat: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
        },
      })) {
        if (message.type === 'result' && message.subtype === 'success') {
          if (message.structured_output !== undefined) {
            structuredOutput = message.structured_output;
          } else if (typeof message.result === 'string') {
            // Fallback: parse result string
            try {
              structuredOutput = JSON.parse(message.result);
            } catch {
              // ignore, will throw below
            }
          }
        } else if (message.type === 'result') {
          // SDKResultError — subtype is one of the error variants
          throw new Error(`SDK error: ${message.subtype}`);
        }
      }

      if (structuredOutput === null) {
        throw new Error('SDK returned no structured output');
      }

      const parsed = structuredOutput as {
        facts: Array<{ fact: string; type: string; confidence: number; sourceContext: string; scope: string }>;
        behaviors: Array<{ instruction: string; confidence: number; sourceContext: string; scope: string }>;
      };

      const facts: ExtractedFact[] = filterPii(
        (parsed.facts ?? []).map(f => ({
          fact: String(f.fact ?? ''),
          type: String(f.type ?? 'personal') as ExtractedFact['type'],
          confidence: Number(f.confidence ?? 0),
          sourceContext: String(f.sourceContext ?? '').slice(0, 100),
          scope: (f.scope === 'household' ? 'household' : 'personal') as 'household' | 'personal',
        })).filter(f => f.fact.length > 0)
      ) as ExtractedFact[];

      const behaviors: ExtractedInstruction[] = filterPii(
        (parsed.behaviors ?? []).map(b => ({
          instruction: String(b.instruction ?? ''),
          confidence: Number(b.confidence ?? 0),
          sourceContext: String(b.sourceContext ?? '').slice(0, 100),
          scope: (b.scope === 'household' ? 'household' : 'personal') as 'household' | 'personal',
        })).filter(b => b.instruction.length > 0)
      ) as ExtractedInstruction[];

      log('debug', 'sdk-extractor', `Turn ${window.turnIndex}: ${facts.length} facts, ${behaviors.length} behaviors`, {
        facts: facts.map(f => `[${f.scope}/${f.type}] ${f.fact}`),
        behaviors: behaviors.map(b => `[${b.scope}] ${b.instruction}`),
      });

      return { facts, behaviors };

    } catch (err) {
      lastError = err as Error;
      if (attempt < 2) {
        const delay = 1000 * Math.pow(2, attempt);
        log('warn', 'sdk-extractor', `Retry ${attempt + 1}/3 after ${delay}ms: ${lastError.message}`);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error('SDK extraction failed after 3 attempts');
}
