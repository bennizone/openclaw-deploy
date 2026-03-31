import type {
  QualityProfile,
  QueueResponse,
  RadarrCollection,
  RadarrMovie,
  RootFolder,
} from "../lib/types.js";

const log = (msg: string) => process.stderr.write(`[radarr] ${msg}\n`);

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

  constructor() {
    this.baseUrl = (process.env.RADARR_URL ?? "").replace(/\/+$/, "");
    this.apiKey = process.env.RADARR_API_KEY ?? "";
    this.profileHint = process.env.RADARR_QUALITY_PROFILE ?? "Up to 1080p";
    this.rootFolderOverride = process.env.RADARR_ROOT_FOLDER;

    if (!this.baseUrl || !this.apiKey) {
      log("WARNING: RADARR_URL or RADARR_API_KEY not set — Radarr features disabled");
    }
  }

  get available(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0;
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
        throw new Error(`Radarr HTTP ${response.status}: ${text}`);
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

  async getQueue(): Promise<QueueResponse> {
    return this.request<QueueResponse>("GET", "/queue?includeMovie=true&pageSize=50");
  }
}
