import {
  ArrClientError,
  PluginConfig,
  QualityProfile,
  RadarrCollection,
  RadarrMovie,
  RootFolder,
} from "./types";

interface Defaults {
  qualityProfileId: number;
  rootFolderPath: string;
}

export class RadarrClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly profileHint: string;
  private readonly rootFolderOverride?: string;
  private readonly timeoutMs = 30_000;
  private defaults: Defaults | null = null;

  constructor(config: PluginConfig) {
    this.baseUrl = config.radarrUrl.replace(/\/+$/, "");
    this.apiKey = config.radarrApiKey;
    this.profileHint = config.movieQualityProfile;
    this.rootFolderOverride = config.movieRootFolder;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/v3${path}`, {
        method,
        headers: {
          "X-Api-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new ArrClientError("Radarr", response.status, text);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return (await response.json()) as T;
      }
      return (await response.text()) as unknown as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async resolveDefaults(): Promise<Defaults> {
    if (this.defaults) return this.defaults;

    const [profiles, rootFolders] = await Promise.all([
      this.request<QualityProfile[]>("GET", "/qualityprofile"),
      this.request<RootFolder[]>("GET", "/rootfolder"),
    ]);

    const hint = this.profileHint.toLowerCase();
    const matched = profiles.find((p) => p.name.toLowerCase().includes(hint));
    const qualityProfileId = matched ? matched.id : profiles[0]?.id ?? 1;

    const rootFolderPath = this.rootFolderOverride ?? rootFolders[0]?.path ?? "/movies";

    this.defaults = { qualityProfileId, rootFolderPath };
    return this.defaults;
  }

  async lookupMovie(term: string): Promise<RadarrMovie[]> {
    return this.request<RadarrMovie[]>("GET", `/movie/lookup?term=${encodeURIComponent(term)}`);
  }

  async getLibrary(): Promise<RadarrMovie[]> {
    return this.request<RadarrMovie[]>("GET", "/movie");
  }

  async addMovie(data: Record<string, unknown>): Promise<RadarrMovie> {
    return this.request<RadarrMovie>("POST", "/movie", data);
  }

  async getCollections(): Promise<RadarrCollection[]> {
    return this.request<RadarrCollection[]>("GET", "/collection");
  }

  async getCalendar(start: string, end: string): Promise<RadarrMovie[]> {
    return this.request<RadarrMovie[]>("GET", `/calendar?start=${start}&end=${end}`);
  }

  async command(body: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>("POST", "/command", body);
  }
}
