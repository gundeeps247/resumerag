/**
 * Evaluation runner shared by the in-app Evaluation page (browser worker) and the
 * `npm run eval` script (Node). It runs every question through several retrieval
 * configurations and aggregates the metrics, so the value of each pipeline stage
 * (keyword → semantic → hybrid → reranking) is measured rather than assumed.
 */
import { DEFAULT_RETRIEVAL } from "../config";
import type { RetrievalOptions } from "../types";
import { retrieve, type RetrieverDeps } from "../retrieval/retriever";
import type { EvalQuestion } from "./dataset";
import { aggregate, scoreRetrieval, type AggregateMetrics, type QuestionMetrics } from "./metrics";

export interface EvalConfig {
  id: string;
  label: string;
  options: RetrievalOptions;
}

export const EVAL_CONFIGS: EvalConfig[] = [
  { id: "keyword", label: "BM25 only", options: { ...DEFAULT_RETRIEVAL, mode: "keyword", rerank: false } },
  { id: "semantic", label: "Semantic only", options: { ...DEFAULT_RETRIEVAL, mode: "semantic", rerank: false } },
  { id: "hybrid", label: "Hybrid (BM25 + semantic, RRF)", options: { ...DEFAULT_RETRIEVAL, mode: "hybrid", rerank: false } },
  { id: "hybrid_rerank", label: "Hybrid + cross-encoder rerank", options: { ...DEFAULT_RETRIEVAL, mode: "hybrid", rerank: true } },
];

export interface QuestionResult {
  id: string;
  question: string;
  category: EvalQuestion["category"];
  answerable: boolean;
  metrics: QuestionMetrics | null;
  confidence: string;
  topScore: number;
  topDoc: string;
  latencyMs: number;
}

export interface AbstentionMetrics {
  /** Answerable questions where the system did not refuse. */
  answeredRate: number;
  /** Unanswerable questions where the system correctly refused. */
  refusalRate: number;
  /** Overall share of correct answer/refuse decisions. */
  accuracy: number;
}

export interface EvalRunResult {
  config: EvalConfig;
  k: number;
  metrics: AggregateMetrics;
  abstention: AbstentionMetrics;
  latency: { meanMs: number; p95Ms: number };
  questions: QuestionResult[];
}

export async function runEvaluation(
  questions: EvalQuestion[],
  configs: EvalConfig[],
  deps: RetrieverDeps,
  k = 5,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<EvalRunResult[]> {
  const runs: EvalRunResult[] = [];
  const total = questions.length * configs.length;
  let done = 0;

  for (const config of configs) {
    const options = { ...config.options, topK: k };
    const rows: QuestionResult[] = [];
    for (const q of questions) {
      const result = await retrieve(q.question, options, deps);
      const retrieved = result.results.map((r) => ({ docName: r.document.name, text: r.chunk.text }));
      rows.push({
        id: q.id,
        question: q.question,
        category: q.category,
        answerable: q.facts.length > 0,
        metrics: q.facts.length ? scoreRetrieval(q.facts, retrieved, k) : null,
        confidence: result.confidence.level,
        topScore: result.confidence.score,
        topDoc: result.results[0]?.document.name ?? "",
        latencyMs: result.timings.totalMs,
      });
      onProgress?.(++done, total, config.label);
    }
    runs.push(summarise(config, k, rows));
  }
  return runs;
}

function summarise(config: EvalConfig, k: number, rows: QuestionResult[]): EvalRunResult {
  const answerable = rows.filter((r) => r.answerable);
  const unanswerable = rows.filter((r) => !r.answerable);
  const answered = answerable.filter((r) => r.confidence !== "none").length;
  const refused = unanswerable.filter((r) => r.confidence === "none").length;
  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    config,
    k,
    metrics: aggregate(answerable.map((r) => r.metrics!)),
    abstention: {
      answeredRate: answerable.length ? answered / answerable.length : 0,
      refusalRate: unanswerable.length ? refused / unanswerable.length : 0,
      accuracy: rows.length ? (answered + refused) / rows.length : 0,
    },
    latency: {
      meanMs: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
      p95Ms: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0,
    },
    questions: rows,
  };
}
