#!/usr/bin/env node
/**
 * dream.mjs — Täglicher Dream-Prozess für OpenClaw Agenten
 *
 * Läuft nach dem Daily Session Reset (04:00) und "weckt" jeden Agent auf:
 * 1. Findet gestrige WhatsApp/Matrix Sessions
 * 2. Fasst sie via MiniMax zusammen
 * 3. Injiziert Zusammenfassung in die neue Session (chatCompletions API)
 *
 * Usage:
 *   node scripts/dream.mjs
 *   node scripts/dream.mjs --dry-run    # Nur lesen, nichts injecten
 *   node scripts/dream.mjs --weekly     # Weekly Meta-Reflect erzwingen
 *
 * Cron:
 *   1 4 * * * cd /home/openclaw/openclaw-deploy && node scripts/dream.mjs >> /tmp/dream.log 2>&1
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, basename } from 'path';
import { homedir } from 'os';

// --- Config ---

const AGENTS_DIR = join(homedir(), '.openclaw', 'agents');
const ENV_PATH = join(homedir(), '.openclaw', '.env');
const GATEWAY = 'http://localhost:18789';
const QDRANT = 'http://localhost:6333';
const EMBED_URL = process.env.EMBED_URL ?? 'http://10.83.1.110:8081';
const EMBED_FALLBACK = 'http://localhost:8081';
const MAX_TURNS = 50;
const SEMANTIC_DEDUP_THRESHOLD = 0.92;
const DRY_RUN = process.argv.includes('--dry-run');
const BACKFILL = process.argv.includes('--backfill');
const WEEKLY = process.argv.includes('--weekly');
const EXTRACTOR_LOGS = join(homedir(), 'extractor', 'logs');
const REPO_DIR = new URL('..', import.meta.url).pathname;
const CONSULT_SDK = join(REPO_DIR, 'scripts', 'consult-sdk.mjs');
const SUPERSEDE_THRESHOLD = 0.7;

// --- Helpers ---

function log(agent, msg) {
  const ts = new Date().toISOString().slice(0, 19);
  console.log(`[${ts}] [${agent}] ${msg}`);
}

function readEnv(key) {
  try {
    const env = readFileSync(ENV_PATH, 'utf-8');
    const match = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join(' ')
      .trim();
  }
  return '';
}

// --- Qdrant helpers ---

async function getEmbedding(text) {
  for (const url of [EMBED_URL, EMBED_FALLBACK]) {
    try {
      const resp = await fetch(`${url}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'bge-m3', input: text }),
        signal: AbortSignal.timeout(url === EMBED_URL ? 5000 : 15000),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const emb = data.data?.[0]?.embedding;
      if (emb?.length === 1024) return emb;
    } catch { /* try next */ }
  }
  return null;
}

async function checkSemanticDuplicate(collection, vector) {
  try {
    const resp = await fetch(`${QDRANT}/collections/${collection}/points/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: vector,
        using: 'dense',
        limit: 1,
        with_payload: true,
        score_threshold: SEMANTIC_DEDUP_THRESHOLD,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return (data.result?.points?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function ensureCollection(collection) {
  try {
    const resp = await fetch(`${QDRANT}/collections/${collection}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) return true;
  } catch { /* fall through */ }

  // Create collection
  try {
    const resp = await fetch(`${QDRANT}/collections/${collection}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectors: { dense: { size: 1024, distance: 'Cosine' } },
        sparse_vectors: { bm25: { modifier: 'idf' } },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch relevant facts from Qdrant via vector search (pre-filtering for Dream reviews).
 * Returns top matches above threshold.
 */
async function fetchRelevantFacts(collection, queryTexts, limit = 10, threshold = 0.65) {
  const allResults = [];
  const seenIds = new Set();

  for (const text of queryTexts) {
    const vector = await getEmbedding(text);
    if (!vector) continue;

    try {
      const resp = await fetch(`${QDRANT}/collections/${collection}/points/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: vector,
          using: 'dense',
          limit,
          with_payload: true,
          score_threshold: threshold,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const point of data.result?.points ?? []) {
        if (!seenIds.has(point.id)) {
          seenIds.add(point.id);
          allResults.push({
            id: point.id,
            score: point.score,
            ...point.payload,
          });
        }
      }
    } catch { /* skip */ }
  }

  // Sort by score descending, deduplicated
  return allResults.sort((a, b) => b.score - a.score);
}

/**
 * Supersede: Find old fact via vector search and update its payload.
 * Returns the updated point ID or null if not found.
 */
async function supersedeFact(collection, searchQuery, newPayload) {
  const vector = await getEmbedding(searchQuery);
  if (!vector) return null;

  try {
    const resp = await fetch(`${QDRANT}/collections/${collection}/points/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: vector,
        using: 'dense',
        limit: 1,
        with_payload: true,
        score_threshold: SUPERSEDE_THRESHOLD,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const point = data.result?.points?.[0];
    if (!point) return null;

    // Update payload via set_payload API
    const updateResp = await fetch(`${QDRANT}/collections/${collection}/points/payload?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [point.id],
        payload: {
          ...newPayload,
          updatedAt: new Date().toISOString(),
          previousFact: point.payload.fact,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    // Also update the vector if the fact text changed
    if (updateResp.ok && newPayload.fact) {
      const newVector = await getEmbedding(newPayload.fact);
      if (newVector) {
        await fetch(`${QDRANT}/collections/${collection}/points?wait=true`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points: [{
              id: point.id,
              vector: { dense: newVector },
              payload: { ...point.payload, ...newPayload, updatedAt: new Date().toISOString(), previousFact: point.payload.fact },
            }],
          }),
          signal: AbortSignal.timeout(5000),
        });
      }
    }

    return updateResp.ok ? point.id : null;
  } catch {
    return null;
  }
}

/**
 * Lower confidence of an existing fact found via vector search.
 * Returns the point ID or null if not found.
 */
