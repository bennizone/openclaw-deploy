import { config, log } from './config.js';
import { initDb, closeDb } from './offset.js';
import { initQdrant, ensureCollections } from './qdrant.js';
import { runBackfill, startWatch, flushPending } from './watcher.js';
import { joinBackfill, startJoinWatch } from './joiner.js';

let shuttingDown = false;

async function checkConnectivity(): Promise<boolean> {
  // Check Qdrant
  try {
    const resp = await fetch(`${config.qdrantUrl}/collections`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`Qdrant returned ${resp.status}`);
    log('info', 'startup', `Qdrant: OK (${config.qdrantUrl})`);
  } catch (err) {
    log('error', 'startup', `Qdrant unreachable at ${config.qdrantUrl}: ${(err as Error).message}`);
    return false;
  }

  // Check embedding server (GPU — non-fatal if fails, fallback exists)
  try {
    const resp = await fetch(`${config.embedGpuUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      log('info', 'startup', `Embedding GPU: OK (${config.embedGpuUrl})`);
    }
  } catch {
    log('warn', 'startup', `Embedding GPU not reachable (${config.embedGpuUrl}) — will use local fallback`);
  }

  // Check embedding local fallback
  try {
    const resp = await fetch(`${config.embedLocalUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      log('info', 'startup', `Embedding local: OK (${config.embedLocalUrl})`);
    }
  } catch {
    log('warn', 'startup', `Embedding local not reachable (${config.embedLocalUrl})`);
  }

  // Check MiniMax (test auth)
  try {
    const resp = await fetch(`${config.minimaxBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.minimaxApiKey}`,
      },
      body: JSON.stringify({
        model: config.extractionModel,
        messages: [{ role: 'user', content: 'OK' }],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      log('info', 'startup', `MiniMax: OK (${config.extractionModel})`);
    } else {
      const body = await resp.text();
      log('error', 'startup', `MiniMax auth failed: ${resp.status} ${body.slice(0, 200)}`);
      return false;
    }
  } catch (err) {
    log('error', 'startup', `MiniMax unreachable: ${(err as Error).message}`);
    return false;
  }

  return true;
}

async function main(): Promise<void> {
  log('info', 'startup', '═══════════════════════════════════════════');
  log('info', 'startup', 'OpenClaw Memory Extractor v1.0.0');
  log('info', 'startup', `State dir: ${config.openclawStateDir}`);
  log('info', 'startup', `Agents: ${config.agents.join(', ')}`);
  log('info', 'startup', `Engine: ${config.extractorEngine}`);
  log('info', 'startup', `Log level: ${config.logLevel}`);
  log('info', 'startup', '═══════════════════════════════════════════');

  // 1. Check connectivity
  const ok = await checkConnectivity();
  if (!ok) {
    log('error', 'startup', 'Connectivity check failed — aborting');
    process.exit(1);
  }

  // 2. Init SQLite
  initDb();

  // 3. Init Qdrant collections
  initQdrant();
  await ensureCollections();

  // 4. Join sessions into day-logs
  log('info', 'startup', 'Joining sessions into day-logs...');
  const joinResult = joinBackfill();
  log('info', 'startup', `Join done: ${joinResult.processed} sessions, ${joinResult.turns} turns`);

  // 5. Backfill extractor on joined logs
  log('info', 'startup', 'Starting extraction backfill...');
  await runBackfill();

  // 6. Start watchers (joiner + extractor)
  log('info', 'startup', 'Starting watchers...');
  startJoinWatch();
  startWatch();

  log('info', 'startup', 'Extractor running. Waiting for new session data...');
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'shutdown', `Received ${signal}, shutting down gracefully...`);
  await flushPending();
  closeDb();
  log('info', 'shutdown', 'Bye.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch(err => {
  log('error', 'startup', `Fatal: ${(err as Error).message}`);
  process.exit(1);
});
