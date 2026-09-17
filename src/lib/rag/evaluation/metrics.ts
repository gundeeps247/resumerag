/**
 * Retrieval metrics.
 *
 * Each evaluation question lists the *facts* that a good answer needs (e.g. "XGBoost" in
 * the resume, "0.89" in the project report). A retrieved chunk is relevant if it contains
 * one of those facts. Defining relevance by facts instead of chunk ids keeps the metrics
 * comparable across different chunk sizes.
 *
 *  - Hit@K       did at least one relevant chunk appear in the top K?
 *  - Recall@K    what fraction of the needed facts appear in the top K?
 *  - Precision@K what fraction of the top K chunks are relevant?
 *  - MRR         1 / rank of the first relevant chunk (1.0 = always first)
 *  - nDCG@K      rewards relevant chunks near the top, with a log discount
 */

export interface FactSpec {
  /** Substring of the source document's file name, e.g. "resume". */
  doc: string;
  /** The chunk must contain at least one of these (case-insensitive). */
  anyOf: string[];
}

export interface RetrievedForEval {
  docName: string;
  text: string;
}

export function factMatches(fact: FactSpec, item: RetrievedForEval): boolean {
  if (!item.docName.toLowerCase().includes(fact.doc.toLowerCase())) return false;
  const text = item.text.toLowerCase();
  return fact.anyOf.some((needle) => text.includes(needle.toLowerCase()));
}

export function isRelevant(facts: FactSpec[], item: RetrievedForEval): boolean {
  return facts.some((f) => factMatches(f, item));
}

export interface QuestionMetrics {
  hit: number;
  recall: number;
  precision: number;
  reciprocalRank: number;
  ndcg: number;
  firstRelevantRank: number | null;
}

export function scoreRetrieval(facts: FactSpec[], retrieved: RetrievedForEval[], k: number): QuestionMetrics {
  const top = retrieved.slice(0, k);
  const relevance = top.map((item) => (isRelevant(facts, item) ? 1 : 0));
  const firstIndex = retrieved.findIndex((item) => isRelevant(facts, item));
  const factsFound = facts.filter((f) => top.some((item) => factMatches(f, item))).length;

  const dcg = relevance.reduce<number>((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  const idealCount = Math.min(k, Math.max(1, facts.length));
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) idcg += 1 / Math.log2(i + 2);

  return {
    hit: relevance.some(Boolean) ? 1 : 0,
    recall: facts.length ? factsFound / facts.length : 0,
    precision: top.length ? relevance.reduce<number>((a, b) => a + b, 0) / k : 0,
    reciprocalRank: firstIndex >= 0 ? 1 / (firstIndex + 1) : 0,
    ndcg: idcg ? Math.min(1, dcg / idcg) : 0,
    firstRelevantRank: firstIndex >= 0 ? firstIndex + 1 : null,
  };
}

export interface AggregateMetrics {
  hitRate: number;
  recall: number;
  precision: number;
  mrr: number;
  ndcg: number;
  count: number;
}

export function aggregate(rows: QuestionMetrics[]): AggregateMetrics {
  const n = rows.length || 1;
  const mean = (pick: (m: QuestionMetrics) => number) => rows.reduce((s, m) => s + pick(m), 0) / n;
  return {
    hitRate: mean((m) => m.hit),
    recall: mean((m) => m.recall),
    precision: mean((m) => m.precision),
    mrr: mean((m) => m.reciprocalRank),
    ndcg: mean((m) => m.ndcg),
    count: rows.length,
  };
}
