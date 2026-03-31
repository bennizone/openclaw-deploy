import { search, SafeSearchType } from "duck-duck-scrape";
import type { SearchResult } from "../lib/types.js";

const log = (msg: string) => process.stderr.write(`[ddg] ${msg}\n`);

export async function searchDDG(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const response = await Promise.race([
      search(query, { safeSearch: SafeSearchType.MODERATE }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DDG timeout")), 8_000)
      ),
    ]);

    return (response.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      source: "ddg" as const,
    }));
  } catch (err) {
    log(`Search error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
