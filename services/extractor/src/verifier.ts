import { config, log } from './config.js';
import type { ExtractionWindow } from './window.js';

export interface VerificationResult {
  verified: boolean;
  reason: string;
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
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Find JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    return { verified: false, reason: 'unparseable_response' };
  }

  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    return {
      verified: Boolean(obj.verified),
      reason: String(obj.reason ?? 'no_reason'),
    };
  } catch {
    return { verified: false, reason: 'json_parse_error' };
  }
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
        // No chat_template_kwargs → thinking enabled by default
      }),
      signal: AbortSignal.timeout(60000), // thinking takes longer
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

/**
 * Verify a fact using MiniMax API.
 */
export async function verifyFactMiniMax(
  fact: string,
  window: ExtractionWindow,
  _retryCount: number = 0,
): Promise<VerificationResult> {
  try {
    const resp = await fetch(`${config.minimaxBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.minimaxApiKey}`,
      },
      body: JSON.stringify({
        model: config.extractionModel,
        messages: [
          { role: 'system', content: VERIFIER_PROMPT },
          { role: 'user', content: buildVerifierUserPrompt(fact, window) },
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (resp.status === 429 && _retryCount < 2) {
      log('warn', 'verifier', `MiniMax rate limited, waiting 60s (retry ${_retryCount + 1}/2)...`);
      await new Promise(r => setTimeout(r, 60000));
      return verifyFactMiniMax(fact, window, _retryCount + 1);
    }

    if (!resp.ok) {
      return { verified: false, reason: `minimax_http_${resp.status}` };
    }

    const data = (await resp.json()) as { choices: { message: { content: string } }[] };
    return parseVerifierResponse(data.choices[0].message.content);
  } catch (err) {
    return { verified: false, reason: `minimax_error: ${(err as Error).message}` };
  }
}
