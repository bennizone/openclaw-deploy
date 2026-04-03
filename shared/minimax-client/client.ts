import type { MiniMaxClientConfig, MiniMaxChatOptions, MiniMaxChatResult, MiniMaxRemainsInfo } from './types.js';
import { UsageLogger } from './usage-logger.js';

/** Anthropic Messages API response format (MiniMax variant) */
interface AnthropicResponse {
  content: Array<{
    type?: 'text';       // Text blocks have type='text' + text field
    text?: string;       // Present on text blocks
    thinking?: string;   // Present on thinking blocks (no type field)
  }>;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

export class MiniMaxChatClient {
  private apiKey: string;
  private apiHost: string;
  private log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;
  readonly usage: UsageLogger;

  private recentRequests: number[] = [];
  private readonly maxBurstPerSecond = 5;

  constructor(config: MiniMaxClientConfig) {
    this.apiKey = config.apiKey;
    this.apiHost = (config.baseUrl ?? 'https://api.minimax.io').replace(/\/v1\/?$/, '');
    this.log = config.logFn ?? ((level, msg) => process.stderr.write(`[minimax:${level}] ${msg}\n`));
    this.usage = new UsageLogger(config.logFn);
  }

  /** Burst protection — wait if we've sent too many requests recently. */
  private async throttle(): Promise<void> {
    const now = Date.now();
    while (this.recentRequests.length > 0 && now - this.recentRequests[0] >= 1000) {
      this.recentRequests.shift();
    }
    if (this.recentRequests.length >= this.maxBurstPerSecond) {
      const waitMs = 1000 - (now - this.recentRequests[0]);
      if (waitMs > 0) {
        this.log('debug', `Throttle: waiting ${waitMs}ms (burst protection)`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    this.recentRequests.push(now);
  }

  /**
   * Single chat completion via Anthropic Messages API.
   * Uses /anthropic/v1/messages — thinking is returned as separate block,
   * content is clean text without <think> tags.
   */
  async chat(opts: MiniMaxChatOptions): Promise<MiniMaxChatResult> {
    const {
      systemPrompt,
      userPrompt,
      model = 'MiniMax-M2.7',
      maxTokens = 4096,
      temperature = 0.1,
      timeoutMs = 60_000,
      tag = 'unknown',
    } = opts;

    const body = {
      model,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    };

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await this.throttle();

      try {
        const resp = await fetch(`${this.apiHost}/anthropic/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (resp.status === 429) {
          const backoff = Math.min(5000 * Math.pow(2, attempt) + Math.random() * 2000, 60000);
          this.log('warn', `[${tag}] Rate limited (429), retry ${attempt + 1}/${maxRetries} in ${Math.round(backoff / 1000)}s`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        if (resp.status >= 500) {
          const backoff = 1000 * Math.pow(2, attempt);
          this.log('warn', `[${tag}] Server error (${resp.status}), retry ${attempt + 1}/${maxRetries} in ${Math.round(backoff / 1000)}s`);
          await new Promise(r => setTimeout(r, backoff));
          lastError = new Error(`MiniMax server error: ${resp.status}`);
          continue;
        }

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`MiniMax error ${resp.status}: ${text}`);
        }

        const data = (await resp.json()) as AnthropicResponse;

        if (data.error) {
          throw new Error(`MiniMax API error: ${data.error.message}`);
        }

        // Extract text blocks only (skip thinking blocks).
        // MiniMax: text blocks have type='text' + text field, thinking blocks have thinking field only.
        const content = data.content
          .filter(b => b.text !== undefined && !b.thinking)
          .map(b => b.text!)
          .join('\n')
          .trim();

        const usage = data.usage
          ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens }
          : undefined;

        this.usage.record(tag, usage);
        return { content, usage };

      } catch (err) {
        const isTimeout = (err as Error).name === 'TimeoutError'
          || (err as Error).name === 'AbortError'
          || (err as Error).message?.includes('abort');
        if (isTimeout) {
          if (attempt < maxRetries - 1) {
            this.log('warn', `[${tag}] Timeout, retry ${attempt + 1}/${maxRetries} in 2s`);
            await new Promise(r => setTimeout(r, 2000));
            lastError = err as Error;
            continue;
          }
        }
        throw err;
      }
    }

    throw lastError ?? new Error(`MiniMax failed after ${maxRetries} retries`);
  }

  /**
   * Check remaining quota.
   * IMPORTANT: This counts as a request! Only call on-demand, never in automated loops.
   */
  async getRemains(): Promise<MiniMaxRemainsInfo | null> {
    try {
      const resp = await fetch(`${this.apiHost}/v1/coding_plan/remains`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        model_remains: Array<{
          model_name: string;
          current_interval_total_count: number;
          current_interval_usage_count: number;
          end_time: number;
        }>;
      };
      const textModel = data.model_remains.find(m => m.model_name === 'MiniMax-M*');
      if (!textModel) return null;
      return {
        remaining: textModel.current_interval_usage_count,
        total: textModel.current_interval_total_count,
        windowEnd: new Date(textModel.end_time),
      };
    } catch {
      return null;
    }
  }
}
