import { Type } from "@sinclair/typebox";
import { SonarrClient } from "./sonarr-client";
import { RadarrClient } from "./radarr-client";
import { validateConfig } from "./config";
import { createTools } from "./tools";

// ---------------------------------------------------------------------------
// Plugin API types (matching OpenClaw plugin surface)
// ---------------------------------------------------------------------------

interface ToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: any) => Promise<ToolResult>;
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

interface PluginApi {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: {
    debug?: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  registerTool: (tool: ToolDefinition, opts?: { name?: string; optional?: boolean }) => void;
  [key: string]: unknown;
}

function json(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// ---------------------------------------------------------------------------
// definePluginEntry pattern (inline, no SDK import needed for local plugins)
// ---------------------------------------------------------------------------

export default {
  id: "openclaw-sonarr-radarr",
  name: "Sonarr & Radarr",
  description: "Search, add, and monitor movies and TV series via Sonarr and Radarr",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sonarrUrl: { type: "string" },
      sonarrApiKey: { type: "string" },
      radarrUrl: { type: "string" },
      radarrApiKey: { type: "string" },
      seriesQualityProfile: { type: "string" },
      movieQualityProfile: { type: "string" },
      seriesRootFolder: { type: "string" },
      movieRootFolder: { type: "string" },
    },
    required: ["sonarrUrl", "sonarrApiKey", "radarrUrl", "radarrApiKey"],
  },
  register(api: PluginApi) {
    const config = validateConfig(api.pluginConfig ?? {});
    const sonarr = new SonarrClient(config);
    const radarr = new RadarrClient(config);
    const tools = createTools({ sonarr, radarr, config });

    api.registerTool({
      name: "arr_search",
      label: "Media Search",
      description:
        "Search for a movie or TV series by name. Returns matching results with titles, years, overviews, and whether each item is already in the library.",
      parameters: Type.Object({
        query: Type.String({ description: "Search term (movie or series title)" }),
        type: Type.Optional(
          Type.Union([Type.Literal("movie"), Type.Literal("series"), Type.Literal("both")], {
            description: "Search movies, series, or both. Default: both",
          })
        ),
      }),
      async execute(_id, params) {
        try {
          return json(await tools.arr_search(params));
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    }, { name: "arr_search" });

    api.registerTool({
      name: "arr_add_movie",
      label: "Add Movie",
      description:
        "Add a movie to the library and start downloading. Uses configured quality profile. Returns collection info if the movie belongs to a collection.",
      parameters: Type.Object({
        tmdbId: Type.Number({ description: "TMDB ID of the movie (from arr_search results)" }),
        title: Type.Optional(Type.String({ description: "Movie title (for confirmation)" })),
      }),
      async execute(_id, params) {
        try {
          return json(await tools.arr_add_movie(params));
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    }, { name: "arr_add_movie" });

    api.registerTool({
      name: "arr_add_series",
      label: "Add Series",
      description:
        "Add a TV series to the library and start downloading. Uses configured quality profile. Monitors all seasons.",
      parameters: Type.Object({
        tvdbId: Type.Number({ description: "TVDB ID of the series (from arr_search results)" }),
        title: Type.Optional(Type.String({ description: "Series title (for confirmation)" })),
      }),
      async execute(_id, params) {
        try {
          return json(await tools.arr_add_series(params));
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    }, { name: "arr_add_series" });

    api.registerTool({
      name: "arr_calendar",
      label: "Media Calendar",
      description:
        "Check upcoming episodes and movie releases. Shows the next 14 days by default.",
      parameters: Type.Object({
        seriesTitle: Type.Optional(Type.String({ description: "Filter by series title" })),
        days: Type.Optional(Type.Number({ description: "Days to look ahead (default: 14, max: 90)" })),
      }),
      async execute(_id, params) {
        try {
          return json(await tools.arr_calendar(params));
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    }, { name: "arr_calendar" });

    api.registerTool({
      name: "arr_add_collection",
      label: "Add Collection",
      description:
        "Monitor and download all movies in a collection (e.g. Harry Potter, Marvel). Use after arr_add_movie returned collection info.",
      parameters: Type.Object({
        collectionTmdbId: Type.Number({ description: "TMDB ID of the collection" }),
      }),
      async execute(_id, params) {
        try {
          return json(await tools.arr_add_collection(params));
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    }, { name: "arr_add_collection" });

    api.logger.info(`[sonarr-radarr] Registered 5 tools (Sonarr: ${config.sonarrUrl}, Radarr: ${config.radarrUrl})`);
  },
};
