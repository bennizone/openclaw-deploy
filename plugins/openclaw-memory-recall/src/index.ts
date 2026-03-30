/**
 * OpenClaw Memory Recall Plugin
 *
 * Queries Qdrant for relevant facts before each LLM response and injects them
 * as prependContext. Uses hybrid search (dense + BM25 sparse) with RRF fusion.
 * Each agent gets their personal facts + household facts.
 */

import { textToSparse } from './bm25-tokenizer.js';

interface PluginConfig {
  qdrantUrl: string;
  embedUrl: string;
  embedFallbackUrl: string;
  embeddingModel: string;
  topK: number;
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
const AGENT_COLLECTIONS: Record<string, string[]> = {
  benni: ['memories_benni', 'memories_household'],
  domi: ['memories_domi', 'memories_household'],
  household: ['memories_household'],
};

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
): Promise<QdrantSearchResult['result']> {
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
    if (!resp.ok) return [];
    const data = (await resp.json()) as { result?: { points?: QdrantSearchResult['result'] } };
    return data.result?.points ?? [];
  } catch {
    return [];
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
    };

    api.logger.info(`[memory-recall] Registered — Qdrant: ${cfg.qdrantUrl}, topK: ${cfg.topK}, hybrid: dense+bm25+rrf`);

    api.on('before_prompt_build', async (event: unknown, ctx: unknown) => {
      const ev = event as Record<string, unknown>;
      const cx = ctx as Record<string, unknown>;

      // Get agent ID
      const agentId = (cx.agentId ?? ev.agentId ?? 'benni') as string;

      const collections = AGENT_COLLECTIONS[agentId];
      if (!collections) return;

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

      // Embed the query
      const vector = await getEmbedding(userText, cfg.embedUrl, cfg.embedFallbackUrl, cfg.embeddingModel);
      if (!vector) {
        api.logger.warn('[memory-recall] Embedding failed — skipping recall');
        return;
      }

      // Hybrid search all relevant collections (dense + BM25 with RRF fusion)
      const allFacts: Array<{ fact: string; type: string; score: number; source: string }> = [];

      for (const collection of collections) {
        const results = await searchQdrantHybrid(cfg.qdrantUrl, collection, vector, userText, cfg.topK);
        for (const r of results) {
          allFacts.push({
            fact: r.payload.fact,
            type: r.payload.type,
            score: r.score,
            source: collection.replace('memories_', ''),
          });
        }
      }

      if (allFacts.length === 0) return;

      // Deduplicate by fact text (keep highest score)
      const deduped = new Map<string, typeof allFacts[0]>();
      for (const f of allFacts) {
        const existing = deduped.get(f.fact);
        if (!existing || f.score > existing.score) {
          deduped.set(f.fact, f);
        }
      }

      // Sort by score descending, limit to topK
      const topFacts = [...deduped.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, cfg.topK);

      const factLines = topFacts.map(f => `- ${f.fact}`).join('\n');

      api.logger.debug(`[memory-recall] Injecting ${topFacts.length} facts for ${agentId}: ${topFacts.map(f => f.fact.slice(0, 40)).join(', ')}`);

      return {
        prependContext: [
          '[Erinnerungen — relevante Fakten aus früheren Gesprächen]',
          factLines,
          '[/Erinnerungen]',
        ].join('\n'),
      };
    }, { priority: 50 });
  },
};
