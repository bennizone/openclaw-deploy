import { readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import chokidar from 'chokidar';
import { config, log } from './config.js';
import { parseFile, parseDayLog, agentIdFromPath, type Turn } from './parser.js';
import { getOffset, setOffset } from './offset.js';
import { processTurn, processTurnBatch } from './pipeline.js';
import { getLogsDir } from './joiner.js';

// Track pending last-turns waiting for followup (watch mode only)
const pendingLastTurns: Map<string, { timeout: NodeJS.Timeout; filePath: string; turnIndex: number }> = new Map();

/**
 * Find all joined day-log files in ~/extractor/logs/.
 */
function findAllLogFiles(): string[] {
  const logsDir = getLogsDir();
  try {
    return readdirSync(logsDir)
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('.'))
      .map(f => join(logsDir, f))
      .sort();
  } catch {
    log('warn', 'watcher', `Cannot read logs dir: ${logsDir}`);
    return [];
  }
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

  const batchSize = parseInt(process.env.EXTRACTION_BATCH_SIZE ?? '10', 10);

  if (mode === 'backfill' && processCount >= 2 && batchSize > 1) {
    // Batch mode: process turns in groups
    for (let i = 0; i < processCount; i += batchSize) {
      const count = Math.min(batchSize, processCount - i);
      const result = await processTurnBatch(turns, i, count, filePath, bytesRead);
      totalFacts += result.extracted;
      totalWritten += result.written;
      const agentId = agentIdFromPath(filePath);
      log('info', 'backfill', `[${agentId}] Batch ${i}-${i + count - 1}: ${result.extracted} facts, ${result.written} written`);
    }
  } else {
    // Single-turn mode (watch mode or small batches)
    for (let i = 0; i < processCount; i++) {
      const result = await processTurn(turns, i, filePath, bytesRead);
      totalFacts += result.extracted;
      totalWritten += result.written;

      if (mode === 'backfill') {
        const agentId = agentIdFromPath(filePath);
        log('info', 'backfill', `[${agentId}] Turn ${turns[i].turnIndex}: ${result.extracted} facts, ${result.written} written`);
      }
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
 * Run backfill on joined day-logs.
 * Processes day-logs sequentially (one day at a time), turns within each day serially.
 * This gives the best quality: each turn has growing context + known_facts from previous turns.
 */
export async function runBackfill(): Promise<void> {
  const files = findAllLogFiles();
  log('info', 'backfill', `Starting backfill: ${files.length} day-logs found`);

  let totalTurns = 0;
  let totalFacts = 0;
  let totalWritten = 0;

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const fileName = basename(file);

    const state = getOffset(file);
    const fileSize = statSync(file).size;

    if (state && state.lastByteOffset >= fileSize) {
      log('debug', 'backfill', `Skipping fully processed: ${fileName}`);
      continue;
    }

    const { turns, bytesRead } = parseDayLog(file, state?.lastByteOffset ?? 0);
    if (turns.length === 0) {
      if (!state && bytesRead > 0) setOffset(file, bytesRead, 0);
      continue;
    }

    log('info', 'backfill', `[${fi + 1}/${files.length}] ${fileName}: ${turns.length} turns`);

    // Process each turn serially — growing context within the day
    for (let i = 0; i < turns.length; i++) {
      const result = await processTurn(turns, i, file, bytesRead);
      totalFacts += result.extracted;
      totalWritten += result.written;
      totalTurns++;
    }

    // Mark day-log as processed
    setOffset(file, bytesRead, turns[turns.length - 1].turnIndex);
    log('info', 'backfill', `[${fileName}] Done: ${turns.length} turns, ${totalFacts} facts total`);
  }

  log('info', 'backfill', `Backfill complete: ${totalTurns} turns, ${totalFacts} facts extracted, ${totalWritten} written to Qdrant`);
}

/**
 * Start watching for new session data.
 */
export function startWatch(): void {
  const logsDir = getLogsDir();
  const watchPattern = join(logsDir, '*.jsonl');
  log('info', 'watcher', `Watching day-logs: ${watchPattern}`);

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

  const processDayLog = async (filePath: string) => {
    const fileName = basename(filePath);
    log('debug', 'watcher', `Day-log changed: ${fileName}`);

    try {
      const state = getOffset(filePath);
      const fileSize = statSync(filePath).size;
      if (state && state.lastByteOffset >= fileSize) return;

      const { turns, bytesRead } = parseDayLog(filePath, state?.lastByteOffset ?? 0);
      if (turns.length === 0) return;

      // Process new turns serially (full context from day-log)
      let written = 0;
      for (let i = 0; i < turns.length; i++) {
        const result = await processTurn(turns, i, filePath, bytesRead);
        written += result.written;
      }

      setOffset(filePath, bytesRead, turns[turns.length - 1].turnIndex);
      if (written > 0) {
        log('info', 'watcher', `[${fileName}] ${turns.length} new turns → ${written} facts written`);
      }
    } catch (err) {
      log('error', 'watcher', `Error processing ${fileName}: ${(err as Error).message}`);
    }
  };

  watcher.on('change', processDayLog);
  watcher.on('add', processDayLog);
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
