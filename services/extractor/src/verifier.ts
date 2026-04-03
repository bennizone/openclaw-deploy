import { config, log } from './config.js';
import { MiniMaxChatClient, parseJsonObject } from '@openclaw/minimax-client';
import type { ExtractionWindow } from './window.js';

export interface VerificationResult {
  verified: boolean;
  reason: string;
}

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

const VERIFIER_PROMPT = `Du bist ein kritischer Faktenpruefer. Dir wird ein angeblicher Fakt und die zugehoerige Konversation gezeigt.

Pruefe kritisch:
1. Hat der USER das selbst gesagt oder explizit bestaetigt? (Assistenten-Aussagen allein reichen NICHT)
2. Ist es ein DAUERHAFTER Fakt oder ein momentaner Zustand? (Geraetezustaende, Sensorwerte, "ist an/aus" = NEIN)
3. Hat der User das in den Folge-Turns zurueckgenommen oder relativiert?

Antworte mit genau einem JSON-Objekt, NICHTS anderes:
{"verified": true, "reason": "kurze Begruendung"}
oder
{"verified": false, "reason": "kurze Begruendung"}`;

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

  // Fallback: MiniMax sometimes responds with plain text instead of JSON.
  // Try to infer verification from text content.
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim().toLowerCase();
  if (cleaned.includes('"verified": true') || cleaned.includes('"verified":true')) {
    return { verified: true, reason: 'parsed_from_text' };
  }
  if (cleaned.includes('ja') && !cleaned.includes('nein') && cleaned.length < 500) {
    return { verified: true, reason: 'inferred_yes' };
  }
  // If the response is a detailed rejection reason (not JSON), treat as rejected with the reason
  if (cleaned.length > 20) {
    return { verified: false, reason: cleaned.slice(0, 200) };
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

const BEHAVIOR_VERIFIER_PROMPT = `Du bist ein kritischer Pruefer fuer Verhaltensanweisungen. Dir wird eine angebliche Anweisung und die zugehoerige Konversation gezeigt.

Pruefe kritisch:
1. Hat der USER diese Anweisung SELBST gegeben? (Assistenten-Vorschlaege allein reichen NICHT)
2. Ist es eine DAUERHAFTE Arbeitsregel oder eine einmalige Bitte?
3. Hat der User die Anweisung in Folge-Turns zurueckgenommen?
4. Wuerde der User erwarten dass diese Regel auch in ZUKUENFTIGEN Gespraechen gilt?

Antworte mit genau einem JSON-Objekt, NICHTS anderes:
{"verified": true, "reason": "kurze Begruendung"}
oder
{"verified": false, "reason": "kurze Begruendung"}`;

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
      maxTokens: 500,
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
      maxTokens: 500,
      temperature: 0.1,
      tag: 'fact-verifier',
      timeoutMs: 30_000,
    });
    return parseVerifierResponse(result.content);
  } catch (err) {
    return { verified: false, reason: `minimax_error: ${(err as Error).message}` };
  }
}
