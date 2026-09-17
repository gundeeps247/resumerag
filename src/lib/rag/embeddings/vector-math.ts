/**
 * Vector helpers.
 *
 * Embeddings are L2-normalised (length 1), which makes cosine similarity equal to
 * the plain dot product: cos(a, b) = a·b / (|a||b|) = a·b when |a| = |b| = 1.
 */

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

export interface VectorHit {
  index: number;
  score: number;
}

/**
 * Exact nearest-neighbour search over a row-major matrix of normalised vectors.
 * Brute force is the right call at personal-knowledge-base scale: 5,000 chunks ×
 * 384 dimensions is ~2M multiply-adds, i.e. a few milliseconds, with perfect recall.
 */
export function topKByDot(
  matrix: Float32Array,
  dims: number,
  query: Float32Array,
  k: number,
  allow?: (index: number) => boolean,
): VectorHit[] {
  const rows = dims ? matrix.length / dims : 0;
  const hits: VectorHit[] = [];
  for (let row = 0; row < rows; row++) {
    if (allow && !allow(row)) continue;
    let score = 0;
    const offset = row * dims;
    for (let i = 0; i < dims; i++) score += matrix[offset + i] * query[i];
    hits.push({ index: row, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}
