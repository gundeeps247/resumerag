/**
 * The retrieval pipeline: question in, ranked evidence (plus a full trace) out.
 *
 *   question ─┬─> embed ──> semantic search (cosine) ──┐
 *             └──────────> keyword search (BM25) ──────┴─> RRF fusion ─> rerank ─> top-K
 *
 * Every candidate keeps every score it collected, which powers the
 * "How this answer was generated" panel and the RAG Playground.
 */
import type { ConfidenceCalibration } from "../embeddings/models";
import type { Reranker } from "../reranking/reranker";
import type { RetrievalOptions, RetrievalResult, RetrievedChunk, ScoredCandidate } from "../types";
import { assessConfidence } from "./confidence";
import { reciprocalRankFusion } from "./fusion";
import { expandQuery } from "./query-expansion";
import type { SearchIndex } from "./search-index";

export interface RetrieverDeps {
  index: SearchIndex;
  embedQuery: (query: string) => Promise<Float32Array>;
  /** Text that is actually embedded for the query (model instruction prefix included). */
  queryPrefix?: string;
  reranker?: Reranker;
  embeddingModelId: string;
  embeddingCalibration: ConfidenceCalibration;
  rerankCalibration?: ConfidenceCalibration;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export async function retrieve(query: string, options: RetrievalOptions, deps: RetrieverDeps): Promise<RetrievalResult> {
  const { index } = deps;
  const start = now();
  const timings = { embedMs: 0, denseMs: 0, keywordMs: 0, fusionMs: 0, rerankMs: 0, totalMs: 0 };
  const allow = index.filter(options.filter);
  const useDense = options.mode !== "keyword";
  const useKeyword = options.mode !== "semantic";

  // 1. Embed the question (semantic / hybrid only).
  let queryVector: Float32Array | undefined;
  if (useDense && index.size) {
    const t = now();
    queryVector = await deps.embedQuery(query);
    timings.embedMs = now() - t;
  }

  // 2. First-stage retrieval: both retrievers return their own top candidates.
  const byIndex = new Map<number, ScoredCandidate>();
  const candidateFor = (i: number): ScoredCandidate => {
    let c = byIndex.get(i);
    if (!c) {
      const { chunk } = index.entries[i];
      c = { chunkId: chunk.id, docId: chunk.docId, fusedScore: 0, fusedRank: 0, selected: false };
      byIndex.set(i, c);
    }
    return c;
  };

  let denseIds: number[] = [];
  if (queryVector) {
    const t = now();
    const hits = index.dense(queryVector, options.candidateK, allow);
    timings.denseMs = now() - t;
    denseIds = hits.map((h) => h.index);
    hits.forEach((h, rank) => Object.assign(candidateFor(h.index), { denseScore: h.score, denseRank: rank + 1 }));
  }

  // Interview-aware expansion only affects keyword search (see query-expansion.ts).
  const expansion = options.queryExpansion === false ? null : expandQuery(query);
  const keywordQuery = expansion ? `${query} ${expansion}` : query;

  let keywordIds: number[] = [];
  if (useKeyword) {
    const t = now();
    const hits = index.keyword(keywordQuery, options.candidateK, allow);
    timings.keywordMs = now() - t;
    keywordIds = hits.map((h) => h.index);
    hits.forEach((h, rank) => Object.assign(candidateFor(h.index), { keywordScore: h.score, keywordRank: rank + 1 }));
  }

  // 3. Fusion. Hybrid uses Reciprocal Rank Fusion; single-retriever modes keep their order.
  const t = now();
  const rankings = [denseIds, keywordIds].filter((r) => r.length).map((r) => r.map(String));
  const fused = reciprocalRankFusion(rankings, options.rrfK);
  for (const [key, score] of fused) candidateFor(Number(key)).fusedScore = score;

  // Give keyword-only hits a similarity score too, so the UI can show it for every candidate.
  if (queryVector) {
    for (const [i, c] of byIndex) if (c.denseScore === undefined) c.denseScore = index.similarity(queryVector, i);
  }
  let pool = [...byIndex.entries()].sort((a, b) => b[1].fusedScore - a[1].fusedScore);
  pool.forEach(([, c], rank) => (c.fusedRank = rank + 1));

  // 4. Optional similarity threshold (semantic signal only).
  if (options.minSimilarity > 0 && queryVector) {
    for (const [, c] of pool) if ((c.denseScore ?? 0) < options.minSimilarity) c.dropReason = "below_threshold";
    pool = pool.filter(([, c]) => !c.dropReason);
  }
  pool = pool.slice(0, options.candidateK);
  timings.fusionMs = now() - t;

  // 5. Rerank the pool with the cross-encoder.
  const reranked = Boolean(options.rerank && deps.reranker && pool.length);
  if (reranked && deps.reranker) {
    const tr = now();
    const texts = pool.map(([i]) => index.entries[i].chunk.embedText);
    const scores = await deps.reranker.score(keywordQuery, texts);
    pool.forEach(([, c], j) => (c.rerankScore = scores[j]));
    pool.sort((a, b) => (b[1].rerankScore ?? 0) - (a[1].rerankScore ?? 0));
    pool.forEach(([, c], rank) => (c.rerankRank = rank + 1));
    timings.rerankMs = now() - tr;
  }

  // 6. Keep the top-K for the LLM context.
  const selected = pool.slice(0, options.topK);
  selected.forEach(([, c], rank) => {
    c.selected = true;
    c.finalRank = rank + 1;
  });
  pool.slice(options.topK).forEach(([, c]) => (c.dropReason ??= "outside_top_k"));

  const signal = reranked ? "rerank" : queryVector ? "dense" : "keyword";
  const calibration = reranked && deps.rerankCalibration ? deps.rerankCalibration : deps.embeddingCalibration;
  const confidence = assessConfidence(
    selected.map(([, c]) => c),
    signal,
    calibration,
    deps.embeddingCalibration,
  );

  const results: RetrievedChunk[] = selected.map(([i, c]) => ({
    chunk: index.entries[i].chunk,
    document: index.entries[i].document,
    score: c.rerankScore ?? c.denseScore ?? c.fusedScore,
    candidate: c,
  }));

  timings.totalMs = now() - start;
  const candidates = [...byIndex.values()].sort((a, b) => (a.finalRank ?? 999) - (b.finalRank ?? 999) || b.fusedScore - a.fusedScore);
  const previews: RetrievalResult["previews"] = {};
  for (const [i] of byIndex) {
    const { chunk, document } = index.entries[i];
    previews[chunk.id] = {
      docName: document.name,
      docType: document.docType,
      snippet: chunk.text.slice(0, 160),
      headingPath: chunk.headingPath,
      pageStart: chunk.pageStart,
    };
  }

  return {
    query,
    previews,
    embeddedQuery: queryVector ? (deps.queryPrefix ?? "") + query : "",
    keywordQuery: useKeyword ? keywordQuery : undefined,
    options,
    results,
    candidates,
    timings,
    confidence,
    chunksSearched: allow ? index.entries.filter((_, i) => allow(i)).length : index.size,
    embeddingModel: deps.embeddingModelId,
    rerankerModel: reranked ? deps.reranker?.model.id : undefined,
  };
}
