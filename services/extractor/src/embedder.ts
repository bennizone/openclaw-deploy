import { config, log } from './config.js';

export interface EmbedResult {
  vector: number[];
  source: 'gpu' | 'local';
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

async function fetchEmbedding(baseUrl: string, text: string, timeoutMs: number): Promise<number[]> {
  const resp = await fetch(`${baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.embeddingModel, input: text }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    throw new Error(`Embedding server ${baseUrl} returned ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as OpenAIEmbeddingResponse;
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || embedding.length !== 1024) {
    throw new Error(`Unexpected embedding dimensions: ${embedding?.length ?? 'null'}`);
  }

  return embedding;
}

export async function embed(text: string): Promise<EmbedResult> {
  // Try GPU server first
  try {
    const vector = await fetchEmbedding(config.embedGpuUrl, text, 3000);
    return { vector, source: 'gpu' };
  } catch (err) {
    log('debug', 'embedder', `GPU fallback: ${(err as Error).message}`);
  }

  // Fallback to local
  try {
    const vector = await fetchEmbedding(config.embedLocalUrl, text, 10000);
    log('info', 'embedder', 'Using local embedding fallback');
    return { vector, source: 'local' };
  } catch (err) {
    throw new Error(`Both embedding sources failed. Local: ${(err as Error).message}`);
  }
}
