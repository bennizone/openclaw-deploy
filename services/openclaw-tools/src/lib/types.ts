export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "minimax" | "ddg";
  date?: string;
}

export interface MiniMaxSearchResponse {
  organic: Array<{
    title: string;
    link: string;
    snippet: string;
    date?: string;
  }>;
  related_searches?: Array<{ query: string }>;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
}

export interface MiniMaxVLMResponse {
  content: string;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
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
  alternateTitles?: SonarrAlternateTitle[];
  added?: string;
  [key: string]: unknown;
}

export interface SonarrAlternateTitle {
  title: string;
  seasonNumber?: number;
  [key: string]: unknown;
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: {
    episodeCount: number;
    episodeFileCount: number;
    totalEpisodeCount: number;
    percentOfEpisodes?: number;
  };
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
  alternateTitles?: RadarrAlternateTitle[];
  images?: Array<{ coverType: string; remoteUrl?: string; url?: string }>;
  added?: string;
  physicalRelease?: string;
  digitalRelease?: string;
  inCinemas?: string;
  [key: string]: unknown;
}

export interface RadarrAlternateTitle {
  sourceType?: string;
  movieId?: number;
  title: string;
  sourceId?: number;
  votes?: number;
  voteCount?: number;
  language?: { id: number; name: string };
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
// Shared *arr types
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

export interface QueueRecord {
  title?: string;
  status?: string;
  timeleft?: string;
  size?: number;
  sizeleft?: number;
  estimatedCompletionTime?: string;
  movie?: { title: string; year: number };
  episode?: { seasonNumber: number; episodeNumber: number; title: string };
  series?: { title: string };
  [key: string]: unknown;
}

export interface QueueResponse {
  page?: number;
  pageSize?: number;
  totalRecords?: number;
  records: QueueRecord[];
}

// ---------------------------------------------------------------------------
// PIM: CalDAV / CardDAV types
// ---------------------------------------------------------------------------

export type PimAccess = "read" | "readwrite";

export interface PimSourceConfig {
  type: "caldav" | "carddav";
  serverUrl: string;
  credentialPrefix: string;
  label: string;
  calendarFilter?: string[];
}

export interface PimAgentBinding {
  source: string;
  access: PimAccess;
}

export interface PimAgentAccess {
  calendars: PimAgentBinding[];
  contacts: PimAgentBinding[];
}

export interface PimConfig {
  timezone: string;
  calendarSources: Record<string, PimSourceConfig>;
  contactSources: Record<string, PimSourceConfig>;
  agentAccess: Record<string, PimAgentAccess>;
}

export interface ResolvedSource {
  id: string;
  config: PimSourceConfig;
  access: PimAccess;
  username: string;
  password: string;
}

export interface CalendarEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  sourceLabel: string;
  sourceId: string;
  calendarName: string;
  url?: string;
  etag?: string;
}

export interface Contact {
  uid: string;
  fullName: string;
  emails: string[];
  phones: string[];
  organization?: string;
  address?: string;
  birthday?: string;
  sourceLabel: string;
  sourceId: string;
  url?: string;
  etag?: string;
}

export interface BirthdayEntry {
  name: string;
  date: string;
  hasYear: boolean;
  age?: number;
  sourceLabel: string;
}
