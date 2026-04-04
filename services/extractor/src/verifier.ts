import { config, log } from './config.js';
import { parseJsonObject } from '@openclaw/minimax-client';
import { getMiniMax } from './lib/minimax.js';
import type { ExtractionWindow } from './window.js';

export interface VerificationResult {
  verified: boolean;
  reason: string;
}


const VERIFIER_PROMPT = `Entscheide ob dieser Fakt dauerhaft und persoenlich ist.

DAUERHAFT = gilt wahrscheinlich auch in 3 Monaten noch.
PERSOENLICH = beschreibt einen Menschen, seine Vorlieben, Beziehungen, sein Zuhause.

Beispiele fuer verified=true:
- "Benni schaut gerne Scrubs" (dauerhafte Vorliebe)
- "Domi hat am 22. April Geburtstag" (dauerhafter Fakt)
- "Im Wohnzimmer steht eine Hue-Lampe" (Haushalt)

Beispiele fuer verified=false:
- "Session hatte 68 Calls" (technisch, einmalig)
- "deploy-checklist braucht Patch" (Arbeitsaufgabe)
- "Benni fragt ob X" (Frage, kein Fakt)
- "Telefonnummer: +49..." (PII, niemals speichern)
- "Error 4: API Endpoint falsch" (Bug, einmalig)

Pruefe auch: Hat der USER das selbst gesagt? Hat er es in Folge-Turns zurueckgenommen?

Antwort als JSON-Objekt (NICHTS anderes):
{"verified": true, "reason": "dauerhafte Vorliebe"}
oder
{"verified": false, "reason": "technisch"}`;

function buildVerifierUserPrompt(fact: string, window: ExtractionWindow): string {
  const userName = window.agentDisplayName;
  let prompt = `Der User in dieser Konversation heisst "${userName}".\n\n`;
  prompt += `Behaupteter Fakt: "${fact}"\n\nKonversation:\n`;

  for (const t of window.context) {
    prompt += `${userName}: ${t.userText}\nAssistent: ${t.assistantText}\n\n`;
  }

  prompt += `>>> AKTUELLER TURN:\n${userName}: ${window.current.userText}\nAssistent: ${window.current.assistantText}\n\n`;

  for (const t of window.followup) {
    prompt += `${userName}: ${t.userText}\nAssistent: ${t.assistantText}\n\n`;
  }

  prompt += `\nIst aus dieser Konversation SICHER ableitbar, dass dieser Fakt stimmt?`;
  return prompt;
}

function parseVerifierResponse(raw: string): VerificationResult {
  const obj = parseJsonObject<{ verified: boolean; reason: string }>(raw);
  if (obj) {
    return {
      verified: Boolean(obj.verified),
      reason: String(obj.reason ?? 'no_reason'),
    };
  }

  // Fallback: If JSON parsing fails, treat as rejected (conservative).
  // Anthropic API should always return clean text, so this is a safety net.
  if (raw.trim().length > 20) {
    return { verified: false, reason: raw.trim().slice(0, 200) };
  }
  return { verified: false, reason: 'unparseable_response' };
}

export async function verifyFact(
  fact: string,
  window: ExtractionWindow,
  overrideUrl?: string,
  overrideModel?: string,
): Promise<VerificationResult> {
  const url = overrideUrl ?? config.verifierUrl;
  const model = overrideModel ?? config.verifierModel;

  try {
    const resp = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: VERIFIER_PROMPT },
          { role: 'user', content: buildVerifierUserPrompt(fact, window) },
        ],
        max_tokens: 8192,
        temperature: 0.1,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const body = await resp.text();
      log('warn', 'verifier', `${url} returned ${resp.status}: ${body.slice(0, 200)}`);
      return { verified: false, reason: `http_${resp.status}` };
    }

    const data = (await resp.json()) as { choices: { message: { content: string } }[] };
    return parseVerifierResponse(data.choices[0].message.content);
  } catch (err) {
    log('warn', 'verifier', `Verification failed: ${(err as Error).message}`);
    return { verified: false, reason: `error: ${(err as Error).message}` };
  }
}

/**
 * Verify a fact using Qwen WITH thinking enabled (for benchmark comparison).
 */
