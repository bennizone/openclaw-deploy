import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MiniMaxClient } from "../clients/minimax.js";
import type { SonarrClient } from "../clients/sonarr.js";
import type { RadarrClient } from "../clients/radarr.js";
import type { SonarrSeries, RadarrMovie } from "../lib/types.js";
import {
  resolveTitle,
  searchSeriesLibraryByAltTitle,
  searchMovieLibraryByAltTitle,
} from "../lib/title-resolver.js";

const log = (msg: string) => process.stderr.write(`[arr] ${msg}\n`);

export function registerArr(
  server: McpServer,
  sonarr: SonarrClient,
  radarr: RadarrClient,
  minimax: MiniMaxClient
): void {
  // -----------------------------------------------------------------------
  // arr_search — 3-stage search with German title resolution
  // -----------------------------------------------------------------------
  server.registerTool(
    "arr_search",
    {
      title: "Media Search",
      description:
        "Search for a movie or TV series by name. Supports German titles " +
        "(auto-resolves to English via library alternative titles or web search). " +
        "Returns matching results with titles, years, overviews, and library status.",
      inputSchema: {
        query: z.string().describe("Search term (movie or series title, any language)"),
        type: z
          .enum(["movie", "series", "both"])
          .optional()
          .default("both")
          .describe("Search type: movie, series, or both (default: both)"),
      },
    },
    async ({ query, type }) => {
      try {
        if (!sonarr.available && !radarr.available) {
          return { content: [{ type: "text" as const, text: "Neither Sonarr nor Radarr is configured." }], isError: true };
        }

        const results = await doSearch(query, type, sonarr, radarr, minimax);
        return { content: [{ type: "text" as const, text: results }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Search failed: ${msg}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // arr_add_movie
  // -----------------------------------------------------------------------
  server.registerTool(
    "arr_add_movie",
    {
      title: "Add Movie",
      description:
        "Add a movie to the library and start downloading. Uses configured quality profile. " +
        "Returns collection info if the movie belongs to a collection.",
      inputSchema: {
        tmdbId: z.number().int().describe("TMDB ID of the movie"),
        title: z.string().optional().describe("Movie title for confirmation"),
      },
    },
    async ({ tmdbId, title }) => {
      try {
        if (!radarr.available) {
          return { content: [{ type: "text" as const, text: "Radarr is not configured." }], isError: true };
        }

        const library = await radarr.getLibrary();
        const existing = library.find((m) => m.tmdbId === tmdbId);
        if (existing) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                alreadyInLibrary: true,
                title: existing.title,
                year: existing.year,
                monitored: existing.monitored,
                hasFile: existing.hasFile,
              }, null, 2),
            }],
          };
        }

        const lookupResults = await radarr.lookupMovie(`tmdb:${tmdbId}`);
        const movieData = lookupResults[0];
        if (!movieData) {
          return { content: [{ type: "text" as const, text: `Movie with tmdbId ${tmdbId} not found.` }], isError: true };
        }

        const defaults = await radarr.resolveDefaults();
        const added = await radarr.addMovie({
          tmdbId: movieData.tmdbId,
          title: movieData.title,
          qualityProfileId: defaults.qualityProfileId,
          rootFolderPath: defaults.rootFolderPath,
          monitored: true,
          minimumAvailability: "announced",
          addOptions: { searchForMovie: true },
        });

        const result: Record<string, unknown> = {
          success: true,
          title: added.title,
          year: added.year ?? movieData.year,
          searching: true,
        };

        // Check for collection
        if (movieData.collection) {
          try {
            const collections = await radarr.getCollections();
            const col = collections.find((c) => c.tmdbId === movieData.collection!.tmdbId);
            if (col) {
              const missingMovies = col.movies
                .filter((cm) => !library.find((lm) => lm.tmdbId === cm.tmdbId) && cm.tmdbId !== tmdbId)
                .map((cm) => ({ title: cm.title, year: cm.year, tmdbId: cm.tmdbId }));

              result.collection = {
                name: col.title,
                tmdbId: col.tmdbId,
                totalMovies: col.movies.length,
                missingMovies,
                missingCount: missingMovies.length,
              };
            }
          } catch {
            // Collection lookup failed, not critical
          }
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Failed to add movie: ${msg}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // arr_add_series
  // -----------------------------------------------------------------------
  server.registerTool(
    "arr_add_series",
    {
      title: "Add Series",
      description:
        "Add a TV series to the library and start downloading. " +
        "Uses configured quality profile. Monitors all seasons.",
      inputSchema: {
        tvdbId: z.number().int().describe("TVDB ID of the series"),
        title: z.string().optional().describe("Series title for confirmation"),
      },
    },
    async ({ tvdbId }) => {
      try {
        if (!sonarr.available) {
          return { content: [{ type: "text" as const, text: "Sonarr is not configured." }], isError: true };
        }

        const library = await sonarr.getLibrary();
        const existing = library.find((s) => s.tvdbId === tvdbId);
        if (existing) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                alreadyInLibrary: true,
                title: existing.title,
                year: existing.year,
                monitored: existing.monitored,
                seasonCount: existing.seasonCount,
              }, null, 2),
            }],
          };
        }

        const lookupResults = await sonarr.lookupSeries(`tvdb:${tvdbId}`);
        const seriesData = lookupResults[0];
        if (!seriesData) {
          return { content: [{ type: "text" as const, text: `Series with tvdbId ${tvdbId} not found.` }], isError: true };
        }

        const defaults = await sonarr.resolveDefaults();
        const addPayload: Record<string, unknown> = {
          tvdbId: seriesData.tvdbId,
          title: seriesData.title,
          qualityProfileId: defaults.qualityProfileId,
          rootFolderPath: defaults.rootFolderPath,
          monitored: true,
          seasonFolder: true,
          addOptions: { searchForMissingEpisodes: true },
        };

        if (defaults.languageProfileId !== undefined) {
          addPayload.languageProfileId = defaults.languageProfileId;
        }

        const added = await sonarr.addSeries(addPayload);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              title: added.title,
              year: added.year ?? seriesData.year,
              seasonCount: seriesData.seasonCount,
              searching: true,
            }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Failed to add series: ${msg}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // arr_series_detail — series overview with per-season stats
  // -----------------------------------------------------------------------
  server.registerTool(
    "arr_series_detail",
    {
      title: "Series Detail",
      description:
        "Get detailed info about a TV series in the library: per-season breakdown of " +
        "total episodes, downloaded, missing, and monitored status. " +
        "Use arr_episode_list for individual episode details.",
      inputSchema: {
        title: z.string().optional().describe("Series title to search in library"),
        sonarrId: z.number().int().optional().describe("Sonarr internal series ID"),
      },
    },
    async ({ title, sonarrId }) => {
      try {
        if (!sonarr.available) {
          return { content: [{ type: "text" as const, text: "Sonarr is not configured." }], isError: true };
        }

        let series: SonarrSeries | undefined;

        if (sonarrId) {
          series = await sonarr.getSeries(sonarrId);
        } else if (title) {
          const library = await sonarr.getLibrary();
          const q = title.toLowerCase();
          series = library.find((s) => s.title.toLowerCase().includes(q));
          if (!series) {
            // Try alternative titles
            const altMatches = searchSeriesLibraryByAltTitle(title, library);
            series = altMatches[0];
          }
        }

        if (!series) {
          return { content: [{ type: "text" as const, text: `Series "${title ?? sonarrId}" not found in library.` }], isError: true };
        }

        // Fetch full series with stats
        const fullSeries = await sonarr.getSeries(series.id);
        const episodes = await sonarr.getEpisodes(series.id);

        // Build per-season summary
        const seasonMap = new Map<number, { total: number; downloaded: number; missing: number; monitored: boolean }>();

        for (const season of fullSeries.seasons ?? []) {
          seasonMap.set(season.seasonNumber, {
            total: season.statistics?.totalEpisodeCount ?? 0,
            downloaded: season.statistics?.episodeFileCount ?? 0,
            missing: (season.statistics?.totalEpisodeCount ?? 0) - (season.statistics?.episodeFileCount ?? 0),
            monitored: season.monitored,
          });
        }

        const lines: string[] = [
          `# ${fullSeries.title} (${fullSeries.year})`,
          `Status: ${fullSeries.status} | Network: ${fullSeries.network ?? "N/A"} | Seasons: ${fullSeries.seasonCount ?? "?"}`,
          `Monitored: ${fullSeries.monitored ? "Yes" : "No"} | TVDB: ${fullSeries.tvdbId} | Sonarr ID: ${fullSeries.id}`,
          "",
          "## Seasons",
        ];

        for (const [num, stats] of [...seasonMap.entries()].sort((a, b) => a[0] - b[0])) {
          if (num === 0) {
            lines.push(`  Specials: ${stats.downloaded}/${stats.total} downloaded${stats.monitored ? "" : " (not monitored)"}`);
          } else {
            lines.push(`  Season ${num}: ${stats.downloaded}/${stats.total} downloaded, ${stats.missing} missing${stats.monitored ? "" : " (not monitored)"}`);
          }
        }

        if (fullSeries.overview) {
          lines.push("", `Overview: ${fullSeries.overview.slice(0, 300)}`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Series detail failed: ${msg}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // arr_episode_list — episodes for a specific season
  // -----------------------------------------------------------------------
  server.registerTool(
    "arr_episode_list",
    {
      title: "Episode List",
      description:
        "List all episodes of a specific season with download status, title, and air date. " +
        "Use arr_series_detail first to get the season overview.",
      inputSchema: {
        title: z.string().optional().describe("Series title to search in library"),
        sonarrId: z.number().int().optional().describe("Sonarr internal series ID"),
        season: z.number().int().describe("Season number to list episodes for"),
      },
    },
    async ({ title, sonarrId, season }) => {
      try {
        if (!sonarr.available) {
          return { content: [{ type: "text" as const, text: "Sonarr is not configured." }], isError: true };
        }

        let seriesId: number | undefined;
        let seriesTitle = title ?? "";

        if (sonarrId) {
          seriesId = sonarrId;
        } else if (title) {
          const library = await sonarr.getLibrary();
          const q = title.toLowerCase();
          let series = library.find((s) => s.title.toLowerCase().includes(q));
          if (!series) {
            const altMatches = searchSeriesLibraryByAltTitle(title, library);
            series = altMatches[0];
          }
          if (series) {
            seriesId = series.id;
            seriesTitle = series.title;
          }
        }

        if (!seriesId) {
          return { content: [{ type: "text" as const, text: `Series "${title ?? sonarrId}" not found in library.` }], isError: true };
        }

        const episodes = await sonarr.getEpisodes(seriesId);
        const seasonEps = episodes
          .filter((ep) => ep.seasonNumber === season)
          .sort((a, b) => a.episodeNumber - b.episodeNumber);

        if (seasonEps.length === 0) {
          return { content: [{ type: "text" as const, text: `No episodes found for "${seriesTitle}" Season ${season}.` }] };
        }

        const lines: string[] = [
          `# ${seriesTitle} — Season ${season} (${seasonEps.length} episodes)`,
          "",
        ];

        for (const ep of seasonEps) {
          const status = ep.hasFile ? "OK" : ep.monitored ? "MISSING" : "not monitored";
          const airDate = ep.airDate ?? "TBA";
          lines.push(`  E${String(ep.episodeNumber).padStart(2, "0")} [${status}] ${ep.title} (${airDate})`);
        }

        const downloaded = seasonEps.filter((e) => e.hasFile).length;
        lines.push("", `Downloaded: ${downloaded}/${seasonEps.length}`);

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Episode list failed: ${msg}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // arr_calendar — upcoming + download queue
  // -----------------------------------------------------------------------
  server.registerTool(
    "arr_calendar",
    {
      title: "Media Calendar",
      description:
        "Check upcoming episodes and movie releases (next 14 days by default). " +
        "Also shows current download queue status.",
      inputSchema: {
        days: z.number().int().min(1).max(90).optional().default(14).describe("Days to look ahead (default: 14, max: 90)"),
        type: z.enum(["episodes", "movies", "both"]).optional().default("both").describe("Filter by type"),
        seriesTitle: z.string().optional().describe("Filter episodes by series title"),
      },
    },
    async ({ days, type, seriesTitle }) => {
      try {
        if (!sonarr.available && !radarr.available) {
          return { content: [{ type: "text" as const, text: "Neither Sonarr nor Radarr is configured." }], isError: true };
        }

        const now = new Date();
        const start = now.toISOString().split("T")[0];
        const end = new Date(now.getTime() + days * 86_400_000).toISOString().split("T")[0];

        const lines: string[] = [`# Calendar (next ${days} days)`];

        // Fetch calendar data
        if (type !== "movies" && sonarr.available) {
          const episodes = await sonarr.getCalendar(start, end);
          let filtered = episodes;
          if (seriesTitle) {
            const filter = seriesTitle.toLowerCase();
            filtered = episodes.filter((ep) => ep.series?.title?.toLowerCase().includes(filter));
          }

          if (filtered.length > 0) {
            lines.push("", "## Upcoming Episodes");
            for (const ep of filtered) {
              lines.push(`  ${ep.airDate ?? "TBA"} — ${ep.series?.title ?? "?"} S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")} "${ep.title}"`);
            }
          } else {
            lines.push("", "## Upcoming Episodes\n  None");
          }
        }

        if (type !== "episodes" && radarr.available) {
          const movies = await radarr.getCalendar(start, end);
          if (movies.length > 0) {
            lines.push("", "## Upcoming Movies");
            for (const m of movies) {
              const releaseDate = m.physicalRelease ?? m.digitalRelease ?? m.inCinemas ?? "TBA";
              lines.push(`  ${releaseDate} — ${m.title} (${m.year})`);
            }
          } else {
            lines.push("", "## Upcoming Movies\n  None");
          }
        }

        // Download queue
        const queueLines: string[] = [];
        if (sonarr.available) {
          try {
            const sq = await sonarr.getQueue();
            for (const r of sq.records) {
              const series = r.series?.title ?? "?";
              const ep = r.episode ? `S${String(r.episode.seasonNumber).padStart(2, "0")}E${String(r.episode.episodeNumber).padStart(2, "0")}` : "";
              queueLines.push(`  [Sonarr] ${series} ${ep} — ${r.status ?? "?"} ${r.timeleft ? `(${r.timeleft} left)` : ""}`);
            }
          } catch {
            // Queue fetch failed, not critical
          }
        }
        if (radarr.available) {
          try {
            const rq = await radarr.getQueue();
            for (const r of rq.records) {
              const movie = r.movie ? `${r.movie.title} (${r.movie.year})` : (r.title ?? "?");
              queueLines.push(`  [Radarr] ${movie} — ${r.status ?? "?"} ${r.timeleft ? `(${r.timeleft} left)` : ""}`);
            }
          } catch {
            // Queue fetch failed, not critical
          }
        }

        if (queueLines.length > 0) {
          lines.push("", "## Download Queue");
          lines.push(...queueLines);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Calendar failed: ${msg}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // arr_add_collection
  // -----------------------------------------------------------------------
  server.registerTool(
    "arr_add_collection",
    {
      title: "Add Collection",
      description:
        "Monitor and download all movies in a collection (e.g. Harry Potter, Marvel). " +
        "Use after arr_search or arr_add_movie returned collection info.",
      inputSchema: {
        collectionTmdbId: z.number().int().describe("TMDB ID of the collection"),
      },
    },
    async ({ collectionTmdbId }) => {
      try {
        if (!radarr.available) {
          return { content: [{ type: "text" as const, text: "Radarr is not configured." }], isError: true };
        }

        const [collections, library] = await Promise.all([
          radarr.getCollections(),
          radarr.getLibrary(),
        ]);

        const collection = collections.find((c) => c.tmdbId === collectionTmdbId);
        if (!collection) {
          return { content: [{ type: "text" as const, text: `Collection with tmdbId ${collectionTmdbId} not found.` }], isError: true };
        }

        const libraryTmdbIds = new Set(library.map((m) => m.tmdbId));
        const defaults = await radarr.resolveDefaults();

        let addedCount = 0;
        const errors: string[] = [];

        for (const movie of collection.movies) {
          if (libraryTmdbIds.has(movie.tmdbId)) continue;

          try {
            await radarr.addMovie({
              tmdbId: movie.tmdbId,
              title: movie.title,
              qualityProfileId: defaults.qualityProfileId,
              rootFolderPath: defaults.rootFolderPath,
              monitored: true,
              minimumAvailability: "announced",
              addOptions: { searchForMovie: true },
            });
            addedCount++;
          } catch (err) {
            errors.push(`${movie.title}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              collectionName: collection.title,
              totalInCollection: collection.movies.length,
              addedCount,
              alreadyInLibrary: collection.movies.length - addedCount - errors.length,
              errors: errors.length > 0 ? errors : undefined,
            }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Add collection failed: ${msg}` }], isError: true };
      }
    }
  );

  log(`Registered 7 arr_* tools (Sonarr: ${sonarr.available ? "OK" : "disabled"}, Radarr: ${radarr.available ? "OK" : "disabled"})`);
}

// ---------------------------------------------------------------------------
// 3-stage search implementation
// ---------------------------------------------------------------------------

async function doSearch(
  query: string,
  type: "movie" | "series" | "both",
  sonarr: SonarrClient,
  radarr: RadarrClient,
  minimax: MiniMaxClient
): Promise<string> {
  const lines: string[] = [];
  let resolvedFrom: string | null = null;

  // Fetch libraries once (reused across all stages)
  const [sonarrLib, radarrLib] = await Promise.all([
    type !== "movie" && sonarr.available ? sonarr.getLibrary() : Promise.resolve([] as SonarrSeries[]),
    type !== "series" && radarr.available ? radarr.getLibrary() : Promise.resolve([] as RadarrMovie[]),
  ]);
  const sonarrLibMap = new Map(sonarrLib.map((s) => [s.tvdbId, s]));
  const radarrLibMap = new Map(radarrLib.map((m) => [m.tmdbId, m]));

  // Stufe 1: Direct lookup
  let seriesResults: SonarrSeries[] = [];
  let movieResults: RadarrMovie[] = [];

  if (type !== "movie" && sonarr.available) {
    seriesResults = await sonarr.lookupSeries(query);
  }
  if (type !== "series" && radarr.available) {
    movieResults = await radarr.lookupMovie(query);
  }

  // Stufe 2: Library alternative titles (if direct search empty)
  let librarySeriesMatches: SonarrSeries[] = [];
  let libraryMovieMatches: RadarrMovie[] = [];

  if (seriesResults.length === 0 && type !== "movie" && sonarr.available) {
    librarySeriesMatches = searchSeriesLibraryByAltTitle(query, sonarrLib);
  }
  if (movieResults.length === 0 && type !== "series" && radarr.available) {
    libraryMovieMatches = searchMovieLibraryByAltTitle(query, radarrLib);
  }

  // Stufe 3: Web search title resolution (if both stages empty)
  if (
    seriesResults.length === 0 &&
    movieResults.length === 0 &&
    librarySeriesMatches.length === 0 &&
    libraryMovieMatches.length === 0
  ) {
    const resolved = await resolveTitle(query, minimax);
    if (resolved) {
      resolvedFrom = query;
      if (type !== "movie" && sonarr.available) {
        seriesResults = await sonarr.lookupSeries(resolved);
      }
      if (type !== "series" && radarr.available) {
        movieResults = await radarr.lookupMovie(resolved);
      }
    }
  }

  if (resolvedFrom) {
    lines.push(`(Searched as "${resolvedFrom}", resolved to "${seriesResults[0]?.title ?? movieResults[0]?.title ?? "?"}")\n`);
  }

  // Format library matches from Stufe 2
  if (librarySeriesMatches.length > 0) {
    lines.push("## Series (from library, matched by alternative title)");
    for (const s of librarySeriesMatches.slice(0, 5)) {
      lines.push(formatSeries(s, sonarrLibMap));
    }
  }

  if (libraryMovieMatches.length > 0) {
    lines.push("## Movies (from library, matched by alternative title)");
    for (const m of libraryMovieMatches.slice(0, 5)) {
      lines.push(formatMovie(m, radarrLibMap));
    }
  }

  // Format lookup results from Stufe 1 or 3
  if (seriesResults.length > 0) {
    lines.push("## Series");
    for (const s of seriesResults.slice(0, 5)) {
      lines.push(formatSeries(s, sonarrLibMap));
    }
  }

  if (movieResults.length > 0) {
    lines.push("## Movies");
    for (const m of movieResults.slice(0, 5)) {
      lines.push(formatMovie(m, radarrLibMap));
    }
  }

  if (lines.length === 0 || (lines.length === 1 && resolvedFrom)) {
    return `No results found for "${query}".`;
  }

  return lines.join("\n");
}

function formatSeries(s: SonarrSeries, libMap: Map<number, SonarrSeries>): string {
  const inLib = libMap.get(s.tvdbId);
  const status = inLib
    ? `In library (monitored: ${inLib.monitored ? "yes" : "no"})`
    : "Not in library";
  const overview = s.overview ? s.overview.slice(0, 200) : "";
  return `  ${s.title} (${s.year}) — TVDB: ${s.tvdbId} | ${s.network ?? "?"} | ${s.seasonCount ?? "?"} seasons | ${s.status}\n    ${status}\n    ${overview}`;
}

function formatMovie(m: RadarrMovie, libMap: Map<number, RadarrMovie>): string {
  const inLib = libMap.get(m.tmdbId);
  const status = inLib
    ? `In library (monitored: ${inLib.monitored ? "yes" : "no"}, downloaded: ${inLib.hasFile ? "yes" : "no"})`
    : "Not in library";
  const overview = m.overview ? m.overview.slice(0, 200) : "";
  const col = m.collection ? ` | Collection: ${m.collection.name} (TMDB: ${m.collection.tmdbId})` : "";
  return `  ${m.title} (${m.year}) — TMDB: ${m.tmdbId} | ${m.status}${col}\n    ${status}\n    ${overview}`;
}