async function lowerConfidence(collection, searchQuery, newConfidence) {
  const vector = await getEmbedding(searchQuery);
  if (!vector) return null;

  try {
    const resp = await fetch(`${QDRANT}/collections/${collection}/points/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: vector,
        using: 'dense',
        limit: 1,
        with_payload: true,
        score_threshold: SUPERSEDE_THRESHOLD,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const point = data.result?.points?.[0];
    if (!point) return null;

    const updateResp = await fetch(`${QDRANT}/collections/${collection}/points/payload?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [point.id],
        payload: {
          confidence: newConfidence,
          updatedAt: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    return updateResp.ok ? point.id : null;
  } catch {
    return null;
  }
}

async function upsertInstruction(collection, instruction, agentId, sessionId) {
  const vector = await getEmbedding(instruction.text);
  if (!vector) {
    log(agentId, `Embedding failed for: ${instruction.text.slice(0, 50)}`);
    return false;
  }

  // Semantic dedup
  if (await checkSemanticDuplicate(collection, vector)) {
    log(agentId, `Dedup skip: ${instruction.text.slice(0, 50)}`);
    return false;
  }

  const id = crypto.randomUUID();
  const resp = await fetch(`${QDRANT}/collections/${collection}/points?wait=true`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      points: [{
        id,
        vector: { dense: vector },
        payload: {
          fact: instruction.text,
          type: 'behavior',
          confidence: instruction.confidence,
          sourceContext: instruction.source?.slice(0, 100) ?? '',
          agentId,
          sessionId,
          turnIndex: 0,
          timestamp: new Date().toISOString(),
          extractedAt: new Date().toISOString(),
          embeddingSource: 'gpu',
          scope: instruction.scope ?? 'personal',
        },
      }],
    }),
    signal: AbortSignal.timeout(5000),
  });

  return resp.ok;
}

// --- Tool-call extraction from JSONL ---

function extractToolCalls(jsonlPath) {
  const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
  const toolCalls = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'message') continue;
      const msg = entry.message;
      if (!msg) continue;

      // Assistant messages with tool_calls
      if (msg.role === 'assistant' && msg.tool_calls?.length > 0) {
        for (const tc of msg.tool_calls) {
          toolCalls.push({
            name: tc.function?.name ?? 'unknown',
            args: tc.function?.arguments ?? '{}',
            timestamp: entry.timestamp,
          });
        }
      }

      // Tool results
      if (msg.role === 'tool' || msg.role === 'toolResult') {
        const content = extractTextContent(msg.content);
        if (toolCalls.length > 0) {
          const last = toolCalls[toolCalls.length - 1];
          if (!last.result) {
            last.result = content?.slice(0, 200) ?? '';
            last.success = !content?.toLowerCase().includes('error');
          }
        }
      }
    } catch { continue; }
  }

  return toolCalls;
}

// --- Behavior extraction via LLM ---

