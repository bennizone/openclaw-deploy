import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import chokidar from 'chokidar';
import { config, log } from './config.js';
import { parseFile, agentIdFromPath } from './parser.js';
import { getOffset, setOffset } from './offset.js';
import { processTurn } from './pipeline.js';

// Track pending last-turns waiting for followup (watch mode only)
const pendingLastTurns: Map<string, { timeout: NodeJS.Timeout; filePath: string; turnIndex: number }> = new Map();

/**
 * Find all JSONL session files across all agents.
 */
function findAllSessionFiles(): string[] {
  const files: string[] = [];
  const agentsDir = join(config.openclawStateDir, 'agents');

  let agents: string[];
  try {
    agents = readdirSync(agentsDir);
  } catch {
    log('warn', 'watcher', `Cannot read agents dir: ${agentsDir}`);
    return files;
  }

  for (const agent of agents) {
    const sessDir = join(agentsDir, agent, 'sessions');
    let sessions: string[];
    try {
      sessions = readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const s of sessions) {
      files.push(join(sessDir, s));
    }
  }

  return files.sort();
}

/**
 * Process a single file from a given byte offset.
 * Returns stats about what was processed.
 */
async function processFile(
  filePath: string,
  mode: 'backfill' | 'watch'
): Promise<{ turns: number; facts: number; written: number }> {
  const state = getOffset(filePath);
  const byteOffset = state?.lastByteOffset ?? 0;
  const startTurnIndex = state?.lastTurnIndex ? state.lastTurnIndex + 1 : 0;

  const { turns, bytesRead } = parseFile(filePath, byteOffset, startTurnIndex);

  if (turns.length === 0) {
    // Still update offset to mark file as seen (avoid re-reading header)
    if (byteOffset === 0 && bytesRead > 0) {
      setOffset(filePath, bytesRead, 0);
    }
    return { turns: 0, facts: 0, written: 0 };
  }

  let totalFacts = 0;
  let totalWritten = 0;

  // In backfill mode, process all turns including last (no followup waiting)
  // In watch mode, hold back slidingWindowAfter turns waiting for followup/correction
  const holdBack = mode === 'backfill' ? 0 : config.slidingWindowAfter;
  const processCount = Math.max(0, turns.length - holdBack);

  for (let i = 0; i < processCount; i++) {
    const result = await processTurn(turns, i, filePath, bytesRead);
    totalFacts += result.extracted;
    totalWritten += result.written;

    if (mode === 'backfill') {
      const agentId = agentIdFromPath(filePath);
      log('info', 'backfill', `[${agentId}] Turn ${turns[i].turnIndex}: ${result.extracted} facts, ${result.written} written`);
    }
  }

  // In watch mode, schedule held-back turns with a timeout
  if (mode === 'watch' && processCount < turns.length) {
    for (let i = processCount; i < turns.length; i++) {
      const heldTurn = turns[i];
      const key = `${filePath}:${heldTurn.turnIndex}`;

      // Cancel any existing timeout for this turn
      const existing = pendingLastTurns.get(key);
      if (existing) clearTimeout(existing.timeout);

      const turnIdx = i;
      const timeout = setTimeout(async () => {
        pendingLastTurns.delete(key);
        log('debug', 'watcher', `Timeout: processing held turn ${heldTurn.turnIndex} without further followup`);
        const result = await processTurn(turns, turnIdx, filePath, bytesRead);
        totalFacts += result.extracted;
        totalWritten += result.written;
      }, config.turnWaitTimeoutMs);

      pendingLastTurns.set(key, { timeout, filePath, turnIndex: heldTurn.turnIndex });
    }
  }

  // If all turns processed (backfill), update final offset
  if (mode === 'backfill') {
    setOffset(filePath, bytesRead, turns[turns.length - 1].turnIndex);
  }

  return { turns: processCount, facts: totalFacts, written: totalWritten };
}

/**
 * Run backfill: process all existing session files.
 */
export async function runBackfill(): Promise<void> {
  const files = findAllSessionFiles();
  log('info', 'backfill', `Starting backfill: ${files.length} files found`);

  let totalTurns = 0;
  let totalFacts = 0;
  let totalWritten = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const agentId = agentIdFromPath(file);

    // Skip agents we don't track
    if (!config.agents.includes(agentId as typeof config.agents[number])) {
      log('debug', 'backfill', `Skipping unknown agent: ${agentId}`);
      continue;
    }

    const state = getOffset(file);
    const fileSize = statSync(file).size;

    // Skip fully processed files
    if (state && state.lastByteOffset >= fileSize) {
      log('debug', 'backfill', `Skipping fully processed: ${file}`);
      continue;
    }

    log('info', 'backfill', `[${i + 1}/${files.length}] ${agentId}/${file.split('/').pop()}`);
    const result = await processFile(file, 'backfill');
    totalTurns += result.turns;
    totalFacts += result.facts;
    totalWritten += result.written;
  }

  log('info', 'backfill', `Done: ${files.length} files, ${totalTurns} turns, ${totalFacts} facts extracted, ${totalWritten} written to Qdrant`);
}

/**
 * Start watching for new session data.
 */
export function startWatch(): void {
  const watchPattern = join(config.openclawStateDir, 'agents', '*', 'sessions', '*.jsonl');
  log('info', 'watcher', `Watching: ${watchPattern}`);

  const watcher = chokidar.watch(watchPattern, {
    persistent: true,
    usePolling: true,     // Required for LXC containers
    interval: 2000,
    ignoreInitial: true,  // Backfill handles existing files
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 500,
    },
  });

  watcher.on('change', async (filePath: string) => {
    const agentId = agentIdFromPath(filePath);
    if (!config.agents.includes(agentId as typeof config.agents[number])) return;

    log('debug', 'watcher', `File changed: ${filePath}`);

    // Check if we have a pending last turn — if new data arrived, process it with followup
    for (const [key, pending] of pendingLastTurns.entries()) {
      if (key.startsWith(filePath + ':')) {
        clearTimeout(pending.timeout);
        pendingLastTurns.delete(key);
        log('debug', 'watcher', `Followup arrived for turn ${pending.turnIndex}`);
      }
    }

    try {
      const result = await processFile(filePath, 'watch');
      if (result.turns > 0) {
        log('info', 'watcher', `[${agentId}] ${result.turns} turns → ${result.facts} facts, ${result.written} written`);
      }
    } catch (err) {
      log('error', 'watcher', `Error processing ${filePath}: ${(err as Error).message}`);
    }
  });

  watcher.on('add', async (filePath: string) => {
    const agentId = agentIdFromPath(filePath);
    if (!config.agents.includes(agentId as typeof config.agents[number])) return;

    log('info', 'watcher', `New session file: ${filePath}`);
    try {
      await processFile(filePath, 'watch');
    } catch (err) {
      log('error', 'watcher', `Error processing new file ${filePath}: ${(err as Error).message}`);
    }
  });
}

/**
 * Flush all pending last turns (for graceful shutdown).
 */
export async function flushPending(): Promise<void> {
  for (const [key, pending] of pendingLastTurns.entries()) {
    clearTimeout(pending.timeout);
    pendingLastTurns.delete(key);
    log('info', 'watcher', `Flushing pending turn ${pending.turnIndex} from ${pending.filePath}`);
    // We could process the turn here but during shutdown we just save state
  }
}