export async function verifyFactQwenThink(
  fact: string,
  window: ExtractionWindow,
): Promise<VerificationResult> {
  const url = config.verifierUrl;
  const model = config.verifierModel;

  try {
    const resp = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: VERIFIER_PROMPT },
          { role: 'user', content: buildVerifierUserPrompt(fact, window) },
        ],
        max_tokens: 8192,
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      return { verified: false, reason: `qwen_think_http_${resp.status}` };
    }

    const data = (await resp.json()) as { choices: { message: { content: string } }[] };
    return parseVerifierResponse(data.choices[0].message.content);
  } catch (err) {
    return { verified: false, reason: `qwen_think_error: ${(err as Error).message}` };
  }
}

const BEHAVIOR_VERIFIER_PROMPT = `Entscheide ob diese Anweisung eine DAUERHAFTE Verhaltensregel ist.

DAUERHAFT = der User erwartet dass der Assistent sich auch in zukuenftigen Gespraechen daran haelt.

Beispiele fuer verified=true:
- "Antworte mir auf Deutsch" (dauerhafte Sprachregel)
- "Such immer zuerst in Deutschland" (dauerhafte Praeferenz)
- "Frag immer erst nach dem Raum" (dauerhafte Arbeitsregel)

Beispiele fuer verified=false:
- "Analysiere diese Datei" (einmaliger Auftrag)
- "Kannst du mal X recherchieren?" (einmalige Bitte)
- "Erstelle eine Patch-Tabelle" (einmaliger Arbeitsauftrag)

Pruefe auch: Hat der USER die Anweisung selbst gegeben? Wurde sie zurueckgenommen?

Antwort als JSON-Objekt (NICHTS anderes):
{"verified": true, "reason": "dauerhafte Regel"}
oder
{"verified": false, "reason": "einmaliger Auftrag"}`;

function buildBehaviorVerifierUserPrompt(instruction: string, sourceContext: string, window: ExtractionWindow): string {
  const userName = window.agentDisplayName;
  let prompt = `Der User in dieser Konversation heisst "${userName}".\n\n`;
  prompt += `Behauptete Anweisung: "${instruction}"\n`;
  prompt += `Originalzitat: "${sourceContext}"\n\nKonversation:\n`;

  for (const t of window.context) {
    prompt += `${userName}: ${t.userText}\nAssistent: ${t.assistantText}\n\n`;
  }

  prompt += `>>> AKTUELLER TURN:\n${userName}: ${window.current.userText}\nAssistent: ${window.current.assistantText}\n\n`;

  for (const t of window.followup) {
    prompt += `${userName}: ${t.userText}\nAssistent: ${t.assistantText}\n\n`;
  }

  prompt += `\nIst aus dieser Konversation SICHER ableitbar, dass diese Anweisung eine dauerhafte Verhaltensregel ist?`;
  return prompt;
}

/**
 * Verify a behavioral instruction using MiniMax (shared client with retry + throttling).
 */
export async function verifyBehaviorMiniMax(
  instruction: string,
  sourceContext: string,
  window: ExtractionWindow,
): Promise<VerificationResult> {
  try {
    const result = await getMiniMax().chat({
      systemPrompt: BEHAVIOR_VERIFIER_PROMPT,
      userPrompt: buildBehaviorVerifierUserPrompt(instruction, sourceContext, window),
      maxTokens: 8192,
      temperature: 0.1,
      tag: 'behavior-verifier',
      timeoutMs: 30_000,
    });
    return parseVerifierResponse(result.content);
  } catch (err) {
    return { verified: false, reason: `minimax_behavior_error: ${(err as Error).message}` };
  }
}

/**
 * Verify a fact using MiniMax (shared client with retry + throttling).
 */
export async function verifyFactMiniMax(
  fact: string,
  window: ExtractionWindow,
): Promise<VerificationResult> {
  try {
    const result = await getMiniMax().chat({
      systemPrompt: VERIFIER_PROMPT,
      userPrompt: buildVerifierUserPrompt(fact, window),
      maxTokens: 8192,
      temperature: 0.1,
      tag: 'fact-verifier',
      timeoutMs: 30_000,
    });
    return parseVerifierResponse(result.content);
  } catch (err) {
    return { verified: false, reason: `minimax_error: ${(err as Error).message}` };
  }
}
