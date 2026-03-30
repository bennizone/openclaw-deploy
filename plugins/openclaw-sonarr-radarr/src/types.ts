// ---------------------------------------------------------------------------
// OpenClaw API
// ---------------------------------------------------------------------------

export interface OpenClawApi {
  config?: unknown;
  registerTool?: (name: string, handler: (input: unknown) => Promise<unknown>) => void;
  tool?: (name: string, handler: (input: unknown) => Promise<unknown>) => void;
}

// ---------------------------------------------------------------------------
// Plugin config
// ---------------------------------------------------------------------------

export interface PluginConfig {
  sonarrUrl: string;
  sonarrApiKey: string;
  radarrUrl: string;
  radarrApiKey: string;
  seriesQualityProfile: string;
  movieQualityProfile: string;
  seriesRootFolder?: string;
  movieRootFolder?: string;
}

// ---------------------------------------------------------------------------
// Sonarr types
// ---------------------------------------------------------------------------

export interface SonarrSeries {
  id: number;
  tvdbId: number;
  title: string;
  sortTitle: string;
  status: string;
  overview?: string;
  network?: string;
  year: number;
  ratings?: { votes: number; value: number };
  genres?: string[];
  seasonCount?: number;
  monitored: boolean;
  path?: string;
  qualityProfileId?: number;
  images?: Array<{ coverType: string; remoteUrl?: string; url?: string }>;
  seasons?: SonarrSeason[];
  added?: string;
  [key: string]: unknown;
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: { episodeCount: number; episodeFileCount: number; totalEpisodeCount: number };
}

export interface SonarrEpisode {
  seriesId: number;
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDateUtc?: string;
  airDate?: string;
  overview?: string;
  hasFile: boolean;
  monitored: boolean;
  series?: { title: string; tvdbId: number };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Radarr types
// ---------------------------------------------------------------------------

export interface RadarrMovie {
  id: number;
  tmdbId: number;
  imdbId?: string;
  title: string;
  sortTitle: string;
  status: string;
  overview?: string;
  year: number;
  ratings?: { votes: number; value: number };
  genres?: string[];
  monitored: boolean;
  hasFile: boolean;
  path?: string;
  qualityProfileId?: number;
  minimumAvailability?: string;
  collection?: { name: string; tmdbId: number };
  images?: Array<{ coverType: string; remoteUrl?: string; url?: string }>;
  added?: string;
  [key: string]: unknown;
}

export interface RadarrCollection {
  id: number;
  title: string;
  tmdbId: number;
  monitored: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  minimumAvailability?: string;
  movies: RadarrCollectionMovie[];
  [key: string]: unknown;
}

export interface RadarrCollectionMovie {
  tmdbId: number;
  imdbId?: string;
  title: string;
  year: number;
  overview?: string;
  monitored: boolean;
  hasFile?: boolean;
  id?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface QualityProfile {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
  [key: string]: unknown;
}

export interface RootFolder {
  id: number;
  path: string;
  freeSpace?: number;
  [key: string]: unknown;
}

export interface LanguageProfile {
  id: number;
  name: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tool input types
// ---------------------------------------------------------------------------

export interface SearchInput {
  query: string;
  type?: "movie" | "series" | "both";
}

export interface AddMovieInput {
  tmdbId: number;
  title?: string;
}

export interface AddSeriesInput {
  tvdbId: number;
  title?: string;
}

export interface CalendarInput {
  seriesTitle?: string;
  days?: number;
}

export interface AddCollectionInput {
  collectionTmdbId: number;
}

// ---------------------------------------------------------------------------
// Tool deps
// ---------------------------------------------------------------------------

export interface ToolDeps {
  sonarr: SonarrClientLike;
  radarr: RadarrClientLike;
  config: PluginConfig;
}

export interface SonarrClientLike {
  lookupSeries(term: string): Promise<SonarrSeries[]>;
  getLibrary(): Promise<SonarrSeries[]>;
  addSeries(data: SonarrSeries): Promise<SonarrSeries>;
  getCalendar(start: string, end: string): Promise<SonarrEpisode[]>;
  command(body: Record<string, unknown>): Promise<unknown>;
  resolveDefaults(): Promise<{ qualityProfileId: number; rootFolderPath: string; languageProfileId?: number }>;
}

export interface RadarrClientLike {
  lookupMovie(term: string): Promise<RadarrMovie[]>;
  getLibrary(): Promise<RadarrMovie[]>;
  addMovie(data: Record<string, unknown>): Promise<RadarrMovie>;
  getCollections(): Promise<RadarrCollection[]>;
  getCalendar(start: string, end: string): Promise<RadarrMovie[]>;
  command(body: Record<string, unknown>): Promise<unknown>;
  resolveDefaults(): Promise<{ qualityProfileId: number; rootFolderPath: string }>;
}

export class ArrClientError extends Error {
  public readonly statusCode: number;
  public readonly body: string;

  constructor(service: string, statusCode: number, body: string) {
    super(`${service} HTTP ${statusCode}: ${body}`);
    this.name = "ArrClientError";
    this.statusCode = statusCode;
    this.body = body;
  }
}
