import { PluginConfig } from "./types";

export function validateConfig(raw: unknown): PluginConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("openclaw-sonarr-radarr: config must be a non-null object");
  }

  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (!obj.sonarrUrl || typeof obj.sonarrUrl !== "string") {
    errors.push("sonarrUrl is required (string)");
  }
  if (!obj.sonarrApiKey || typeof obj.sonarrApiKey !== "string") {
    errors.push("sonarrApiKey is required (string)");
  }
  if (!obj.radarrUrl || typeof obj.radarrUrl !== "string") {
    errors.push("radarrUrl is required (string)");
  }
  if (!obj.radarrApiKey || typeof obj.radarrApiKey !== "string") {
    errors.push("radarrApiKey is required (string)");
  }

  if (errors.length > 0) {
    throw new Error(`openclaw-sonarr-radarr invalid config:\n  - ${errors.join("\n  - ")}`);
  }

  return {
    sonarrUrl: (obj.sonarrUrl as string).trim().replace(/\/+$/, ""),
    sonarrApiKey: (obj.sonarrApiKey as string).trim(),
    radarrUrl: (obj.radarrUrl as string).trim().replace(/\/+$/, ""),
    radarrApiKey: (obj.radarrApiKey as string).trim(),
    seriesQualityProfile: typeof obj.seriesQualityProfile === "string" ? obj.seriesQualityProfile.trim() : "Up to 720p",
    movieQualityProfile: typeof obj.movieQualityProfile === "string" ? obj.movieQualityProfile.trim() : "Up to 1080p",
    seriesRootFolder: typeof obj.seriesRootFolder === "string" ? obj.seriesRootFolder.trim() : undefined,
    movieRootFolder: typeof obj.movieRootFolder === "string" ? obj.movieRootFolder.trim() : undefined,
  };
}
