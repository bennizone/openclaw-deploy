/**
 * OpenClaw Memory Recall Plugin
 *
 * Queries Qdrant for relevant facts before each LLM response and injects them
 * as prependContext. Uses hybrid search (dense + BM25 sparse) with RRF fusion.
 * Each agent gets their personal facts + household facts.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { textToSparse } from '@openclaw/bm25-tokenizer';

interface PluginConfig {
  qdrantUrl: string;
  embedUrl: string;
  embedFallbackUrl: string;
  embeddingModel: string;
  topK: number;
  instructionsTopK: number;
  enableRules: boolean;
}

interface ContentBlock {
  type: string;
  text?: string;
}

interface Message {
  role: string;
  content: string | ContentBlock[];
}

interface QdrantSearchResult {
  result: Array<{
    id: string;
    score: number;
    payload: {
      fact: string;
      type: string;
      confidence: number;
      agentId: string;
      scope?: string;
    };
  }>;
}

// Agent → which collections to search
// Dynamisch: persoenliche Agents suchen in eigener Collection + household
// Der household-Agent sucht NUR in memories_household
function getAgentCollections(agentId: string): string[] {
  if (agentId === 'household') return ['memories_household'];
  return [`memories_${agentId}`, 'memories_household'];
}

// Agent → which instruction collections to search (same routing as memories)
function getInstructionCollections(agentId: string): string[] {
  if (agentId === 'household') return ['instructions_household'];
  return [`instructions_${agentId}`, 'instructions_household'];
}

function extractLastUserText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;

    if (typeof msg.content === 'string') return msg.content;

    if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter((b: ContentBlock) => b.type === 'text')
        .map((b: ContentBlock) => b.text ?? '')
        .join(' ')
        .trim();
      if (text) return text;
    }
  }
  return null;
}

function getWorkspacePath(agentId: string): string {
  const home = process.env.HOME ?? '/home/openclaw';
  return join(home, '.openclaw', `workspace-${agentId}`);
}

function readRulesFile(agentId: string): string | null {
  try {
    const rulesPath = join(getWorkspacePath(agentId), 'RULES.md');
    return readFileSync(rulesPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

async function getEmbedding(
  text: string,
  embedUrl: string,
  embedFallbackUrl: string,
  model: string,
): Promise<number[] | null> {
  for (const url of [embedUrl, embedFallbackUrl]) {
    try {
      const timeoutMs = url === embedUrl ? 3000 : 10000;
      const resp = await fetch(`${url}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
      const emb = data.data?.[0]?.embedding;
      if (emb?.length === 1024) return emb;
    } catch {
      // Try next
    }
  }
  return null;
}

async function searchQdrantHybrid(
  qdrantUrl: string,
  collection: string,
  denseVector: number[],
  queryText: string,
  topK: number,
): Promise<QdrantSearchResult['result'] | null> {
  const sparse = textToSparse(queryText);
  try {
    const resp = await fetch(`${qdrantUrl}/collections/${collection}/points/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefetch: [
          { query: denseVector, using: 'dense', limit: topK * 4 },
          ...(sparse.indices.length > 0
            ? [{ query: sparse, using: 'bm25', limit: topK * 4 }]
            : []),
        ],
        query: { fusion: 'rrf' },
        limit: topK,
        with_payload: true,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { result?: { points?: QdrantSearchResult['result'] } };
    return data.result?.points ?? [];
  } catch {
    return null;
  }
}

export default {
  id: 'openclaw-memory-recall',
  name: 'Memory Recall (Qdrant)',
  description: 'Injects relevant facts from Qdrant before each LLM response',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      qdrantUrl: { type: 'string', default: 'http://localhost:6333' },
      embedUrl: { type: 'string', default: 'http://localhost:8081' },
      embedFallbackUrl: { type: 'string', default: 'http://localhost:8081' },
      embeddingModel: { type: 'string', default: 'bge-m3' },
      topK: { type: 'number', default: 5 },
      instructionsTopK: { type: 'number', default: 3 },
      enableRules: { type: 'boolean', default: true },
    },
  },

  register(api: {
    pluginConfig: PluginConfig;
    logger: { info: (msg: string) => void; debug: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
    on: (
      hookName: string,
      handler: (event: unknown, ctx: unknown) => unknown | Promise<unknown>,
      opts?: { priority: number },
    ) => void;
  }) {
    const cfg: PluginConfig = {
      qdrantUrl: api.pluginConfig?.qdrantUrl ?? 'http://localhost:6333',
      embedUrl: api.pluginConfig?.embedUrl ?? 'http://localhost:8081',
      embedFallbackUrl: api.pluginConfig?.embedFallbackUrl ?? 'http://localhost:8081',
      embeddingModel: api.pluginConfig?.embeddingModel ?? 'bge-m3',
      topK: api.pluginConfig?.topK ?? 5,
      instructionsTopK: api.pluginConfig?.instructionsTopK ?? 3,
      enableRules: api.pluginConfig?.enableRules ?? true,
    };

    api.logger.info(`[memory-recall] Registered — Qdrant: ${cfg.qdrantUrl}, topK: ${cfg.topK}, instructionsTopK: ${cfg.instructionsTopK}, hybrid: dense+bm25+rrf, rules: ${cfg.enableRules}`);

    api.on('before_prompt_build', async (event: unknown, ctx: unknown) => {
      const ev = event as Record<string, unknown>;
      const cx = ctx as Record<string, unknown>;

      // Get agent ID
      const agentId = (cx.agentId ?? ev.agentId ?? 'default') as string;

      const collections = getAgentCollections(agentId);
      if (!collections.length) return;

      // Get user text — event.prompt has the current input
      let userText: string | null = null;

      if (typeof ev.prompt === 'string' && ev.prompt.length > 0) {
        userText = ev.prompt;
      }

      // Fallback: check messages array
      if (!userText) {
        const messages = (ev.messages ?? []) as Message[];
        userText = extractLastUserText(messages);
      }

      if (!userText || userText.length < 3) return;

      const MEMORY_OFFLINE_HINT = '[Memory-System: offline]\nLangzeitspeicher nicht erreichbar — antworte mit Kurzzeit-/Konversationswissen.\n[/Memory-System]';

      // Embed the query
      const vector = await getEmbedding(userText, cfg.embedUrl, cfg.embedFallbackUrl, cfg.embeddingModel);
      if (!vector) {
        api.logger.warn('[memory-recall] Embedding failed — injecting offline hint');
        return { prependContext: MEMORY_OFFLINE_HINT };
      }

      // Hybrid search all relevant collections (dense + BM25 with RRF fusion)
      const allFacts: Array<{ fact: string; type: string; score: number; source: string }> = [];
      let searchError = false;

      for (const collection of collections) {
        const results = await searchQdrantHybrid(cfg.qdrantUrl, collection, vector, userText, cfg.topK);
        if (results === null) {
          searchError = true;
          api.logger.warn(`[memory-recall] Qdrant search failed for collection ${collection}`);
          continue;
        }
        for (const r of results) {
          allFacts.push({
            fact: r.payload.fact,
            type: r.payload.type,
            score: r.score,
            source: collection.replace('memories_', ''),
          });
        }
      }

      // --- Instructions search (instructions_* collections) ---
      const instructionCollections = getInstructionCollections(agentId);
      const allInstructions: Array<{ fact: string; type: string; score: number; source: string }> = [];

      for (const collection of instructionCollections) {
        const results = await searchQdrantHybrid(cfg.qdrantUrl, collection, vector, userText, cfg.instructionsTopK);
        if (results === null) {
          searchError = true;
          api.logger.warn(`[memory-recall] Qdrant search failed for collection ${collection}`);
          continue;
        }
        for (const r of results) {
          allInstructions.push({
            fact: r.payload.fact,
            type: r.payload.type,
            score: r.score,
            source: collection.replace('instructions_', ''),
          });
        }
      }

      if (searchError && allFacts.length === 0 && allInstructions.length === 0) {
        return { prependContext: MEMORY_OFFLINE_HINT };
      }

      if (allFacts.length === 0 && allInstructions.length === 0) {
        // Still inject rules even without facts or instructions
        if (cfg.enableRules) {
          const rules = readRulesFile(agentId);
          if (rules) {
            api.logger.debug(`[memory-recall] Injecting RULES.md for ${agentId} (no facts/instructions)`);
            return { prependContext: rules };
          }
        }
        return;
      }

      // Deduplicate facts by text (keep highest score)
      const dedupedFacts = new Map<string, typeof allFacts[0]>();
      for (const f of allFacts) {
        const existing = dedupedFacts.get(f.fact);
        if (!existing || f.score > existing.score) {
          dedupedFacts.set(f.fact, f);
        }
      }

      // Sort by score descending, limit to topK
      const topFacts = [...dedupedFacts.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, cfg.topK);

      // Deduplicate instructions by text (keep highest score)
      const dedupedInstructions = new Map<string, typeof allInstructions[0]>();
      for (const i of allInstructions) {
        const existing = dedupedInstructions.get(i.fact);
        if (!existing || i.score > existing.score) {
          dedupedInstructions.set(i.fact, i);
        }
      }

      // Sort by score descending, limit to instructionsTopK
      const topInstructions = [...dedupedInstructions.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, cfg.instructionsTopK);

      // Build prependContext parts
      const parts: string[] = [];

      // 1. Rules injection (static from workspace RULES.md)
      if (cfg.enableRules) {
        const rules = readRulesFile(agentId);
        if (rules) {
          parts.push(rules);
          api.logger.debug(`[memory-recall] Injecting RULES.md for ${agentId}`);
        }
      }

      // 2. Instructions injection (from instructions_* collections)
      if (topInstructions.length > 0) {
        const instructionLines = topInstructions.map(i => `- ${i.fact}`).join('\n');
        api.logger.debug(`[memory-recall] Injecting ${topInstructions.length} instructions for ${agentId}: ${topInstructions.map(i => i.fact.slice(0, 40)).join(', ')}`);
        parts.push([
          '[Anweisungen — persönliche Verhaltensregeln]',
          instructionLines,
          '[/Anweisungen]',
        ].join('\n'));
      }

      // 3. Memory facts injection
      if (topFacts.length > 0) {
        const factLines = topFacts.map(f => `- ${f.fact}`).join('\n');
        api.logger.debug(`[memory-recall] Injecting ${topFacts.length} facts for ${agentId}: ${topFacts.map(f => f.fact.slice(0, 40)).join(', ')}`);
        parts.push([
          '[Erinnerungen — relevante Fakten aus früheren Gesprächen]',
          factLines,
          '[/Erinnerungen]',
        ].join('\n'));
      }

      if (parts.length === 0) return;

      return { prependContext: parts.join('\n\n') };
    }, { priority: 50 });
  },
};
