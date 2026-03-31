import type { SearchResult } from "./types.js";

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function mergeResults(
  minimax: SearchResult[],
  ddg: SearchResult[],
  maxTotal: number
): SearchResult[] {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  // MiniMax first (paid, typically higher quality)
  for (const r of minimax) {
    if (merged.length >= maxTotal) break;
    const key = normalizeUrl(r.url);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  // DDG fills remaining slots
  for (const r of ddg) {
    if (merged.length >= maxTotal) break;
    const key = normalizeUrl(r.url);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  return merged;
}