async function extractBehaviors(messages, toolCalls, agentId, minimaxKey) {
  if (!minimaxKey || (messages.length < 3 && toolCalls.length === 0)) return [];

  const transcript = messages
    .slice(-30)
    .map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`)
    .join('\n');

  const toolSummary = toolCalls.length > 0
    ? '\n\nTool-Aufrufe:\n' + toolCalls
        .slice(-20)
        .map(tc => `- ${tc.name}(${tc.args.slice(0, 80)}) → ${tc.success ? 'OK' : 'FEHLER'}${tc.result ? ': ' + tc.result.slice(0, 60) : ''}`)
        .join('\n')
    : '';

  // Use MiniMax API directly (not via gateway) to avoid agent context pollution
  const resp = await fetch('https://api.minimax.io/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${minimaxKey}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'system',
          content: `Du bist ein interner Analyse-Dienst. Extrahiere aus der Konversation wiederkehrende Verhaltensmuster und Tool-Nutzungs-Hinweise.

Gib ein JSON-Array zurück. Jeder Eintrag hat:
- "text": Die Anweisung/Regel (5-200 Zeichen, auf Deutsch, als Imperativ)
- "confidence": 0.7-1.0
- "source": Kurzes Zitat das die Regel belegt (max 80 Zeichen)
- "scope": "personal" oder "household"

Beispiele guter Instructions:
- "Bei Serien-Suchen immer den deutschen Titel verwenden"
- "sonarr_search: Parameter 'term' nutzen, nicht 'query'"
- "User bevorzugt kurze Antworten ohne Emojis"
- "Bei Wetter-Fragen immer den aktuellen Standort aus device_tracker nutzen"

NUR Muster die WIEDERHOLT auftreten oder klar als Präferenz erkennbar sind.
KEINE einmaligen Fakten, keine Smalltalk-Inhalte.
Bei weniger als 3 klaren Mustern: leeres Array [] zurückgeben.
Antwort NUR als JSON-Array, kein Markdown, kein Text drumherum.`,
        },
        {
          role: 'user',
          content: `Konversation:\n${transcript}${toolSummary}`,
        },
      ],
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!resp.ok) {
    log(agentId, `Behavior extraction API error: ${resp.status}`);
    return [];
  }

  const data = await resp.json();
  let content = data.choices?.[0]?.message?.content?.trim() ?? '[]';

  // MiniMax may also return reasoning_content separately
  if (data.choices?.[0]?.message?.reasoning_content) {
    // reasoning is separate, content should be clean
  }

  try {
    // Strip thinking tags (closed or unclosed), markdown wrapping
    const cleaned = content
      .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')  // Strip thinking (even unclosed)
      .replace(/^```json?\n?/g, '').replace(/\n?```$/g, '')
      .trim()
      // Find the JSON array in the remaining text
      .replace(/^[^[]*(\[[\s\S]*\])[^]]*$/, '$1');
    const behaviors = JSON.parse(cleaned);
    if (!Array.isArray(behaviors)) return [];
    return behaviors.filter(b =>
      b.text?.length >= 5 && b.text?.length <= 500 &&
      b.confidence >= 0.7
    );
  } catch {
    // Not an error if the model returned text instead of JSON — means no patterns found
    if (cleaned.startsWith('[')) {
      log(agentId, `Failed to parse behaviors JSON: ${cleaned.slice(0, 80)}`);
    } else {
      log(agentId, `  No behavioral patterns found (model returned text)`);
    }
    return [];
  }
}

// --- Dream v2: SDK wrapper + action executor ---

/**
 * Call consult-sdk.mjs with Dream-specific options.
 * Returns parsed JSON or null on failure.
 */
function callDreamSDK(prompt, { inputFile, contextFile, maxTurns = 20, agentId = 'dream' }) {
  const args = [
    CONSULT_SDK,
    '--question', prompt,
    '--output-format', 'json',
    '--max-turns', String(maxTurns),
  ];
  if (inputFile) args.push('--input-file', inputFile);
  if (contextFile) args.push('--context-file', contextFile);

  const SDK_TIMEOUT = 300000;
  const startMs = Date.now();
  try {
    const result = execFileSync('node', args, {
      cwd: REPO_DIR,
      timeout: SDK_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    const durationSec = Math.round((Date.now() - startMs) / 1000);
    if (durationSec > SDK_TIMEOUT / 1000 * 0.8) {
      log(agentId, `SDK call took ${durationSec}s (timeout: ${SDK_TIMEOUT / 1000}s) — near limit!`);
    } else {
      log(agentId, `SDK call took ${durationSec}s`);
    }

    // Parse JSON from result — strip any non-JSON prefix/suffix
    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      log(agentId, `SDK returned no JSON array: ${result.slice(0, 100)}`);
      return null;
    }
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    const durationSec = Math.round((Date.now() - startMs) / 1000);
    log(agentId, `SDK call failed after ${durationSec}s: ${err.message?.slice(0, 100)}`);
    return null;
  }
}

/**
 * Execute new/supersede/lower actions from SDK review results.
 * Returns stats object.
 */
async function executeActions(actions, collection, agentId) {
  const stats = { new: 0, superseded: 0, lowered: 0, skipped: 0 };

  for (const action of actions) {
    try {
      if (action.action === 'new') {
        const ok = await upsertInstruction(collection, {
          text: action.text,
          confidence: action.confidence ?? 0.8,
          source: action.source ?? 'dream-v2',
          scope: action.scope ?? 'personal',
        }, agentId, 'dream-v2');
        if (ok) stats.new++;
        else stats.skipped++;
      } else if (action.action === 'supersede') {
        const id = await supersedeFact(collection, action.search, {
          fact: action.text,
          confidence: action.confidence ?? 0.8,
        });
        if (id) stats.superseded++;
        else stats.skipped++;
      } else if (action.action === 'lower') {
        const id = await lowerConfidence(collection, action.search, action.confidence ?? 0.4);
        if (id) stats.lowered++;
        else stats.skipped++;
      }
    } catch (err) {
      log(agentId, `Action failed: ${err.message?.slice(0, 80)}`);
      stats.skipped++;
    }
  }

  return stats;
}

/**
 * Find today's extractor log for an agent+channel combo.
 * Uses the 04:00-04:00 day boundary (handled by extractor's dateFromTimestamp).
 */
function findExtractorLog(agentId, channel) {
  if (!existsSync(EXTRACTOR_LOGS)) return null;

  // Yesterday's date (04:00-04:00 boundary: subtract 4 hours from now)
  const d = new Date();
  d.setHours(d.getHours() - 4);
  const dateStr = d.toISOString().slice(0, 10);

  const fileName = `${dateStr}_${agentId}_${channel}.jsonl`;
  const filePath = join(EXTRACTOR_LOGS, fileName);
  if (existsSync(filePath)) return filePath;

  // Fallback: try previous day (edge case around 04:00 boundary)
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  const prevDateStr = prev.toISOString().slice(0, 10);
  const prevPath = join(EXTRACTOR_LOGS, `${prevDateStr}_${agentId}_${channel}.jsonl`);
  return existsSync(prevPath) ? prevPath : null;
}

/**
 * Find ALL extractor logs for an agent+channel (for backfill).
 * Returns array of paths, newest first.
 */
function findAllExtractorLogs(agentId, channel) {
  if (!existsSync(EXTRACTOR_LOGS)) return [];
  const pattern = `_${agentId}_${channel}.jsonl`;
  return readdirSync(EXTRACTOR_LOGS)
    .filter(f => f.endsWith(pattern))
    .sort()
    .reverse()
    .map(f => join(EXTRACTOR_LOGS, f));
}

// --- Step 1: Find agents with channel sessions ---

function findAgentSessions() {
  const results = [];

  let agentDirs;
  try {
    agentDirs = readdirSync(AGENTS_DIR);
  } catch {
    console.error('No agents directory found at', AGENTS_DIR);
    return results;
  }

  for (const agentId of agentDirs) {
    const sessionsFile = join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
    let sessions;
    try {
      sessions = JSON.parse(readFileSync(sessionsFile, 'utf-8'));
    } catch {
      continue;
    }

    // Find channel-bound sessions (WhatsApp, Matrix) — skip openai-user duplicates
    for (const [key, meta] of Object.entries(sessions)) {
      if ((key.includes('whatsapp') || key.includes('matrix')) && !key.includes('openai-user')) {
        results.push({
          agentId,
          sessionKey: key,
          currentSessionId: meta.sessionId,
          sessionsDir: join(AGENTS_DIR, agentId, 'sessions'),
        });
      }
    }
  }

  return results;
}

// --- Step 2: Find yesterday's session ---

function findRecentSessions(sessionsDir, currentSessionId, maxDays = 1) {
  let jsonlFiles;
  try {
    jsonlFiles = readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: join(sessionsDir, f),
        mtime: statSync(join(sessionsDir, f)).mtimeMs,
        size: statSync(join(sessionsDir, f)).size,
        sessionId: f.replace('.jsonl', ''),
      }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }

  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;

  // Filter: skip current, within time range, and at least 1KB (non-trivial sessions)
  const candidates = jsonlFiles.filter(f =>
    f.sessionId !== currentSessionId &&
    f.mtime > cutoff &&
    f.size > 1024
  );

  // Deduplicate by date (one session per day, the largest one)
  const byDate = new Map();
  for (const f of candidates) {
    const date = new Date(f.mtime).toISOString().slice(0, 10);
    const existing = byDate.get(date);
    if (!existing || f.size > existing.size) {
      byDate.set(date, f);
    }
  }

  return [...byDate.values()]
    .sort((a, b) => b.mtime - a.mtime)
    .map(f => f.path);
}

function findYesterdaySession(sessionsDir, currentSessionId) {
  const sessions = findRecentSessions(sessionsDir, currentSessionId, 2);
  return sessions.length > 0 ? sessions[0] : null;
}

// --- Step 3: Extract messages from JSONL ---

function cleanUserText(text) {
  return text
    .replace(/\[Regeln[^\]]*\][\s\S]*?\[\/Regeln\]/g, '')
    .replace(/\[Erinnerungen[^\]]*\][\s\S]*?\[\/Erinnerungen\]/g, '')
    .replace(/\[Anweisungen[^\]]*\][\s\S]*?\[\/Anweisungen\]/g, '')
    .replace(/\[Hinweise[^\]]*\][\s\S]*?\[\/Hinweise\]/g, '')
    .replace(/\[Memory-System[^\]]*\][\s\S]*?\[\/Memory-System\]/g, '')
    .replace(/Conversation info \(untrusted metadata\):[\s\S]*?```\n/g, '')
    .replace(/Sender \(untrusted metadata\):[\s\S]*?```\n/g, '')
    .trim();
}

function extractMessages(jsonlPath) {
  const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
  const messages = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Extractor log format (JoinedTurn): has userText/assistantText
      if (entry.userText != null && entry.assistantText != null) {
        const userCleaned = cleanUserText(entry.userText);
        if (userCleaned.length >= 2) {
          messages.push({ role: 'user', text: userCleaned.slice(0, 500) });
        }
        const assistantText = entry.assistantText
          .replace(/<final>([\s\S]*?)<\/final>/g, '$1')
          .trim();
        if (assistantText.length >= 2) {
          messages.push({ role: 'assistant', text: assistantText.slice(0, 500) });
        }
        continue;
      }

      // Raw JSONL format: has type/message
      if (entry.type !== 'message') continue;

      const msg = entry.message;
      if (!msg || !msg.role) continue;

      if (msg.role !== 'user' && msg.role !== 'assistant') continue;

      const text = extractTextContent(msg.content);
      if (!text || text.length < 2) continue;

      const cleaned = cleanUserText(text);
      if (cleaned.length < 2) continue;

      messages.push({ role: msg.role, text: cleaned.slice(0, 500) });
    } catch {
      continue;
    }
  }

  // Take last N turns
  return messages.slice(-MAX_TURNS);
}

// --- Step 4: Summarize via MiniMax ---

async function summarizeSession(messages, token) {
  if (messages.length === 0) return null;

  // Build conversation transcript
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistent'}: ${m.text}`)
    .join('\n');

  const resp = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-OpenClaw-Scopes': 'operator.write',
    },
    body: JSON.stringify({
      model: 'openclaw',
      messages: [
        {
          role: 'system',
          content: 'Du bist ein interner Dienst. Fasse die folgende Konversation in 2-3 kurzen Sätzen auf Deutsch zusammen. Nenne die Hauptthemen und was offen geblieben ist. Keine Begrüßung, kein Markdown.',
        },
        {
          role: 'user',
          content: `Konversation vom gestrigen Tag:\n\n${transcript}`,
        },
      ],
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    throw new Error(`Summary API error: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

// --- Step 5: Inject summary into new session ---

async function injectSummary(sessionKey, summary, token) {
  const today = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const message = `Neuer Tag: ${today}. Zusammenfassung gestern: ${summary} — Halte dich bereit.`;

  const resp = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-OpenClaw-Scopes': 'operator.write',
    },
    body: JSON.stringify({
      model: 'openclaw',
      user: sessionKey,
      messages: [
        { role: 'user', content: message },
      ],
      max_tokens: 200,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    throw new Error(`Inject API error: ${resp.status} ${await resp.text()}`);
  }

  return await resp.json();
}

// --- Main ---

async function processAgent(agent, token, minimaxKey) {
  const { agentId, sessionKey, currentSessionId, sessionsDir } = agent;
  const startTime = Date.now();

  log(agentId, `Processing ${sessionKey}`);

  // Determine channel from sessionKey
  const channel = sessionKey.includes('whatsapp') ? 'whatsapp' : sessionKey.includes('matrix') ? 'matrix' : 'direct';

  const report = {
    agentId,
    channel,
    messages: 0,
    toolCalls: 0,
    memoryActions: [],
    behaviorActions: [],
    reflectActions: [],
    summary: null,
    sdkCalls: 0,
    qdrantWrites: { new: 0, superseded: 0, lowered: 0, skipped: 0 },
    durationMs: 0,
  };

  // --- Step 1: Find extractor log(s) or fall back to JSONL sessions ---
  let inputPaths = [];

  if (BACKFILL) {
    // Backfill: process ALL extractor logs for this agent+channel
    inputPaths = findAllExtractorLogs(agentId, channel);
    if (inputPaths.length === 0) {
      // Fallback to raw sessions
      inputPaths = findRecentSessions(sessionsDir, currentSessionId, 7);
    }
  } else {
    const extractorLogPath = findExtractorLog(agentId, channel);
    if (extractorLogPath) {
      inputPaths = [extractorLogPath];
    } else {
      const sessionPath = findYesterdaySession(sessionsDir, currentSessionId);
      if (sessionPath) inputPaths = [sessionPath];
    }
  }

  if (inputPaths.length === 0) {
    log(agentId, 'No extractor log or session found — skipping');
    return { ...report, status: 'no_data' };
  }

  log(agentId, `${BACKFILL ? 'Backfill: ' : ''}${inputPaths.length} log(s) to process`);

  // Process each log
  const memoriesCollection = `memories_${agentId}`;
  const instructionsCollection = `instructions_${agentId}`;
  let lastMessages = [];

  for (const inputPath of inputPaths) {
    log(agentId, `--- ${basename(inputPath)} ---`);
    const messages = extractMessages(inputPath);

    if (messages.length === 0) {
      log(agentId, 'No messages — skipping');
      continue;
    }

    report.messages += messages.length;
    lastMessages = messages;
    log(agentId, `${messages.length} messages`);

    // --- Step 3: Pre-filter relevant facts from Qdrant ---
    const userTexts = messages.filter(m => m.role === 'user').map(m => m.text).slice(-10);

    const existingFacts = await fetchRelevantFacts(memoriesCollection, userTexts, 10, 0.65);
    const existingBehaviors = await fetchRelevantFacts(instructionsCollection, userTexts, 10, 0.65);

    log(agentId, `Pre-filtered: ${existingFacts.length} facts, ${existingBehaviors.length} behaviors`);

    // --- Step 4: Write temp context files for SDK ---
    const tmpDir = '/tmp/dream-v2';
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    const factsContextFile = join(tmpDir, `${agentId}-facts.json`);
    const behaviorsContextFile = join(tmpDir, `${agentId}-behaviors.json`);
    writeFileSync(factsContextFile, JSON.stringify(existingFacts.map(f => ({
      fact: f.fact, confidence: f.confidence, id: f.id,
    })), null, 2));
    writeFileSync(behaviorsContextFile, JSON.stringify(existingBehaviors.map(b => ({
      fact: b.fact, confidence: b.confidence, id: b.id,
    })), null, 2));

    // --- Step 5: SDK-Call 1 — Memory-Review ---
    if (!DRY_RUN && minimaxKey) {
    log(agentId, 'SDK: Memory-Review...');
    const memoryPrompt = `Du bist der nächtliche Memory-Review-Agent. Analysiere die heutige Unterhaltung und vergleiche sie mit den bekannten Fakten.

Die bekannten Fakten sind im Kontext enthalten.

Heutige Unterhaltung:
Lies die Datei ${inputPath}

Aufgabe:
1. Welche neuen Fakten über den User sind hinzugekommen?
2. Welche bestehenden Fakten müssen aktualisiert werden?
3. Welche bestehenden Fakten sind möglicherweise veraltet?

Antwort NUR als JSON-Array:
[
  {"action": "new", "text": "...", "confidence": 0.9},
  {"action": "supersede", "search": "alter Fakt Suchbegriff", "text": "aktualisierter Fakt", "confidence": 0.9},
  {"action": "lower", "search": "veralteter Fakt Suchbegriff", "confidence": 0.4, "reason": "..."}
]

Regeln:
- Nur Fakten über den User, nicht über den Agenten
- "supersede" nur wenn sich ein Fakt GEÄNDERT hat (z.B. Staffel 14→22)
- "lower" nur wenn ein Fakt WIDERLEGT oder VERALTET ist
- Confidence: 0.7-1.0. Höher = sicherer.
- Keine Duplikate zu bestehenden Fakten
- Bei Unsicherheit: lieber nicht aufnehmen
- Leeres Array [] wenn nichts gefunden`;

    const memoryActions = callDreamSDK(memoryPrompt, {
      inputFile: inputPath,
      contextFile: factsContextFile,
      agentId,
    });

    if (memoryActions && Array.isArray(memoryActions)) {
      report.memoryActions.push(...memoryActions);
      report.sdkCalls++;
      log(agentId, `Memory-Review: ${memoryActions.length} actions`);
    }

    // --- Step 6: SDK-Call 2 — Behavior-Review ---
    log(agentId, 'SDK: Behavior-Review...');
    const behaviorPrompt = `Du bist der nächtliche Behavior-Review-Agent. Analysiere die heutige Unterhaltung auf Verhaltenswünsche und Präferenzen des Users.

Die bekannten Behaviors sind im Kontext enthalten.

Heutige Unterhaltung:
Lies die Datei ${inputPath}

Aufgabe:
1. Hat der User Wünsche geäußert, wie der Agent sich verhalten soll?
2. Gibt es implizite Präferenzen (z.B. Sprache, Format, Stil)?
3. Müssen bestehende Behaviors angepasst werden?

Antwort NUR als JSON-Array:
[
  {"action": "new", "text": "...", "confidence": 0.85, "scope": "personal"},
  {"action": "supersede", "search": "...", "text": "aktualisierte Regel", "confidence": 0.85},
  {"action": "lower", "search": "...", "confidence": 0.4, "reason": "..."}
]

Regeln:
- NUR Muster die WIEDERHOLT auftreten oder klar als Präferenz erkennbar sind
- Scope: "personal" (nur dieser User) oder "household" (alle im Haushalt)
- Keine einmaligen Fakten, keine Smalltalk-Inhalte
- Bei weniger als 1 klarem Muster: leeres Array []`;

    const behaviorActions = callDreamSDK(behaviorPrompt, {
      inputFile: inputPath,
      contextFile: behaviorsContextFile,
      agentId,
    });

    if (behaviorActions && Array.isArray(behaviorActions)) {
      report.behaviorActions.push(...behaviorActions);
      report.sdkCalls++;
      log(agentId, `Behavior-Review: ${behaviorActions.length} actions`);
    }

    // --- Step 7: Execute Memory Actions ---
    if (report.memoryActions.length > 0) {
      log(agentId, 'Executing memory actions...');
      await ensureCollection(memoriesCollection);
      const memStats = await executeActions(report.memoryActions, memoriesCollection, agentId);
      report.qdrantWrites.new += memStats.new;
      report.qdrantWrites.superseded += memStats.superseded;
      report.qdrantWrites.lowered += memStats.lowered;
      report.qdrantWrites.skipped += memStats.skipped;
    }

    // --- Step 8: Execute Behavior Actions ---
    if (report.behaviorActions.length > 0) {
      log(agentId, 'Executing behavior actions...');
      await ensureCollection(instructionsCollection);
      const behStats = await executeActions(report.behaviorActions, instructionsCollection, agentId);
      report.qdrantWrites.new += behStats.new;
      report.qdrantWrites.superseded += behStats.superseded;
      report.qdrantWrites.lowered += behStats.lowered;
      report.qdrantWrites.skipped += behStats.skipped;
    }
    } else if (DRY_RUN) {
      log(agentId, 'DRY RUN — skipping SDK calls');
    }
  } // end for-loop over inputPaths

  if (report.messages === 0) {
    return { ...report, status: 'no_messages' };
  }

  // --- Step 9: Summary (last log only, simple MiniMax call) ---
  const summary = await summarizeSession(lastMessages, token);
  if (summary) {
    report.summary = summary;
    log(agentId, `Summary: ${summary.slice(0, 100)}...`);
  }

  // --- Step 10: Inject summary into new session ---
  if (!BACKFILL && !DRY_RUN && summary) {
    await injectSummary(sessionKey, summary, token);
    log(agentId, 'Summary injected ✓');
  }

  report.durationMs = Date.now() - startTime;
  return { ...report, status: DRY_RUN ? 'dry_run' : BACKFILL ? 'backfill' : 'ok' };
}

/**
 * Global Reflect/Learnings — runs once across ALL agents' raw sessions.
 */
async function processReflect(agents, minimaxKey) {
  if (!minimaxKey || DRY_RUN) return [];

  log('reflect', 'Starting global Reflect/Learnings...');

  // Collect all raw session paths from yesterday
  const allSessionPaths = [];
  for (const agent of agents) {
    const paths = findRecentSessions(agent.sessionsDir, agent.currentSessionId, 1);
    allSessionPaths.push(...paths);
  }

  if (allSessionPaths.length === 0) {
    log('reflect', 'No sessions to reflect on');
    return [];
  }

  // Also collect home-llm tool-call logs
  const toolLogPattern = '_home-llm_tools.jsonl';
  let toolLogPaths = [];
  if (existsSync(EXTRACTOR_LOGS)) {
    toolLogPaths = readdirSync(EXTRACTOR_LOGS)
      .filter(f => f.endsWith(toolLogPattern))
      .sort()
      .reverse()
      .slice(0, 7)  // Last 7 days
      .map(f => join(EXTRACTOR_LOGS, f));
  }

  log('reflect', `Found ${allSessionPaths.length} sessions + ${toolLogPaths.length} tool-logs for reflect`);

  // Load existing learnings
  const reflectCollection = 'reflect_learnings';
  await ensureCollection(reflectCollection);

  // Use first few user messages as query for existing learnings
  const sampleTexts = [];
  for (const p of allSessionPaths.slice(0, 3)) {
    const msgs = extractMessages(p);
    sampleTexts.push(...msgs.filter(m => m.role === 'user').map(m => m.text).slice(0, 3));
  }

  const existingLearnings = sampleTexts.length > 0
    ? await fetchRelevantFacts(reflectCollection, sampleTexts, 10, 0.5)
    : [];

  // Write context
  const tmpDir = '/tmp/dream-v2';
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const learningsContextFile = join(tmpDir, 'reflect-learnings.json');
  writeFileSync(learningsContextFile, JSON.stringify(existingLearnings.map(l => ({
    fact: l.fact, confidence: l.confidence, tools: l.tools,
  })), null, 2));

  // Point SDK to all session + tool-log files
  const sessionsListFile = join(tmpDir, 'reflect-sessions.txt');
  writeFileSync(sessionsListFile, allSessionPaths.concat(toolLogPaths).join('\n'));

  const toolLogHint = toolLogPaths.length > 0
    ? `\nLies auch die Home-LLM Tool-Call-Logs:\n${toolLogPaths.join('\n')}\nDiese JSONL-Dateien enthalten Tool-Aufrufe des lokalen HA-Sprachassistenten (Ministral-3 3B).\nJeder Eintrag hat: query (User-Anfrage), tool (aufgerufenes Tool), args, success, error.\nAnalysiere besonders: Falsche Tool-Wahl, falsche Parameter, wiederholte Fehler.\n`
    : '';

  const reflectPrompt = `Du bist der nächtliche Reflect-Agent. Analysiere alle Agent-Sessions auf Fehler, Ineffizienzen und Optimierungspotential.

Die bekannten Learnings sind im Kontext enthalten.

Lies die Session-Dateien die in ${sessionsListFile} aufgelistet sind. Es sind JSONL-Dateien mit OpenClaw-Konversationen.
${toolLogHint}

Analysiere:
1. Tool-Call-Loops: Gleicher Tool mehrfach mit ähnlichen Parametern ohne Lerneffekt
2. Fehlgeschlagene Aufrufe: Warum? Was wäre besser gewesen?
3. Unnötige Retries: Nach Fehler nochmal dasselbe versucht
4. Zeitverschwendung: Lange Ketten die mit besserem Ansatz kürzer wären
5. Erfolgreiche Patterns: Was hat gut funktioniert? (auch positiv lernen)

Antwort NUR als JSON-Array:
[
  {"text": "Konkreter, actionable Hint als Imperativ", "confidence": 0.85, "tools": ["tool_name1"], "scope": "global", "source": "Kurze Beschreibung (max 100 Zeichen)"}
]

Regeln:
- KEINE generischen Tipps ("sei effizienter")
- NUR konkrete, toolspezifische Hinweise
- Auch positive Learnings (was hat funktioniert)
- Confidence >= 0.7
- Leeres Array [] wenn nichts Konkretes gefunden`;

  const actions = callDreamSDK(reflectPrompt, {
    inputFile: sessionsListFile,
    contextFile: learningsContextFile,
    maxTurns: 25,
    agentId: 'reflect',
  });

  if (!actions || !Array.isArray(actions)) {
    log('reflect', 'No reflect actions returned');
    return [];
  }

  log('reflect', `Reflect: ${actions.length} learnings found`);

  // Write learnings to Qdrant
  for (const action of actions) {
    const text = action.text;
    if (!text) continue;

    const vector = await getEmbedding(text);
    if (!vector) continue;

    if (await checkSemanticDuplicate(reflectCollection, vector)) {
      log('reflect', `Dedup skip: ${text.slice(0, 50)}`);
      continue;
    }

    await fetch(`${QDRANT}/collections/${reflectCollection}/points?wait=true`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [{
          id: crypto.randomUUID(),
          vector: { dense: vector },
          payload: {
            fact: text,
            type: 'reflect',
            confidence: action.confidence ?? 0.8,
            tools: action.tools ?? [],
            scope: 'global',
            source: action.source ?? '',
            agentId: 'global',
            timestamp: new Date().toISOString(),
          },
        }],
      }),
      signal: AbortSignal.timeout(5000),
    });
  }

  return actions;
}

/**
 * Write dream report to /tmp.
 */
function writeReport(agentReports, reflectActions, weeklyActions = []) {
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = `/tmp/dream-report-${date}.md`;

  const lines = [`# Dream Report — ${date}\n`];

  lines.push('## Agents verarbeitet');
  for (const r of agentReports) {
    lines.push(`- ${r.agentId} (${r.channel}): ${r.messages} Nachrichten, ${r.toolCalls} Tool-Calls — ${r.status}`);
  }

  lines.push('\n## Memory-Updates');
  for (const r of agentReports) {
    for (const a of r.memoryActions ?? []) {
      lines.push(`- ${a.action.toUpperCase()}: ${a.text?.slice(0, 80) ?? a.search?.slice(0, 80)} (${a.confidence})`);
    }
  }

  lines.push('\n## Behavior-Updates');
  for (const r of agentReports) {
    for (const a of r.behaviorActions ?? []) {
      lines.push(`- ${a.action.toUpperCase()}: ${a.text?.slice(0, 80) ?? a.search?.slice(0, 80)} (${a.confidence})`);
    }
  }

  lines.push('\n## Reflect-Learnings');
  for (const a of reflectActions) {
    lines.push(`- NEW: "${a.text?.slice(0, 80)}" (${a.confidence})`);
    if (a.source) lines.push(`  Source: ${a.source}`);
  }

  if (weeklyActions.length > 0) {
    lines.push('\n## Weekly Consolidation');
    for (const a of weeklyActions) {
      lines.push(`- ${a.action.toUpperCase()}: ${a.text?.slice(0, 80) ?? a.search?.slice(0, 80)} (${a.reason?.slice(0, 60) ?? ''})`);
    }
  }

  lines.push('\n## Statistik');
  const totalSdk = agentReports.reduce((s, r) => s + (r.sdkCalls ?? 0), 0) + (reflectActions.length > 0 ? 1 : 0) + (weeklyActions.length > 0 ? 1 : 0);
  const totalWrites = agentReports.reduce((s, r) => s + (r.qdrantWrites?.new ?? 0) + (r.qdrantWrites?.superseded ?? 0) + (r.qdrantWrites?.lowered ?? 0), 0) + reflectActions.length + weeklyActions.length;
  const totalDuration = agentReports.reduce((s, r) => s + (r.durationMs ?? 0), 0);
  lines.push(`- SDK-Calls: ${totalSdk}`);
  lines.push(`- Qdrant-Writes: ${totalWrites}`);
  lines.push(`- Dauer: ${Math.round(totalDuration / 1000)}s`);

  writeFileSync(reportPath, lines.join('\n') + '\n');
  return reportPath;
}

/**
 * Weekly Meta-Reflect — runs on Sundays, consolidates the week's learnings.
 * Checks for contradictions, redundancies, outdated hints, and merges.
 */
async function processWeeklyReflect(minimaxKey) {
  if (!minimaxKey) return [];

  log('weekly', 'Starting weekly Meta-Reflect...');

  const reflectCollection = 'reflect_learnings';
  await ensureCollection(reflectCollection);

  // Load ALL learnings from reflect_learnings (paginated)
  let allLearnings = [];
  try {
    let scrollId = null;
    do {
      const resp = await fetch(`${QDRANT}/collections/${reflectCollection}/points/scroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 100,
          with_payload: true,
          with_vector: false,
          ...(scrollId ? { offset: scrollId } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) break;
      const data = await resp.json();
      allLearnings.push(...(data.result?.points ?? []).map(p => ({ id: p.id, ...p.payload })));
      scrollId = data.result?.next_page_offset ?? null;
    } while (scrollId !== null);
  } catch (err) {
    log('weekly', `Failed to load learnings: ${err.message}`);
    return [];
  }

  if (allLearnings.length < 2) {
    log('weekly', `Only ${allLearnings.length} learnings — nothing to consolidate`);
    return [];
  }

  log('weekly', `Loaded ${allLearnings.length} learnings for consolidation`);

  // Also load all memories and instructions for cross-check
  const agentDirs = readdirSync(AGENTS_DIR).filter(d => {
    try { return statSync(join(AGENTS_DIR, d)).isDirectory(); } catch { return false; }
  });

  let allFacts = [];
  for (const agentId of agentDirs) {
    const memCollection = `memories_${agentId}`;
    const instrCollection = `instructions_${agentId}`;
    for (const col of [memCollection, instrCollection]) {
      try {
        let factScrollId = null;
        do {
          const resp = await fetch(`${QDRANT}/collections/${col}/points/scroll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 100, with_payload: true, with_vector: false, ...(factScrollId ? { offset: factScrollId } : {}) }),
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) break;
          const data = await resp.json();
          for (const p of data.result?.points ?? []) {
            allFacts.push({ id: p.id, collection: col, ...p.payload });
          }
          factScrollId = data.result?.next_page_offset ?? null;
        } while (factScrollId !== null);
      } catch { /* skip */ }
    }
  }

  // Write context files
  const tmpDir = '/tmp/dream-v2';
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const learningsFile = join(tmpDir, 'weekly-learnings.json');
  const factsFile = join(tmpDir, 'weekly-facts.json');
  writeFileSync(learningsFile, JSON.stringify(allLearnings, null, 2));
  writeFileSync(factsFile, JSON.stringify(allFacts.map(f => ({
    fact: f.fact, confidence: f.confidence, collection: f.collection, id: f.id,
  })), null, 2));

  const weeklyPrompt = `Du bist der wöchentliche Meta-Reflect-Agent. Konsolidiere die gesammelten Learnings und Fakten der Woche.

Die Learnings und Fakten sind im Kontext enthalten.

Lies die Learnings-Datei ${learningsFile} und die Fakten-Datei ${factsFile}.

Prüfe:
1. Widersprüche zwischen Learnings oder zwischen Learnings und Fakten
2. Redundante Einträge die gemerged werden können
3. Veraltete Hints (der Fehler tritt nicht mehr auf, z.B. weil das Tool/Verhalten gefixt wurde)
4. Hints die spezifischer formuliert werden könnten (basierend auf mehreren Beispielen)
5. Facts mit sehr niedriger Confidence (< 0.5) die entfernt werden könnten

Antwort NUR als JSON-Array:
[
  {"action": "delete", "collection": "reflect_learnings", "search": "veralteter Hint", "reason": "..."},
  {"action": "merge", "collection": "reflect_learnings", "search": "erster Hint", "mergeWith": "zweiter Hint", "text": "zusammengefasster Hint", "confidence": 0.9},
  {"action": "update", "collection": "...", "search": "ungenauer Hint", "text": "präziserer Hint", "confidence": 0.9},
  {"action": "delete", "collection": "memories_...", "search": "sehr alter/falscher Fakt", "reason": "..."}
]

Regeln:
- NUR Aktionen vorschlagen wo klarer Grund vorliegt
- "merge" nur bei tatsächlich redundanten Einträgen
- "delete" nur bei nachweislich veralteten oder widersprüchlichen Einträgen
- Bei Unsicherheit: nicht anfassen
- Leeres Array [] wenn alles OK ist`;

  const actions = callDreamSDK(weeklyPrompt, {
    inputFile: learningsFile,
    contextFile: factsFile,
    maxTurns: 25,
    agentId: 'weekly',
  });

  if (!actions || !Array.isArray(actions)) {
    log('weekly', 'No weekly actions returned');
    return [];
  }

  log('weekly', `Weekly Meta-Reflect: ${actions.length} consolidation actions`);

  // Validate and execute consolidation actions
  const validActions = actions.filter(a => a.action && ['delete', 'merge', 'update'].includes(a.action));
  if (validActions.length < actions.length) {
    log('weekly', `Filtered ${actions.length - validActions.length} invalid actions`);
  }

  for (const action of validActions) {
    try {
      const collection = action.collection ?? 'reflect_learnings';

      if (action.action === 'delete') {
        // Lower confidence to near-zero (soft delete)
        const id = await lowerConfidence(collection, action.search, 0.05);
        if (id) log('weekly', `Soft-deleted: ${action.search?.slice(0, 50)} (${action.reason?.slice(0, 50)})`);
      } else if (action.action === 'merge') {
        // Supersede first entry with merged text
        const id = await supersedeFact(collection, action.search, {
          fact: action.text,
          confidence: action.confidence ?? 0.85,
        });
        // Lower the second entry
        if (id && action.mergeWith) {
          await lowerConfidence(collection, action.mergeWith, 0.1);
        }
        if (id) log('weekly', `Merged: ${action.text?.slice(0, 60)}`);
      } else if (action.action === 'update') {
        const id = await supersedeFact(collection, action.search, {
          fact: action.text,
          confidence: action.confidence ?? 0.85,
        });
        if (id) log('weekly', `Updated: ${action.text?.slice(0, 60)}`);
      }
    } catch (err) {
      log('weekly', `Action failed: ${err.message?.slice(0, 80)}`);
    }
  }

  return actions;
}

