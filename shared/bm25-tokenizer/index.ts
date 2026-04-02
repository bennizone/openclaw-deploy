/**
 * Lightweight BM25 tokenizer for German + English text.
 *
 * Produces sparse vectors (indices + values) compatible with Qdrant's
 * sparse vector format. Qdrant handles IDF with `modifier: "idf"` —
 * we only need to compute term frequencies (TF).
 *
 * Token → index mapping uses stable FNV-1a hashing (no vocabulary file needed).
 */

// German stop words (common words that don't carry meaning for search)
const STOP_WORDS = new Set([
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen',
  'und', 'oder', 'aber', 'wenn', 'weil', 'dass', 'als', 'wie', 'auch', 'noch',
  'ist', 'sind', 'war', 'hat', 'haben', 'wird', 'werden', 'kann', 'soll', 'muss',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man', 'sich', 'mich', 'mir', 'dir',
  'im', 'in', 'an', 'auf', 'aus', 'bei', 'mit', 'nach', 'von', 'zu', 'zum', 'zur',
  'für', 'über', 'unter', 'vor', 'hinter', 'neben', 'zwischen',
  'nicht', 'kein', 'keine', 'keinen', 'keinem', 'keiner',
  'so', 'da', 'dann', 'dort', 'hier', 'nur', 'sehr', 'schon', 'mal', 'ja', 'nein',
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'into',
  'not', 'no', 'and', 'or', 'but', 'if', 'so', 'that', 'this', 'what', 'which',
]);

/**
 * FNV-1a 32-bit hash → stable integer index for a token.
 * Maps to range [0, 2^31) to stay in safe integer territory.
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 1; // positive 31-bit integer
}

/**
 * Tokenize text into normalized tokens.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

/**
 * Generate a BM25-compatible sparse vector from text.
 * Returns term frequency values — Qdrant applies IDF via modifier: "idf".
 */
export function textToSparse(text: string): SparseVector {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return { indices: [], values: [] };
  }

  // Count term frequencies
  const tf = new Map<number, number>();
  for (const token of tokens) {
    const idx = fnv1a(token);
    tf.set(idx, (tf.get(idx) ?? 0) + 1);
  }

  // Normalize TF: tf / total_tokens (relative frequency)
  const total = tokens.length;
  const indices: number[] = [];
  const values: number[] = [];

  for (const [idx, count] of tf.entries()) {
    indices.push(idx);
    values.push(count / total);
  }

  return { indices, values };
}
