import { config, log } from './config.js';
import { MiniMaxChatClient, parseJsonArray, stripThinkTags } from '@openclaw/minimax-client';
import type { ExtractionWindow } from './window.js';
import { formatWindowPrompt } from './window.js';

export interface ExtractedFact {
  fact: string;
  type: 'preference' | 'personal' | 'decision' | 'correction' | 'project' | 'deadline';
  confidence: number;
  sourceContext: string;
  scope?: 'personal' | 'household';
}

const SYSTEM_PROMPT = `Du extrahierst dauerhafte Fakten ueber Personen und deren Umgebung aus Konversationen.

AUFBAU DES PROMPTS:
- <known_facts>: Bereits gespeicherte Fakten. Vermeide Duplikate, erkenne Widersprueche.
- <context>: Vorherige Turns — nur zum Verstaendnis. NICHT daraus extrahieren.
- <current>: Der aktuelle Turn — extrahiere NUR aus der USER-Nachricht.
  Die Assistenten-Antwort dient nur als Kontext.
- <followup>: Folge-Turns — pruefen ob der User sich korrigiert hat.

WAS EXTRAHIEREN:
- Persoenliche Fakten: Name, Beruf, Arbeitgeber, Familie, Wohnort, Hobbys, Haustiere
- Praeferenzen: Mag/mag nicht, bevorzugt X ueber Y
- Beziehungen: "mein Bruder", "meine Partnerin", "Kollege X"
- Entscheidungen: "wir machen ab jetzt X", "ich will Y"
- Haushalt: Smart-Home-Regeln, Raeume, gemeinsame Praeferenzen
- Fakten ueber ANDERE Personen die der User erwaehnt ("Domi arbeitet bei...")
- User BESTAETIGT eine Aussage des Assistenten ("ja genau", "perfekt", "stimmt")
- User KORRIGIERT einen bekannten Fakt ("nein, nicht X sondern Y")

NICHT EXTRAHIEREN:
- Alles was NUR der Assistent sagt ohne User-Bestaetigung
- Momentane Geraetezustaende, Sensorwerte, Temperaturen, "Licht ist an/aus"
- API-Infos, Fehlermeldungen, technische Debug-Details, IP-Adressen
- Reine Fragen ohne Informationsgehalt ("wie warm ist es?")
- Smalltalk, momentane Befindlichkeiten ohne dauerhaften Wert
- Bereits in <known_facts> vorhandene Fakten (ausser Korrektur oder wesentliche Ergaenzung)

KORREKTUREN: Wenn der User in <followup> seine eigene Aussage zuruecknimmt oder korrigiert
→ als type "correction" die korrigierte Version formulieren (die neue Wahrheit, nicht die alte).

SCOPE:
- "personal" — betrifft eine bestimmte Person
- "household" — betrifft Haushalt, Wohnung, mehrere Bewohner, Smart-Home

Antworte AUSSCHLIESSLICH mit einem JSON-Array. Kein Markdown, keine Erklaerungen.

Format:
[
  {
    "fact": "Benni arbeitet als Software-Entwickler bei Stackblitz",
    "type": "preference|personal|decision|correction|project|deadline",
    "confidence": 0.0-1.0,
    "sourceContext": "kurzes Originalzitat max 100 Zeichen",
    "scope": "personal|household"
  }
]

Verwende den Namen der Person im Fact wenn bekannt.
Wenn keine extrahierbaren Fakten: leeres Array [].
Sprache: Deutsch wenn Konversation Deutsch ist.`;

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
        maxTokens: 2000,
        temperature: 0.1,
        tag: 'extractor',
      });
      const parsed = parseJsonArray<Record<string, unknown>>(stripThinkTags(result.content));
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
