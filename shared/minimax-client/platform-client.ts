import type { MiniMaxPlatformConfig, SearchResult } from './types.js';

interface MiniMaxSearchResponse {
  organic?: Array<{ title: string; link: string; snippet: string; date?: string }>;
  related_searches?: Array<{ query: string }>;
  base_resp?: { status_code: number; status_msg?: string };
}

interface MiniMaxVLMResponse {
  content?: string;
  base_resp?: { status_code: number; status_msg?: string };
}

export class MiniMaxPlatformClient {
  private apiKey: string;
  private apiHost: string;
  private log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;

  constructor(config: MiniMaxPlatformConfig) {
    this.apiKey = config.apiKey;
    this.apiHost = config.apiHost ?? 'https://api.minimax.io';
    this.log = config.logFn ?? ((level, msg) => process.stderr.write(`[minimax-platform:${level}] ${msg}\n`));
  }

  get available(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, maxResults: number): Promise<{ results: SearchResult[]; related: string[] }> {
    if (!this.available) return { results: [], related: [] };

    try {
      const res = await fetch(`${this.apiHost}/v1/coding_plan/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'MM-API-Source': 'OpenClaw-Tools',
        },
        body: JSON.stringify({ q: query }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this.log('warn', `Search HTTP ${res.status}: ${res.statusText}`);
        return { results: [], related: [] };
      }

      const data = (await res.json()) as MiniMaxSearchResponse;
      if (data.base_resp && data.base_resp.status_code !== 0) {
        this.log('warn', `Search API error: ${data.base_resp.status_code} — ${data.base_resp.status_msg}`);
        return { results: [], related: [] };
      }

      const results: SearchResult[] = (data.organic ?? []).slice(0, maxResults).map(r => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
        source: 'minimax' as const,
        date: r.date,
      }));

      const related = (data.related_searches ?? []).map(r => r.query);
      return { results, related };
    } catch (err) {
      this.log('warn', `Search error: ${err instanceof Error ? err.message : String(err)}`);
      return { results: [], related: [] };
    }
  }

  async analyzeImage(prompt: string, imageBase64: string): Promise<string> {
    if (!this.available) throw new Error('MINIMAX_API_KEY not configured');

    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.apiHost}/v1/coding_plan/vlm`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'MM-API-Source': 'OpenClaw-Tools',
          },
          body: JSON.stringify({ prompt, image_url: imageBase64 }),
          signal: AbortSignal.timeout(30_000),
        });

        if (res.status >= 500 && attempt < maxRetries - 1) {
          this.log('warn', `VLM server error (${res.status}), retry in 2s`);
          await new Promise(r => setTimeout(r, 2000));
          lastError = new Error(`VLM HTTP ${res.status}: ${res.statusText}`);
          continue;
        }

        if (!res.ok) {
          throw new Error(`VLM HTTP ${res.status}: ${res.statusText}`);
        }

        const data = (await res.json()) as MiniMaxVLMResponse;
        if (data.base_resp && data.base_resp.status_code !== 0) {
          throw new Error(`VLM API error: ${data.base_resp.status_code} — ${data.base_resp.status_msg}`);
        }

        if (!data.content) {
          throw new Error('VLM returned empty content');
        }

        return data.content;
      } catch (err) {
        const isTimeout = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
        if (isTimeout && attempt < maxRetries - 1) {
          this.log('warn', 'VLM timeout, retry in 2s');
          await new Promise(r => setTimeout(r, 2000));
          lastError = err as Error;
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? new Error('VLM failed after retries');
  }
}
