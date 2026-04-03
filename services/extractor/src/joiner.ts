import { readdirSync, readFileSync, appendFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import chokidar from 'chokidar';
import { config, log } from './config.js';

// --- Types matching OpenClaw JSONL ---

interface ContentBlock {
  type: 'text' | 'thinking' | 'toolCall';
  text?: string;
}

interface JMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content: ContentBlock[];
  timestamp?: number;
}

interface JRecord {
  type: 'session' | 'message' | 'model_change' | 'thinking_level_change' | 'custom';
  id?: string;
  timestamp?: string;
  message?: JMessage;
}

export interface JoinedTurn {
  turnIndex: number;
  userText: string;
  assistantText: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  channel: string;
}

// --- Channel detection ---

type Channel = 'whatsapp' | 'matrix' | 'direct' | 'unknown';

function detectChannel(firstUserText: string): Channel {
  if (firstUserText.includes('Conversation info (untrusted metadata)') ||
      firstUserText.includes('Sender (untrusted metadata)') ||
      firstUserText.includes('[WhatsApp')) {
    return 'whatsapp';
  }
  if (firstUserText.includes('[Matrix') || firstUserText.includes('matrix.org')) {
    return 'matrix';
  }
  // Agent chat sessions have [Erinnerungen] or [Regeln] injected by gateway
  if (firstUserText.includes('[Erinnerungen') || firstUserText.includes('[Regeln')) {
    return 'direct';
  }
  return 'unknown';
}

// --- Session filtering ---

function isConsultSession(firstUserText: string): boolean {
  // consult-agent.sh sessions don't have [Erinnerungen] or [Regeln] prefix
  // and typically start with analysis prompts
  if (firstUserText.includes('[Erinnerungen') || firstUserText.includes('[Regeln')) {
    return false; // Real agent chat
  }
  if (firstUserText.includes('[Memory-System: offline]')) {
    return true; // Memory-offline consult
  }
  // No gateway-injected blocks = likely consult-agent.sh or internal call
  return true;
}

// --- Session parsing ---

interface ParsedSession {
  sessionId: string;
  agentId: string;
  timestamp: string;
  channel: Channel;
  turns: JoinedTurn[];
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('\n')
    .trim();
}

function parseSessionFile(filePath: string): ParsedSession | null {
  const agentDir = dirname(dirname(filePath)); // .../agents/<agentId>
  const agentId = basename(agentDir);
  const sessionId = basename(filePath, '.jsonl');

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  // Get session timestamp
  let sessionTimestamp = new Date().toISOString();
  try {
    const header = JSON.parse(lines[0]) as JRecord;
    if (header.type === 'session' && header.timestamp) {
      sessionTimestamp = header.timestamp;
    }
  } catch { /* use default */ }

  // Collect messages
  const messages: { role: 'user' | 'assistant'; text: string; timestamp: string }[] = [];
  for (const line of lines) {
    let rec: JRecord;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== 'message' || !rec.message) continue;
    const msg = rec.message;
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const text = extractText(msg.content);
    if (!text) continue;
    if (text.includes('HEARTBEAT_OK') || text.includes('NO_REPLY')) continue;
    const timestamp = rec.timestamp ?? new Date(msg.timestamp ?? Date.now()).toISOString();
    messages.push({ role: msg.role, text, timestamp });
  }

  if (messages.length === 0) return null;

  // Detect channel from first user message
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return null;

  // Filter out consult sessions
  if (isConsultSession(firstUser.text)) {
    return null;
  }

  const channel = detectChannel(firstUser.text);

  // Pair into turns
  const turns: JoinedTurn[] = [];
  let turnIndex = 0;
  let i = 0;

  while (i < messages.length) {
    if (messages[i].role !== 'user') { i++; continue; }
    const userMsg = messages[i];
    i++;

    let assistantMsg: typeof messages[0] | null = null;
    while (i < messages.length && messages[i].role === 'assistant') {
      assistantMsg = messages[i];
      i++;
    }
    if (!assistantMsg) continue;

    turns.push({
      turnIndex,
      userText: userMsg.text,
      assistantText: assistantMsg.text,
      timestamp: userMsg.timestamp,
      sessionId,
      agentId,
      channel,
    });
    turnIndex++;
  }

  return turns.length > 0 ? { sessionId, agentId, timestamp: sessionTimestamp, channel, turns } : null;
}

// --- Log file management ---

const logsDir = join(config.openclawStateDir, '..', 'extractor', 'logs');

