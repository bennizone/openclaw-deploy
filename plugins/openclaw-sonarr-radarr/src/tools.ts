import {
  AddCollectionInput,
  AddMovieInput,
  AddSeriesInput,
  CalendarInput,
  RadarrMovie,
  SearchInput,
  SonarrSeries,
  ToolDeps,
} from "./types";

export function createTools({ sonarr, radarr, config }: ToolDeps) {
  return {
    // -----------------------------------------------------------------
    // arr_search
    // -----------------------------------------------------------------
    arr_search: async (raw: unknown) => {
      const input = raw as SearchInput;
      if (!input?.query) throw new Error("query is required");

      const searchType = input.type ?? "both";
      const results: Record<string, unknown> = {};

      const [sonarrLib, radarrLib] = await Promise.all([
        searchType !== "movie" ? sonarr.getLibrary() : Promise.resolve([] as SonarrSeries[]),
        searchType !== "series" ? radarr.getLibrary() : Promise.resolve([] as RadarrMovie[]),
      ]);

      const sonarrLibMap = new Map(sonarrLib.map((s) => [s.tvdbId, s]));
      const radarrLibMap = new Map(radarrLib.map((m) => [m.tmdbId, m]));

      if (searchType !== "movie") {
        const lookup = await sonarr.lookupSeries(input.query);
        results.series = lookup.slice(0, 5).map((s) => {
          const inLib = sonarrLibMap.get(s.tvdbId);
          return {
            title: s.title,
            year: s.year,
            overview: s.overview ? s.overview.slice(0, 200) : undefined,
            tvdbId: s.tvdbId,
            network: s.network,
            seasonCount: s.seasonCount,
            status: s.status,
            inLibrary: !!inLib,
            monitored: inLib?.monitored,
          };
        });
      }

      if (searchType !== "series") {
        const lookup = await radarr.lookupMovie(input.query);
        results.movies = lookup.slice(0, 5).map((m) => {
          const inLib = radarrLibMap.get(m.tmdbId);
          return {
            title: m.title,
            year: m.year,
            overview: m.overview ? m.overview.slice(0, 200) : undefined,
            tmdbId: m.tmdbId,
            status: m.status,
            inLibrary: !!inLib,
            monitored: inLib?.monitored,
            hasFile: inLib?.hasFile,
            collection: m.collection
              ? { name: m.collection.name, tmdbId: m.collection.tmdbId }
              : undefined,
          };
        });
      }

      return results;
    },

    // -----------------------------------------------------------------
    // arr_add_movie
    // -----------------------------------------------------------------
    arr_add_movie: async (raw: unknown) => {
      const input = raw as AddMovieInput;
      if (!input?.tmdbId) throw new Error("tmdbId is required");

      // Check if already in library
      const library = await radarr.getLibrary();
      const existing = library.find((m) => m.tmdbId === input.tmdbId);
      if (existing) {
        return {
          success: false,
          alreadyInLibrary: true,
          title: existing.title,
          year: existing.year,
          monitored: existing.monitored,
          hasFile: existing.hasFile,
        };
      }

      // Lookup full movie data
      const lookupResults = await radarr.lookupMovie(`tmdb:${input.tmdbId}`);
      const movieData = lookupResults[0];
      if (!movieData) throw new Error(`Movie with tmdbId ${input.tmdbId} not found`);

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

      // Check for collection
      let collectionInfo: Record<string, unknown> | undefined;
      if (movieData.collection) {
        try {
          const collections = await radarr.getCollections();
          const col = collections.find((c) => c.tmdbId === movieData.collection!.tmdbId);
          if (col) {
            const missingMovies = col.movies
              .filter((cm) => !library.find((lm) => lm.tmdbId === cm.tmdbId) && cm.tmdbId !== input.tmdbId)
              .map((cm) => ({ title: cm.title, year: cm.year, tmdbId: cm.tmdbId }));

            collectionInfo = {
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

      return {
        success: true,
        title: added.title,
        year: added.year ?? movieData.year,
        searching: true,
        collection: collectionInfo,
      };
    },

    // -----------------------------------------------------------------
    // arr_add_series
    // -----------------------------------------------------------------
    arr_add_series: async (raw: unknown) => {
      const input = raw as AddSeriesInput;
      if (!input?.tvdbId) throw new Error("tvdbId is required");

      // Check if already in library
      const library = await sonarr.getLibrary();
      const existing = library.find((s) => s.tvdbId === input.tvdbId);
      if (existing) {
        return {
          success: false,
          alreadyInLibrary: true,
          title: existing.title,
          year: existing.year,
          monitored: existing.monitored,
          seasonCount: existing.seasonCount,
        };
      }

      // Lookup full series data
      const lookupResults = await sonarr.lookupSeries(`tvdb:${input.tvdbId}`);
      const seriesData = lookupResults[0];
      if (!seriesData) throw new Error(`Series with tvdbId ${input.tvdbId} not found`);

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

      const added = await sonarr.addSeries(addPayload as unknown as SonarrSeries);

      return {
        success: true,
        title: added.title,
        year: added.year ?? seriesData.year,
        seasonCount: seriesData.seasonCount,
        searching: true,
      };
    },

    // -----------------------------------------------------------------
    // arr_calendar
    // -----------------------------------------------------------------
    arr_calendar: async (raw: unknown) => {
      const input = (raw as CalendarInput) ?? {};
      const days = Math.min(Math.max(input.days ?? 14, 1), 90);

      const now = new Date();
      const start = now.toISOString().split("T")[0];
      const end = new Date(now.getTime() + days * 86_400_000).toISOString().split("T")[0];

      const [episodes, movies] = await Promise.all([
        sonarr.getCalendar(start, end),
        radarr.getCalendar(start, end),
      ]);

      let filteredEpisodes = episodes;
      if (input.seriesTitle) {
        const filter = input.seriesTitle.toLowerCase();
        filteredEpisodes = episodes.filter(
          (ep) => ep.series?.title?.toLowerCase().includes(filter)
        );
      }

      return {
        episodes: filteredEpisodes.map((ep) => ({
          seriesTitle: ep.series?.title ?? "Unknown",
          season: ep.seasonNumber,
          episode: ep.episodeNumber,
          episodeTitle: ep.title,
          airDate: ep.airDate ?? ep.airDateUtc,
        })),
        movies: movies.map((m) => ({
          title: m.title,
          year: m.year,
          releaseDate: (m as Record<string, unknown>).physicalRelease ?? (m as Record<string, unknown>).digitalRelease ?? (m as Record<string, unknown>).inCinemas,
        })),
        daysAhead: days,
      };
    },

    // -----------------------------------------------------------------
    // arr_add_collection
    // -----------------------------------------------------------------
    arr_add_collection: async (raw: unknown) => {
      const input = raw as AddCollectionInput;
      if (!input?.collectionTmdbId) throw new Error("collectionTmdbId is required");

      const [collections, library] = await Promise.all([
        radarr.getCollections(),
        radarr.getLibrary(),
      ]);

      const collection = collections.find((c) => c.tmdbId === input.collectionTmdbId);
      if (!collection) throw new Error(`Collection with tmdbId ${input.collectionTmdbId} not found`);

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
        success: true,
        collectionName: collection.title,
        totalInCollection: collection.movies.length,
        addedCount,
        alreadyInLibrary: collection.movies.length - addedCount - errors.length,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  };
}
