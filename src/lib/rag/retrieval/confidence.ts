/**
 * Retrieval confidence: "do my documents actually contain an answer to this?"
 *
 * If the best evidence is weak we refuse to generate instead of letting the LLM guess.
 * The best signal is the reranker's relevance probability; without the reranker we
 * fall back to cosine similarity. Thresholds are per-model because every model has
 * its own similarity scale (they were calibrated with the evaluation set, including
 * deliberately unanswerable questions).
 */
import type { ConfidenceCalibration } from "../embeddings/models";
import type { RetrievalConfidence, ScoredCandidate } from "../types";

export function assessConfidence(
  selected: ScoredCandidate[],
  signal: "rerank" | "dense" | "keyword",
  calibration: ConfidenceCalibration,
  embeddingCalibration?: ConfidenceCalibration,
): RetrievalConfidence {
  const result = baseConfidence(selected, signal, calibration);
  // Second opinion: the cross-encoder gives near-zero scores to some legitimate question
  // styles. If the embedding model still sees a clear semantic match, don't refuse outright.
  const rescue = embeddingCalibration?.semanticRescue;
  if (signal === "rerank" && result.level === "none" && rescue !== undefined) {
    const bestDense = Math.max(0, ...selected.map((c) => c.denseScore ?? 0));
    if (bestDense >= rescue) {
      return {
        level: "low",
        score: result.score,
        reason: `The reranker found no clearly relevant passage, but semantic similarity is ${bestDense.toFixed(2)} — the answer may be incomplete.`,
      };
    }
  }
  return result;
}

function baseConfidence(
  selected: ScoredCandidate[],
  signal: "rerank" | "dense" | "keyword",
  calibration: ConfidenceCalibration,
): RetrievalConfidence {
  if (!selected.length) {
    return { level: "none", score: 0, reason: "No passages matched the question." };
  }

  if (signal === "keyword") {
    // BM25 scores are unbounded, so only say whether exact terms were found.
    return { level: "medium", score: 0.5, reason: "Exact keyword matches found (semantic scoring disabled)." };
  }

  const values = selected.map((c) => (signal === "rerank" ? c.rerankScore : c.denseScore) ?? 0);
  const best = Math.max(...values);
  const strong = values.filter((v) => v >= calibration.medium).length;
  const label = signal === "rerank" ? "reranker relevance" : "semantic similarity";

  if (best >= calibration.high) {
    return { level: "high", score: best, reason: `Strong evidence: best ${label} ${best.toFixed(2)}, ${strong} supporting passage(s).` };
  }
  if (best >= calibration.medium) {
    return { level: "medium", score: best, reason: `Reasonable evidence: best ${label} ${best.toFixed(2)}.` };
  }
  if (best >= calibration.low) {
    return { level: "low", score: best, reason: `Weak evidence: best ${label} is only ${best.toFixed(2)}. The answer may be incomplete.` };
  }
  return { level: "none", score: best, reason: `No passage looks relevant (best ${label} ${best.toFixed(2)}).` };
}
