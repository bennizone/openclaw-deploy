import { config, log } from './config.js';
import { MiniMaxChatClient, parseJsonArray } from '@openclaw/minimax-client';
import type { ExtractionWindow } from './window.js';
import { formatWindowPrompt } from './window.js';

export interface ExtractedFact {
  fact: string;
  type: 'preference' | 'personal' | 'decision' | 'correction' | 'project' | 'deadline';
  confidence: number;
  sourceContext: string;
  scope?: 'personal' | 'household';
}

const SYSTEM_PROMPT = `Du extrahierst dauerhafte Fakten ueber Personen aus Konversationen.
Extrahiere lieber etwas zu viel als zu wenig — ein separater Verifier prueft danach.

AUFBAU DES PROMPTS:
- <known_facts>: Bereits gespeicherte Fakten. Vermeide Duplikate, erkenne Widersprueche.
- <context>: Vorherige Turns — nur zum Verstaendnis. NICHT daraus extrahieren.
- <current>: Der aktuelle Turn — extrahiere NUR aus der USER-Nachricht.
- <followup>: Folge-Turns — pruefen ob der User sich korrigiert hat.

EXTRAHIEREN:
- Wer ist die Person: Name, Beruf, Familie, Wohnort, Hobbys, Haustiere, Geburtstage
- Beziehungen: "mein Bruder heisst X", "Domi hat am 22. April Geburtstag"
- Praeferenzen: "ich mag X", "ich schaue Y auf Z", "ich bevorzuge A ueber B"
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

Antworte AUSSCHLIESSLICH mit einem JSON-Array:
[{"fact": "Benni schaut Scrubs auf Disney+", "type": "preference", "confidence": 0.9, "sourceContext": "ich schaue gerade Scrubs", "scope": "personal"}]

Types: personal, preference, decision, correction. Scope: personal oder household.
Verwende den Namen der Person im Fact wenn bekannt.
Wenn keine Fakten: []. Sprache: Deutsch.`;

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

function validateFacts(parsed: Record<string, unknown>[]): ExtractedFact[] {
  return parsed.map(item => ({
    fact: String(item.fact ?? ''),
    type: String(item.type ?? 'personal') as ExtractedFact['type'],
    confidence: Number(item.confidence ?? 0.5),
    sourceContext: String(item.sourceContext ?? '').slice(0, 100),
    scope: (item.scope === 'household' ? 'household' : 'personal') as 'household' | 'personal',
  })).filter(f => f.fact.length > 0);
}

/**
 * Extract facts from a window with exponential retry for 5xx errors.
 */
export async function extractFacts(window: ExtractionWindow): Promise<ExtractedFact[]> {
  const prompt = formatWindowPrompt(window);

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await getMiniMax().chat({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        maxTokens: 8192,
        temperature: 0.1,
        tag: 'extractor',
      });
      const parsed = parseJsonArray<Record<string, unknown>>(result.content);
      const facts = validateFacts(parsed);
      log('debug', 'extractor', `Extracted ${facts.length} facts from turn ${window.turnIndex}`, {
        facts: facts.map(f => `[${f.scope}/${f.type}] ${f.fact}`),
      });
      return facts;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('server error') && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        log('warn', 'extractor', `Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${msg}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (msg.includes('server error') || msg.includes('MiniMax error')) {
        log('error', 'extractor', `MiniMax failed after ${attempt + 1} attempts: ${msg}`);
        throw new Error(`MiniMax unavailable: ${msg}`);
      }
      // JSON parse error — log and return empty
      log('warn', 'extractor', `Parse error on turn ${window.turnIndex}: ${msg}`);
      return [];
    }
  }

  return [];
}
