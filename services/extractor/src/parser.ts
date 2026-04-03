import { readFileSync } from 'fs';
import { basename, dirname } from 'path';
import { log } from './config.js';

// ── Types matching actual OpenClaw JSONL format ──

interface ContentBlock {
  type: 'text' | 'thinking' | 'toolCall';
  text?: string;
  thinking?: string;
  toolCall?: unknown;
}

interface JMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content: ContentBlock[];
  timestamp?: number;
}

interface JRecord {
  type: 'session' | 'message' | 'model_change' | 'thinking_level_change' | 'custom';
  id?: string;
  parentId?: string;
  timestamp?: string;
  message?: JMessage;
}

export interface Turn {
  turnIndex: number;
  userText: string;
  assistantText: string;
  timestamp: string; // ISO8601 from the user message
  sessionId: string;
  agentId: string;
}

const NOISE_PATTERNS = ['HEARTBEAT_OK', 'NO_REPLY'];

function extractText(content: ContentBlock[]): string {
  return content
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('\n')
    .trim();
}

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some(p => text.includes(p));
}

/**
 * Extract the agentId from a session file path.
 * Path pattern: ~/.openclaw/agents/<agentId>/sessions/<file>.jsonl
 */
export function agentIdFromPath(filePath: string): string {
  const sessionsDir = dirname(filePath);        // .../agents/<agentId>/sessions
  const agentDir = dirname(sessionsDir);         // .../agents/<agentId>
  return basename(agentDir);
}

/**
 * Extract the sessionId from the first line (session header) or filename.
 */
function sessionIdFromFile(filePath: string, lines: string[]): string {
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as JRecord;
      if (rec.type === 'session' && rec.id) return rec.id;
    } catch { /* skip */ }
    break; // only check first line
  }
  return basename(filePath, '.jsonl');
}

/**
 * Parse a JSONL file (or buffer from a byte offset) into Turns.
 */
export function parseBuffer(buffer: string, filePath: string, startTurnIndex: number = 0): Turn[] {
  const lines = buffer.split('\n').filter(l => l.trim());
  const agentId = agentIdFromPath(filePath);
  const sessionId = sessionIdFromFile(filePath, lines);

  // Collect user and assistant messages in order
  const messages: { role: 'user' | 'assistant'; text: string; timestamp: string }[] = [];

  for (const line of lines) {
    let rec: JRecord;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    if (rec.type !== 'message' || !rec.message) continue;
    const msg = rec.message;

    // Only user and assistant messages
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;

    const text = extractText(msg.content);
    if (!text) continue;
    if (isNoise(text)) continue;

    const timestamp = rec.timestamp ?? new Date(msg.timestamp ?? Date.now()).toISOString();
    messages.push({ role: msg.role, text, timestamp });
  }

  // Pair user+assistant into turns
  const turns: Turn[] = [];
  let turnIndex = startTurnIndex;
  let i = 0;

  while (i < messages.length) {
    // Find next user message
    if (messages[i].role !== 'user') {
      i++;
      continue;
    }

    const userMsg = messages[i];
    i++;

    // Find the following assistant message (skip any extra user messages)
    // If multiple assistant messages follow, take the last one before the next user
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
    });
    turnIndex++;
  }

  return turns;
}

/**
 * Parse a complete JSONL file from disk (OpenClaw session format).
 */
export function parseFile(filePath: string, byteOffset: number = 0, startTurnIndex: number = 0): { turns: Turn[]; bytesRead: number } {
  const fullBuffer = readFileSync(filePath, 'utf-8');
  const buffer = byteOffset > 0 ? fullBuffer.slice(byteOffset) : fullBuffer;
  const turns = parseBuffer(buffer, filePath, startTurnIndex);

  log('debug', 'parser', `Parsed ${filePath}: ${turns.length} turns from offset ${byteOffset}`);

  return {
    turns,
    bytesRead: Buffer.byteLength(fullBuffer, 'utf-8'),
  };
}

/**
 * Parse a joined day-log file (simplified JoinedTurn format).
 * Each line is a JSON object: {turnIndex, userText, assistantText, timestamp, sessionId, agentId, channel}
 */
export function parseDayLog(filePath: string, byteOffset: number = 0): { turns: Turn[]; bytesRead: number } {
  const fullBuffer = readFileSync(filePath, 'utf-8');
  const buffer = byteOffset > 0 ? fullBuffer.slice(byteOffset) : fullBuffer;
  const lines = buffer.split('\n').filter(l => l.trim());

  const turns: Turn[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as {
        turnIndex: number;
        userText: string;
        assistantText: string;
        timestamp: string;
        sessionId: string;
        agentId: string;
        channel?: string;
      };
      if (obj.userText && obj.assistantText) {
        turns.push({
          turnIndex: obj.turnIndex,
          userText: obj.userText,
          assistantText: obj.assistantText,
          timestamp: obj.timestamp,
          sessionId: obj.sessionId,
          agentId: obj.agentId,
        });
      }
    } catch {
      continue;
    }
  }

  log('debug', 'parser', `Parsed day-log ${basename(filePath)}: ${turns.length} turns from offset ${byteOffset}`);

  return {
    turns,
    bytesRead: Buffer.byteLength(fullBuffer, 'utf-8'),
  };
}