async function main() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Dream v2 Process — ${new Date().toISOString().slice(0, 19)}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : BACKFILL ? 'BACKFILL' : 'LIVE'}`);
  console.log(`${'='.repeat(50)}\n`);

  const token = readEnv('GATEWAY_AUTH_TOKEN');
  const minimaxKey = readEnv('MINIMAX_API_KEY');
  if (!token) {
    console.error('ERROR: GATEWAY_AUTH_TOKEN not found in', ENV_PATH);
    process.exit(1);
  }
  if (!minimaxKey) {
    console.log('WARNING: MINIMAX_API_KEY not found — SDK reviews disabled');
  }

  const agents = findAgentSessions();
  if (agents.length === 0) {
    console.log('No agents with channel sessions found.');
    process.exit(0);
  }

  console.log(`Found ${agents.length} agent session(s):\n`);
  for (const a of agents) {
    console.log(`  ${a.agentId} → ${a.sessionKey}`);
  }
  console.log('');

  // Process agents sequentially (SDK calls are heavy)
  const agentReports = [];
  for (const a of agents) {
    try {
      const result = await processAgent(a, token, minimaxKey);
      agentReports.push(result);
    } catch (err) {
      console.error(`ERROR processing ${a.agentId}: ${err.message}`);
      agentReports.push({ agentId: a.agentId, status: 'error', error: err.message, memoryActions: [], behaviorActions: [], reflectActions: [], qdrantWrites: { new: 0, superseded: 0, lowered: 0, skipped: 0 }, messages: 0, toolCalls: 0, channel: 'unknown', sdkCalls: 0, durationMs: 0 });
    }
  }

  // Global Reflect (once for all agents)
  let reflectActions = [];
  if (!DRY_RUN && minimaxKey) {
    try {
      reflectActions = await processReflect(agents, minimaxKey);
    } catch (err) {
      console.error(`ERROR in reflect: ${err.message}`);
    }
  }

  // Weekly Meta-Reflect (Sundays only, or --weekly flag)
  let weeklyActions = [];
  const isSunday = new Date().getDay() === 0;
  if ((isSunday || WEEKLY) && !DRY_RUN && minimaxKey) {
    try {
      weeklyActions = await processWeeklyReflect(minimaxKey);
    } catch (err) {
      console.error(`ERROR in weekly reflect: ${err.message}`);
    }
  }

  // Write report
  const reportPath = writeReport(agentReports, reflectActions, weeklyActions);
  console.log(`\nReport: ${reportPath}`);

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log('Results:');
  for (const r of agentReports) {
    const writes = r.qdrantWrites ?? {};
    console.log(`  ${r.agentId}: ${r.status} — ${r.messages ?? 0} msgs, ${(writes.new ?? 0) + (writes.superseded ?? 0) + (writes.lowered ?? 0)} writes`);
  }
  if (reflectActions.length > 0) {
    console.log(`  reflect: ${reflectActions.length} new learnings`);
  }
  if (weeklyActions.length > 0) {
    console.log(`  weekly: ${weeklyActions.length} consolidation actions`);
  }
  console.log(`${'='.repeat(50)}\n`);
}

main().catch(err => {
  console.error('Dream process failed:', err);
  process.exit(1);
});
