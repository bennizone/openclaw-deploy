import {
  ArrClientError,
  LanguageProfile,
  PluginConfig,
  QualityProfile,
  RootFolder,
  SonarrEpisode,
  SonarrSeries,
} from "./types";

interface Defaults {
  qualityProfileId: number;
  rootFolderPath: string;
  languageProfileId?: number;
}

export class SonarrClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly profileHint: string;
  private readonly rootFolderOverride?: string;
  private readonly timeoutMs = 30_000;
  private defaults: Defaults | null = null;

  constructor(config: PluginConfig) {
    this.baseUrl = config.sonarrUrl.replace(/\/+$/, "");
    this.apiKey = config.sonarrApiKey;
    this.profileHint = config.seriesQualityProfile;
    this.rootFolderOverride = config.seriesRootFolder;
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
        throw new ArrClientError("Sonarr", response.status, text);
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

    // Try to get language profiles (Sonarr v3 only, v4 removed them)
    let languageProfileId: number | undefined;
    try {
      const langProfiles = await this.request<LanguageProfile[]>("GET", "/languageprofile");
      if (langProfiles.length > 0) {
        languageProfileId = langProfiles[0].id;
      }
    } catch {
      // Sonarr v4 — no language profiles
    }

    const hint = this.profileHint.toLowerCase();
    const matched = profiles.find((p) => p.name.toLowerCase().includes(hint));
    const qualityProfileId = matched ? matched.id : profiles[0]?.id ?? 1;

    const rootFolderPath = this.rootFolderOverride ?? rootFolders[0]?.path ?? "/tv";

    this.defaults = { qualityProfileId, rootFolderPath, languageProfileId };
    return this.defaults;
  }

  async lookupSeries(term: string): Promise<SonarrSeries[]> {
    return this.request<SonarrSeries[]>("GET", `/series/lookup?term=${encodeURIComponent(term)}`);
  }

  async getLibrary(): Promise<SonarrSeries[]> {
    return this.request<SonarrSeries[]>("GET", "/series");
  }

  async addSeries(data: SonarrSeries): Promise<SonarrSeries> {
    return this.request<SonarrSeries>("POST", "/series", data);
  }

  async getCalendar(start: string, end: string): Promise<SonarrEpisode[]> {
    return this.request<SonarrEpisode[]>("GET", `/calendar?start=${start}&end=${end}&includeSeries=true`);
  }

  async command(body: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>("POST", "/command", body);
  }
}
