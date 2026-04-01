import { appendFileSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = process.env.OPENCLAW_TOOLS_LOG_DIR
  ?? join(process.env.HOME ?? "/tmp", ".openclaw", "logs", "tools");
const RETENTION_DAYS = 7;

let initialized = false;

function ensureDir(): void {
  if (initialized) return;
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* exists */ }
  initialized = true;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function logFile(): string {
  return join(LOG_DIR, `${today()}.log`);
}

function cleanOld(): void {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    for (const f of readdirSync(LOG_DIR)) {
      if (!f.endsWith(".log")) continue;
      const dateStr = f.replace(".log", "");
      const fileDate = new Date(dateStr).getTime();
      if (fileDate && fileDate < cutoff) {
        unlinkSync(join(LOG_DIR, f));
      }
    }
  } catch { /* ignore */ }
}

export function logToolCall(name: string, input: Record<string, unknown>): void {
  ensureDir();
  const line = `${timestamp()} CALL ${name} ${JSON.stringify(input)}\n`;
  try { appendFileSync(logFile(), line); } catch { /* ignore */ }
}

export function logToolResult(name: string, result: string, durationMs: number): void {
  ensureDir();
  const truncated = result.length > 1000 ? result.slice(0, 1000) + "...[truncated]" : result;
  const line = `${timestamp()} RESULT ${name} (${durationMs}ms) ${truncated}\n`;
  try { appendFileSync(logFile(), line); } catch { /* ignore */ }
}

export function logToolError(name: string, error: string, durationMs: number): void {
  ensureDir();
  const line = `${timestamp()} ERROR ${name} (${durationMs}ms) ${error}\n`;
  try { appendFileSync(logFile(), line); } catch { /* ignore */ }
}

// Run cleanup once on import
cleanOld();
