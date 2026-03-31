import type { MiniMaxSearchResponse, MiniMaxVLMResponse, SearchResult } from "../lib/types.js";

const log = (msg: string) => process.stderr.write(`[minimax] ${msg}\n`);

export class MiniMaxClient {
  private apiKey: string;
  private apiHost: string;

  constructor() {
    this.apiKey = process.env.MINIMAX_API_KEY ?? "";
    this.apiHost = process.env.MINIMAX_API_HOST ?? "https://api.minimax.io";
    if (!this.apiKey) {
      log("WARNING: MINIMAX_API_KEY not set — MiniMax features disabled");
    }
  }

  get available(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, maxResults: number): Promise<{ results: SearchResult[]; related: string[] }> {
    if (!this.available) return { results: [], related: [] };

    try {
      const res = await fetch(`${this.apiHost}/v1/coding_plan/search`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "MM-API-Source": "OpenClaw-Tools",
        },
        body: JSON.stringify({ q: query }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        log(`Search HTTP ${res.status}: ${res.statusText}`);
        return { results: [], related: [] };
      }

      const data = (await res.json()) as MiniMaxSearchResponse;

      if (data.base_resp && data.base_resp.status_code !== 0) {
        log(`Search API error: ${data.base_resp.status_code} — ${data.base_resp.status_msg}`);
        return { results: [], related: [] };
      }

      const results: SearchResult[] = (data.organic ?? []).slice(0, maxResults).map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
        source: "minimax" as const,
        date: r.date,
      }));

      const related = (data.related_searches ?? []).map((r) => r.query);

      return { results, related };
    } catch (err) {
      log(`Search error: ${err instanceof Error ? err.message : String(err)}`);
      return { results: [], related: [] };
    }
  }

  async analyzeImage(prompt: string, imageBase64: string): Promise<string> {
    if (!this.available) throw new Error("MINIMAX_API_KEY not configured");

    const res = await fetch(`${this.apiHost}/v1/coding_plan/vlm`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "MM-API-Source": "OpenClaw-Tools",
      },
      body: JSON.stringify({ prompt, image_url: imageBase64 }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`VLM HTTP ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as MiniMaxVLMResponse;

    if (data.base_resp && data.base_resp.status_code !== 0) {
      throw new Error(`VLM API error: ${data.base_resp.status_code} — ${data.base_resp.status_msg}`);
    }

    if (!data.content) {
      throw new Error("VLM returned empty content");
    }

    return data.content;
  }
}
