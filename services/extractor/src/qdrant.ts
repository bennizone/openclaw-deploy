import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import { config, log } from './config.js';
import { textToSparse } from '@openclaw/bm25-tokenizer';

let client: QdrantClient;

export function initQdrant(): void {
  client = new QdrantClient({ url: config.qdrantUrl });
  log('info', 'qdrant', `Connected to ${config.qdrantUrl}`);
}

export function collectionName(agentId: string): string {
  return `memories_${agentId}`;
}

export function instructionCollectionName(agentId: string): string {
  return `instructions_${agentId}`;
}

export function targetInstructionCollections(agentId: string, scope: string): string[] {
  return scope === 'household'
    ? [instructionCollectionName('household')]
    : [instructionCollectionName(agentId)];
}

/**
 * Ensure collections exist for all configured agents.
 */
export async function ensureCollections(): Promise<void> {
  for (const agent of config.agents) {
    const name = collectionName(agent);
    try {
      await client.getCollection(name);
      log('info', 'qdrant', `Collection ${name}: exists`);
    } catch {
      await client.createCollection(name, {
        vectors: { dense: { size: 1024, distance: 'Cosine' } },
        sparse_vectors: { bm25: { modifier: 'idf' as never } },
      });
      log('info', 'qdrant', `Collection ${name}: created (hybrid dense+bm25)`);
    }
  }

  // Instruction collections for behavior extraction
  for (const agent of config.agents) {
    const name = instructionCollectionName(agent);
    try {
      await client.getCollection(name);
      log('info', 'qdrant', `Collection ${name}: exists`);
    } catch {
      await client.createCollection(name, {
        vectors: { dense: { size: 1024, distance: 'Cosine' } },
        sparse_vectors: { bm25: { modifier: 'idf' as never } },
      });
      log('info', 'qdrant', `Collection ${name}: created (hybrid dense+bm25)`);
    }
  }
}

export interface FactPayload {
  fact: string;
  type: string;
  confidence: number;
  sourceContext: string;
  agentId: string;
  sessionId: string;
  turnIndex: number;
  timestamp: string;
  extractedAt: string;
  embeddingSource: string;
  [key: string]: unknown;
}

/**
 * Check if a fact already exists (idempotency).
 */
export async function checkDuplicate(
  collection: string,
  sessionId: string,
  turnIndex: number,
  fact: string
): Promise<boolean> {
  const result = await client.scroll(collection, {
    filter: {
      must: [
        { key: 'sessionId', match: { value: sessionId } },
        { key: 'turnIndex', match: { value: turnIndex } },
        { key: 'fact', match: { value: fact } },
      ],
    },
    limit: 1,
  });
  return result.points.length > 0;
}

/**
 * Write a single fact to Qdrant with dense + BM25 sparse vectors.
 */
export async function upsertFact(
  collection: string,
  data: { vector: number[]; payload: FactPayload }
): Promise<string> {
  const id = uuidv4();
  const sparse = textToSparse(data.payload.fact);
  await client.upsert(collection, {
    wait: true,
    points: [
      {
        id,
        vector: {
          dense: data.vector,
          bm25: sparse,
        } as never,
        payload: data.payload,
      },
    ],
  });
  return id;
}

/**
 * Search for semantically similar facts using dense vector.
 */
export async function searchSimilar(
  collection: string,
  denseVector: number[],
  limit: number = 10,
  scoreThreshold: number = 0.3,
): Promise<Array<{ id: string; score: number; fact: string }>> {
  const results = await client.search(collection, {
    vector: { name: 'dense', vector: denseVector },
    limit,
    score_threshold: scoreThreshold,
    with_payload: true,
  });

  return results.map(r => ({
    id: String(r.id),
    score: r.score,
    fact: (r.payload as Record<string, unknown>)?.fact as string ?? '',
  }));
}

/**
 * Scroll all points from a collection (for export/benchmark).
 */
export async function scrollAll(
  collection: string,
): Promise<Array<{ id: string; payload: FactPayload }>> {
  const all: Array<{ id: string; payload: FactPayload }> = [];
  let offset: string | number | undefined = undefined;

  while (true) {
    const result = await client.scroll(collection, {
      limit: 100,
      with_payload: true,
      ...(offset !== undefined ? { offset } : {}),
    });

    for (const p of result.points) {
      all.push({ id: String(p.id), payload: p.payload as unknown as FactPayload });
    }

    if (!result.next_page_offset) break;
    offset = result.next_page_offset as string | number | undefined;
  }

  return all;
}

/**
 * Write multiple facts in a single batch with dense + BM25 sparse vectors.
 */
export async function upsertFactsBatch(
  collection: string,
  facts: { vector: number[]; payload: FactPayload }[]
): Promise<number> {
  if (facts.length === 0) return 0;

  const points = facts.map(f => ({
    id: uuidv4(),
    vector: {
      dense: f.vector,
      bm25: textToSparse(f.payload.fact),
    } as never,
    payload: f.payload,
  }));

  await client.upsert(collection, { wait: true, points });
  return points.length;
}
