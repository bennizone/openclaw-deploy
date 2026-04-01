import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PimConfig, PimAccess, ResolvedSource } from "./types.js";

const log = (msg: string) => process.stderr.write(`[pim-access] ${msg}\n`);

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../config/pim.json");

let _config: PimConfig | null = null;

function loadConfig(): PimConfig {
  if (_config) return _config;
  const raw = readFileSync(configPath, "utf-8");
  _config = JSON.parse(raw) as PimConfig;
  log(`Config loaded: ${Object.keys(_config.calendarSources).length} cal sources, ${Object.keys(_config.contactSources).length} contact sources`);
  return _config;
}

export function getConfig(): PimConfig {
  return loadConfig();
}

/**
 * Resolve agent ID from _meta (future Gateway support) or explicit parameter.
 * Returns the validated agent ID or throws.
 */
export function resolveAgentId(
  paramAgentId: string | undefined,
  extra?: { _meta?: Record<string, unknown> }
): string {
  const config = loadConfig();
  const metaId = extra?._meta?.agentId as string | undefined;
  const id = metaId ?? paramAgentId;

  if (!id) {
    const valid = Object.keys(config.agentAccess).join(", ");
    throw new Error(`Agent identification required. Provide agent_id parameter. Valid: ${valid}`);
  }

  if (!config.agentAccess[id]) {
    const valid = Object.keys(config.agentAccess).join(", ");
    throw new Error(`Unknown agent_id "${id}". Valid: ${valid}`);
  }

  return id;
}

function isPlaceholder(val: string): boolean {
  return !val || /^HIER[_\s]|^TODO|^PLACEHOLDER|^xxx/i.test(val);
}

function resolveCredentials(prefix: string): { username: string; password: string } | null {
  const username = process.env[`${prefix}_USER`] ?? "";
  const password = process.env[`${prefix}_PASS`] ?? "";
  if (isPlaceholder(username) || isPlaceholder(password)) return null;
  return { username, password };
}

/**
 * Get calendar sources accessible by an agent, with resolved credentials.
 */
export function getCalendarSources(agentId: string): ResolvedSource[] {
  const config = loadConfig();
  const access = config.agentAccess[agentId];
  if (!access) return [];

  return access.calendars
    .map((binding) => {
      const srcConfig = config.calendarSources[binding.source];
      if (!srcConfig) {
        log(`WARNING: Calendar source "${binding.source}" not found in config`);
        return null;
      }
      const creds = resolveCredentials(srcConfig.credentialPrefix);
      if (!creds) {
        log(`Calendar source "${binding.source}" disabled (no credentials)`);
        return null;
      }
      return {
        id: binding.source,
        config: srcConfig,
        access: binding.access,
        ...creds,
      };
    })
    .filter((s): s is ResolvedSource => s !== null);
}

/**
 * Get contact sources accessible by an agent, with resolved credentials.
 */
export function getContactSources(agentId: string): ResolvedSource[] {
  const config = loadConfig();
  const access = config.agentAccess[agentId];
  if (!access) return [];

  return access.contacts
    .map((binding) => {
      const srcConfig = config.contactSources[binding.source];
      if (!srcConfig) {
        log(`WARNING: Contact source "${binding.source}" not found in config`);
        return null;
      }
      const creds = resolveCredentials(srcConfig.credentialPrefix);
      if (!creds) {
        log(`Contact source "${binding.source}" disabled (no credentials)`);
        return null;
      }
      return {
        id: binding.source,
        config: srcConfig,
        access: binding.access,
        ...creds,
      };
    })
    .filter((s): s is ResolvedSource => s !== null);
}

/**
 * Check if an agent has write access to a specific source.
 */
export function hasWriteAccess(
  agentId: string,
  sourceId: string,
  kind: "calendars" | "contacts"
): boolean {
  const config = loadConfig();
  const access = config.agentAccess[agentId];
  if (!access) return false;
  const binding = access[kind].find((b) => b.source === sourceId);
  return binding?.access === "readwrite";
}

/**
 * Find a specific source by ID from the agent's allowed sources.
 */
export function findCalendarSource(agentId: string, sourceId: string): ResolvedSource | null {
  return getCalendarSources(agentId).find((s) => s.id === sourceId) ?? null;
}

export function findContactSource(agentId: string, sourceId: string): ResolvedSource | null {
  return getContactSources(agentId).find((s) => s.id === sourceId) ?? null;
}
