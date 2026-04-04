import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env is optional
  }
}

// Load .env from project root
loadEnv(resolve(import.meta.dirname, '..', '.env'));

function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val !== undefined) return val;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${key}`);
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val !== undefined ? parseInt(val, 10) : fallback;
}

// Load agent IDs from AGENT_IDS env var (comma-separated) or auto-detect from openclaw.json
function loadAgentIds(): string[] {
  const envIds = process.env.AGENT_IDS?.trim();
  if (envIds) {
    return envIds.split(',').map(id => id.trim()).filter(Boolean);
  }
  // Auto-detect from openclaw.json
  try {
    const ocPath = resolve(process.env.OPENCLAW_STATE_DIR ?? `${process.env.HOME}/.openclaw`, 'openclaw.json');
    const content = readFileSync(ocPath, 'utf-8');
    const cfg = JSON.parse(content);
    const ids = (cfg.agents?.list ?? []).map((a: { id: string }) => a.id);
    if (ids.length > 0) return ids;
  } catch {
    // fallback below
  }
  throw new Error('No agent IDs found. Set AGENT_IDS env var or ensure openclaw.json exists with agents.list');
}

// Load agent display names from openclaw.json
function loadAgentNames(): Record<string, string> {
  const names: Record<string, string> = {};
  try {
    const ocPath = resolve(process.env.OPENCLAW_STATE_DIR ?? `${process.env.HOME}/.openclaw`, 'openclaw.json');
    const content = readFileSync(ocPath, 'utf-8');
    const cfg = JSON.parse(content);
    for (const agent of cfg.agents?.list ?? []) {
      names[agent.id] = agent.name ?? agent.id;
    }
  } catch {
    // fallback to agent IDs
  }
  return names;
}

export const config = {
  minimaxApiKey: env('MINIMAX_API_KEY'),
  minimaxBaseUrl: env('MINIMAX_BASE_URL', 'https://api.minimax.io/v1'),
  extractionModel: env('EXTRACTION_MODEL', 'MiniMax-M2.7'),
  embedGpuUrl: env('EMBED_GPU_URL', env('OLLAMA_GPU_URL', 'http://localhost:8081')),
  embedLocalUrl: env('EMBED_LOCAL_URL', env('OLLAMA_LOCAL_URL', 'http://localhost:8081')),
  qdrantUrl: env('QDRANT_URL', 'http://localhost:6333'),
  openclawStateDir: env('OPENCLAW_STATE_DIR', `${process.env.HOME}/.openclaw`),
  embeddingModel: env('EMBEDDING_MODEL', 'bge-m3'),
  slidingWindowBefore: envInt('SLIDING_WINDOW_BEFORE', 3),
  slidingWindowAfter: envInt('SLIDING_WINDOW_AFTER', 2),
  turnWaitTimeoutMs: envInt('TURN_WAIT_TIMEOUT_MS', 30000),
  logLevel: env('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
  stateDbPath: resolve(import.meta.dirname, '..', 'state.db'),
  agents: loadAgentIds(),
  // Verifier config
  verifierUrl: env('VERIFIER_URL', 'http://localhost:8080'),
  verifierModel: env('VERIFIER_MODEL', 'Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf'),
  verifierEnabled: env('VERIFIER_ENABLED', 'true') === 'true',
  // Known facts config
  knownFactsLimit: envInt('KNOWN_FACTS_LIMIT', 10),
  knownFactsScoreThreshold: parseFloat(env('KNOWN_FACTS_SCORE_THRESHOLD', '0.3')),
  // Quality thresholds
  confidenceFloor: parseFloat(env('CONFIDENCE_FLOOR', '0.5')),
  semanticDedupThreshold: parseFloat(env('SEMANTIC_DEDUP_THRESHOLD', '0.92')),
  // Feature flag: 'sdk' uses Claude Agent SDK + Structured Output, 'legacy' uses direct MiniMax calls
  extractorEngine: env('EXTRACTOR_ENGINE', 'legacy') as 'sdk' | 'legacy',
  // Agent display names (loaded from openclaw.json)
  agentNames: loadAgentNames(),
} as const;

// Simple structured logger
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

export function log(level: keyof typeof LOG_LEVELS, module: string, msg: string, data?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[config.logLevel]) return;
  const ts = new Date().toISOString();
  const prefix = `${ts} [${level.toUpperCase().padEnd(5)}] [${module}]`;
  if (data) {
    console.log(`${prefix} ${msg}`, JSON.stringify(data));
  } else {
    console.log(`${prefix} ${msg}`);
  }
}
