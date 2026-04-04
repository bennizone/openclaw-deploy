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
 *
 * Cron:
 *   1 4 * * * cd /home/openclaw/openclaw-deploy && node scripts/dream.mjs >> /tmp/dream.log 2>&1
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

// --- Config ---

const AGENTS_DIR = join(homedir(), '.openclaw', 'agents');
const ENV_PATH = join(homedir(), '.openclaw', '.env');
const GATEWAY = 'http://localhost:18789';
const QDRANT = 'http://localhost:6333';
const EMBED_URL = 'http://10.83.1.110:8081';
const EMBED_FALLBACK = 'http://localhost:8081';
const MAX_TURNS = 50;
const SEMANTIC_DEDUP_THRESHOLD = 0.92;
const DRY_RUN = process.argv.includes('--dry-run');
const BACKFILL = process.argv.includes('--backfill');

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

function extractMessages(jsonlPath) {
  const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
  const messages = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'message') continue;

      const msg = entry.message;
      if (!msg || !msg.role) continue;

      // Only user and assistant messages
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;

      const text = extractTextContent(msg.content);
      if (!text || text.length < 2) continue;

      // Strip injected rules/memory blocks from user messages
      const cleaned = text
        .replace(/\[Regeln[^\]]*\][\s\S]*?\[\/Regeln\]/g, '')
        .replace(/\[Erinnerungen[^\]]*\][\s\S]*?\[\/Erinnerungen\]/g, '')
        .replace(/\[Anweisungen[^\]]*\][\s\S]*?\[\/Anweisungen\]/g, '')
        .replace(/\[Memory-System[^\]]*\][\s\S]*?\[\/Memory-System\]/g, '')
        .trim();

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

  log(agentId, `Processing ${sessionKey}`);

  // Find sessions to process
  let sessionPaths;
  if (BACKFILL) {
    sessionPaths = findRecentSessions(sessionsDir, currentSessionId, 7);
    if (sessionPaths.length === 0) {
      log(agentId, 'No recent sessions found — skipping');
      return { agentId, status: 'no_session' };
    }
    log(agentId, `Backfill: found ${sessionPaths.length} sessions from last 7 days`);
  } else {
    const yesterdayPath = findYesterdaySession(sessionsDir, currentSessionId);
    if (!yesterdayPath) {
      log(agentId, 'No yesterday session found — skipping');
      return { agentId, status: 'no_session' };
    }
    sessionPaths = [yesterdayPath];
  }

  // Process each session
  let totalBehaviors = 0;
  let totalWritten = 0;
  let lastSummary = null;

  for (const sessionPath of sessionPaths) {
    log(agentId, `Session: ${basename(sessionPath)}`);

    const messages = extractMessages(sessionPath);
    if (messages.length === 0) {
      log(agentId, '  No messages — skipping');
      continue;
    }
    log(agentId, `  ${messages.length} messages`);

    // Summarize (only for the most recent session)
    if (sessionPath === sessionPaths[0]) {
      const summary = await summarizeSession(messages, token);
      if (summary) {
        lastSummary = summary;
        log(agentId, `  Summary: ${summary.slice(0, 100)}...`);
      }
    }

    // Phase 2: Extract behaviors + tool hints (only for substantial sessions)
    const toolCalls = extractToolCalls(sessionPath);
    let behaviors = [];
    if (messages.length >= 4 || toolCalls.length >= 2) {
      log(agentId, `  ${toolCalls.length} tool calls — extracting behaviors`);
      behaviors = await extractBehaviors(messages, toolCalls, agentId, minimaxKey);
      log(agentId, `  ${behaviors.length} behaviors extracted`);
    } else {
      log(agentId, `  Too short for behavior extraction (${messages.length} msgs, ${toolCalls.length} tools)`);
    }
    totalBehaviors += behaviors.length;

    // Write behaviors to Qdrant
    if (behaviors.length > 0 && !DRY_RUN) {
      const collection = `instructions_${agentId}`;
      await ensureCollection(collection);

      for (const b of behaviors) {
        const ok = await upsertInstruction(collection, b, agentId, basename(sessionPath, '.jsonl'));
        if (ok) totalWritten++;
      }
      log(agentId, `  Wrote ${totalWritten} to Qdrant`);
    } else if (behaviors.length > 0) {
      log(agentId, `  DRY RUN — behaviors:`);
      for (const b of behaviors) {
        log(agentId, `    [${b.confidence}] ${b.text}`);
      }
    }
  }

  // Inject summary (skip in backfill mode)
  if (BACKFILL) {
    log(agentId, 'BACKFILL mode — skipping summary injection');
    return { agentId, status: 'backfill', summary: lastSummary, behaviorsExtracted: totalBehaviors, behaviorsWritten: totalWritten };
  }

  if (!lastSummary) {
    return { agentId, status: 'no_summary', behaviorsExtracted: totalBehaviors, behaviorsWritten: totalWritten };
  }

  if (DRY_RUN) {
    log(agentId, 'DRY RUN — would inject summary');
    return { agentId, status: 'dry_run', summary: lastSummary, behaviorsExtracted: totalBehaviors };
  }

  await injectSummary(sessionKey, lastSummary, token);
  log(agentId, 'Summary injected ✓');

  return { agentId, status: 'ok', summary: lastSummary, behaviorsExtracted: totalBehaviors, behaviorsWritten: totalWritten };
}

async function main() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Dream Process — ${new Date().toISOString().slice(0, 19)}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : BACKFILL ? 'BACKFILL' : 'LIVE'}`);
  console.log(`${'='.repeat(50)}\n`);

  const token = readEnv('GATEWAY_AUTH_TOKEN');
  const minimaxKey = readEnv('MINIMAX_API_KEY');
  if (!token) {
    console.error('ERROR: GATEWAY_AUTH_TOKEN not found in', ENV_PATH);
    process.exit(1);
  }
  if (!minimaxKey) {
    console.log('WARNING: MINIMAX_API_KEY not found — behavior extraction disabled');
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

  // Process all agents in parallel
  const results = await Promise.allSettled(
    agents.map(a => processAgent(a, token, minimaxKey))
  );

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log('Results:');
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { agentId, status, summary } = r.value;
      console.log(`  ${agentId}: ${status}${summary ? ` — ${summary.slice(0, 80)}...` : ''}`);
    } else {
      console.log(`  ERROR: ${r.reason?.message ?? r.reason}`);
    }
  }
  console.log(`${'='.repeat(50)}\n`);
}

main().catch(err => {
  console.error('Dream process failed:', err);
  process.exit(1);
});