function ensureLogsDir(): void {
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

function logFileName(date: string, agentId: string, channel: string): string {
  return `${date}_${agentId}_${channel}.jsonl`;
}

function dateFromTimestamp(ts: string): string {
  return ts.slice(0, 10); // YYYY-MM-DD
}

function appendTurnsToLog(turns: JoinedTurn[], agentId: string, channel: string): void {
  ensureLogsDir();

  // Group turns by date
  const byDate = new Map<string, JoinedTurn[]>();
  for (const turn of turns) {
    const date = dateFromTimestamp(turn.timestamp);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(turn);
  }

  for (const [date, dateTurns] of byDate) {
    const fileName = logFileName(date, agentId, channel);
    const filePath = join(logsDir, fileName);

    // Read existing turn count to set correct turnIndex
    let existingTurnCount = 0;
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
      existingTurnCount = existing.length;
    }

    const lines = dateTurns.map((turn, i) => {
      return JSON.stringify({
        ...turn,
        turnIndex: existingTurnCount + i,
      });
    });

    appendFileSync(filePath, lines.join('\n') + '\n');
    log('info', 'joiner', `Appended ${dateTurns.length} turns to ${fileName} (total: ${existingTurnCount + dateTurns.length})`);
  }
}

// --- State tracking (which sessions we've already joined) ---

const joinedSessionsFile = join(logsDir, '.joined-sessions');

function loadJoinedSessions(): Set<string> {
  try {
    const content = readFileSync(joinedSessionsFile, 'utf-8');
    return new Set(content.split('\n').filter(l => l.trim()));
  } catch {
    return new Set();
  }
}

function markSessionJoined(sessionId: string): void {
  appendFileSync(joinedSessionsFile, sessionId + '\n');
}

// --- Public API ---

/**
 * Backfill: process all existing session files and join them into day-logs.
 */
export function joinBackfill(): { processed: number; skipped: number; turns: number } {
  const joinedSessions = loadJoinedSessions();
  let processed = 0;
  let skipped = 0;
  let totalTurns = 0;

  for (const agentId of config.agents) {
    const sessDir = join(config.openclawStateDir, 'agents', agentId, 'sessions');
    let files: string[];
    try {
      files = readdirSync(sessDir).filter(f => f.endsWith('.jsonl')).sort();
    } catch {
      continue;
    }

    for (const file of files) {
      const sessionId = basename(file, '.jsonl');
      if (joinedSessions.has(sessionId)) {
        skipped++;
        continue;
      }

      const parsed = parseSessionFile(join(sessDir, file));
      if (!parsed) {
        // Mark as joined even if filtered out (consult session)
        markSessionJoined(sessionId);
        skipped++;
        continue;
      }

      appendTurnsToLog(parsed.turns, parsed.agentId, parsed.channel);
      markSessionJoined(sessionId);
      processed++;
      totalTurns += parsed.turns.length;
    }
  }

  log('info', 'joiner', `Backfill done: ${processed} sessions joined, ${skipped} skipped, ${totalTurns} turns`);
  return { processed, skipped, turns: totalTurns };
}

/**
 * Watch mode: watch for new session files and join them on the fly.
 */
export function startJoinWatch(): void {
  const watchPattern = join(config.openclawStateDir, 'agents', '*', 'sessions', '*.jsonl');
  log('info', 'joiner', `Watching for new sessions: ${watchPattern}`);

  const joinedSessions = loadJoinedSessions();

  const watcher = chokidar.watch(watchPattern, {
    persistent: true,
    usePolling: true,
    interval: 2000,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  });

  const processSession = (filePath: string) => {
    const sessionId = basename(filePath, '.jsonl');
    if (joinedSessions.has(sessionId)) return;

    const parsed = parseSessionFile(filePath);
    if (!parsed) {
      joinedSessions.add(sessionId);
      markSessionJoined(sessionId);
      return;
    }

    appendTurnsToLog(parsed.turns, parsed.agentId, parsed.channel);
    joinedSessions.add(sessionId);
    markSessionJoined(sessionId);
    log('info', 'joiner', `Joined new session ${sessionId}: ${parsed.turns.length} turns → ${parsed.channel}`);
  };

  watcher.on('add', processSession);
  watcher.on('change', (filePath: string) => {
    // Re-process on change — idempotent because we track by sessionId
    // For now, skip already-joined sessions. Full re-join would need offset tracking.
    const sessionId = basename(filePath, '.jsonl');
    if (!joinedSessions.has(sessionId)) {
      processSession(filePath);
    }
  });
}

/**
 * Get the logs directory path.
 */
export function getLogsDir(): string {
  ensureLogsDir();
  return logsDir;
}
