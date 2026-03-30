import { config, log } from './config.js';
import type { ExtractionWindow } from './window.js';
import { formatWindowPrompt } from './window.js';

export interface ExtractedFact {
  fact: string;
  type: 'preference' | 'personal' | 'decision' | 'correction' | 'project' | 'deadline';
  confidence: number;
  sourceContext: string;
  scope?: 'personal' | 'household';
}

const SYSTEM_PROMPT = `Du extrahierst dauerhafte Fakten aus Konversationen.

AUFBAU DES PROMPTS:
- <known_facts>: Bereits gespeicherte Fakten. Vermeide Duplikate, erkenne Widersprueche.
- <context>: Vorherige Turns — nur zum Verstaendnis. NICHT daraus extrahieren.
- <current>: Der aktuelle Turn — extrahiere NUR aus der USER-Nachricht.
  Die Assistenten-Antwort dient nur als Kontext um zu verstehen worauf sich der User bezieht.
- <followup>: Folge-Turns — pruefen ob der User sich selbst korrigiert hat.

EXTRAHIERE NUR wenn EINE dieser Bedingungen erfuellt ist:
- User sagt es EXPLIZIT ("ich mag...", "wir wollen...", "ab jetzt...", "bei uns ist...")
- User BESTAETIGT eine Aussage des Assistenten ("ja genau", "perfekt", "stimmt", "genau so")
- User KORRIGIERT einen bekannten Fakt ("nein, nicht X sondern Y")

NICHT extrahieren:
- Alles was NUR der Assistent sagt ohne User-Bestaetigung
- Geraetezustaende, Sensorwerte, Entity-Status, Helligkeiten, Temperaturen
- API-Infos, Fehlermeldungen, technische Debug-Details, IP-Adressen
- Smalltalk, reine Fragen, momentane Befindlichkeiten
- Etwas das in <known_facts> schon vorhanden ist (ausser Korrektur oder wesentliche Ergaenzung)

Im Zweifel: NICHT extrahieren. Lieber einen Fakt verpassen als Muell speichern.

KORREKTUREN: Wenn der User in <followup> seine eigene Aussage zuruecknimmt, korrigiert
oder einschraenkt → nicht extrahieren oder als type "correction" die korrigierte Version formulieren.

Bestimme fuer jeden Fakt den SCOPE:
- "personal" — betrifft eindeutig nur die sprechende Person
- "household" — betrifft Haushalt, Wohnung, oder mehrere Bewohner
  (Smart-Home, Raeume, gemeinsame Praeferenzen = fast immer household)

Antworte AUSSCHLIESSLICH mit einem JSON-Array. Kein Markdown, keine Erklaerungen.

Format:
[
  {
    "fact": "Benni bevorzugt abends warmweisses Licht",
    "type": "preference|personal|decision|correction|project|deadline",
    "confidence": 0.0-1.0,
    "sourceContext": "kurzes Originalzitat max 100 Zeichen",
    "scope": "personal|household"
  }
]

Bei Korrekturen: das KORRIGIERTE Faktum formulieren (die neue Wahrheit, nicht die alte).
Verwende den Namen der Person im Fact wenn bekannt.
Wenn keine extrahierbaren Fakten: leeres Array [].
Sprache: Deutsch wenn Konversation Deutsch ist.`;

interface OpenAIResponse {
  choices: { message: { content: string } }[];
}

async function callMiniMaxWithPrompt(userPrompt: string, systemPrompt: string): Promise<string> {
  const body = {
    model: config.extractionModel,
    messages: [
      { role: 'system', content: systemPrompt },
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
    log('warn', 'extractor', 'Rate limited (429), waiting 60s...');
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
    const body = await resp.text();
    throw new Error(`MiniMax error ${resp.status}: ${body}`);
  }

  const data = (await resp.json()) as OpenAIResponse;
  return data.choices[0].message.content;
}

async function callMiniMax(userPrompt: string): Promise<string> {
  return callMiniMaxWithPrompt(userPrompt, SYSTEM_PROMPT);
}

function stripThinkTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

function parseFactsJson(raw: string): ExtractedFact[] {
  const cleaned = stripThinkTags(raw);

  // Try to find JSON array in the response
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
      const raw = await callMiniMax(prompt);
      const facts = parseFactsJson(raw);
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
