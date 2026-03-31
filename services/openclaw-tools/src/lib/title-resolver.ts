import type { MiniMaxClient } from "../clients/minimax.js";
import type { SonarrSeries, RadarrMovie } from "./types.js";
import { searchDDG } from "../clients/duckduckgo.js";
import { mergeResults } from "./merge.js";

const log = (msg: string) => process.stderr.write(`[title-resolver] ${msg}\n`);

/**
 * Stufe 2: Search the local library by alternative titles.
 * Sonarr/Radarr return alternativeTitles in library responses but do NOT
 * search them in lookup endpoints. This function does a case-insensitive
 * match against all alternative titles.
 */
export function searchSeriesLibraryByAltTitle(
  query: string,
  library: SonarrSeries[]
): SonarrSeries[] {
  const q = query.toLowerCase();
  return library.filter((s) => {
    if (s.title.toLowerCase().includes(q)) return true;
    return s.alternateTitles?.some((alt) => alt.title.toLowerCase().includes(q)) ?? false;
  });
}

export function searchMovieLibraryByAltTitle(
  query: string,
  library: RadarrMovie[]
): RadarrMovie[] {
  const q = query.toLowerCase();
  return library.filter((m) => {
    if (m.title.toLowerCase().includes(q)) return true;
    return m.alternateTitles?.some((alt) => alt.title.toLowerCase().includes(q)) ?? false;
  });
}

/**
 * Stufe 3: Resolve a (possibly German) title to an English title via web search.
 * Uses the existing DDG + MiniMax combined search to find the TMDB page,
 * then extracts the English title from the page title.
 *
 * TMDB page titles follow the pattern: "Title (Year) — The Movie Database (TMDB)"
 */
export async function resolveTitle(
  query: string,
  minimax: MiniMaxClient
): Promise<string | null> {
  try {
    const searchQuery = `${query} site:themoviedb.org`;
    const perSource = 5;

    const [mmResult, ddgResult] = await Promise.allSettled([
      minimax.search(searchQuery, perSource),
      searchDDG(searchQuery, perSource),
    ]);

    const mmData = mmResult.status === "fulfilled" ? mmResult.value.results : [];
    const ddgData = ddgResult.status === "fulfilled" ? ddgResult.value : [];
    const merged = mergeResults(mmData, ddgData, 5);

    // Look for a TMDB result (movie or TV page)
    const tmdbResult = merged.find(
      (r) => r.url.includes("themoviedb.org/movie/") || r.url.includes("themoviedb.org/tv/")
    );

    if (!tmdbResult) {
      log(`No TMDB result found for "${query}"`);
      return null;
    }

    // Extract title from TMDB page title format: "Title (Year) — The Movie Database (TMDB)"
    // Also handles: "Title (Year) - The Movie Database" and variations
    const titleMatch = tmdbResult.title.match(/^(.+?)\s*\(\d{4}\)/);
    if (titleMatch) {
      const resolved = titleMatch[1].trim();
      if (resolved.toLowerCase() !== query.toLowerCase()) {
        log(`Resolved "${query}" → "${resolved}"`);
        return resolved;
      }
    }

    // Fallback: try to extract from URL slug
    // e.g., https://www.themoviedb.org/tv/456-the-simpsons → "the simpsons"
    const slugMatch = tmdbResult.url.match(/themoviedb\.org\/(?:movie|tv)\/\d+-(.+?)(?:\?|\/|$)/);
    if (slugMatch) {
      const slug = slugMatch[1].replace(/-/g, " ");
      if (slug.toLowerCase() !== query.toLowerCase()) {
        log(`Resolved "${query}" → "${slug}" (from URL slug)`);
        return slug;
      }
    }

    return null;
  } catch (err) {
    log(`Resolution failed for "${query}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
