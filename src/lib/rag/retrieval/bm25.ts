/**
 * BM25 keyword search — the classic "search engine" ranking function (used by
 * Elasticsearch/Lucene by default).
 *
 * For each query word BM25 asks:
 *   - How rare is the word across all chunks?  (IDF — "XGBoost" is rarer than "project")
 *   - How often does it appear in this chunk?   (TF, with diminishing returns via k1)
 *   - How long is this chunk?                   (long chunks are penalised via b)
 *
 *   score(chunk) = Σ  IDF(word) · tf · (k1 + 1) / (tf + k1 · (1 − b + b · len / avgLen))
 */
import { tokenize } from "./tokenizer";

export interface Bm25Hit {
  index: number;
  score: number;
}

export class Bm25Index {
  private readonly postings = new Map<string, Array<[docIndex: number, tf: number]>>();
  private readonly docLengths: number[] = [];
  private readonly avgLength: number;
  readonly size: number;

  constructor(
    documents: string[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    documents.forEach((text, docIndex) => {
      const tokens = tokenize(text);
      this.docLengths.push(tokens.length);
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [term, tf] of counts) {
        let list = this.postings.get(term);
        if (!list) this.postings.set(term, (list = []));
        list.push([docIndex, tf]);
      }
    });
    this.size = documents.length;
    const total = this.docLengths.reduce((a, n) => a + n, 0);
    this.avgLength = this.size ? total / this.size : 0;
  }

  /** Inverse document frequency (Lucene variant — always positive). */
  idf(term: string): number {
    const df = this.postings.get(term)?.length ?? 0;
    return Math.log(1 + (this.size - df + 0.5) / (df + 0.5));
  }

  search(query: string, k: number, allow?: (index: number) => boolean): Bm25Hit[] {
    const terms = [...new Set(tokenize(query))];
    const scores = new Map<number, number>();
    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = this.idf(term);
      for (const [docIndex, tf] of list) {
        if (allow && !allow(docIndex)) continue;
        const norm = 1 - this.b + (this.b * this.docLengths[docIndex]) / (this.avgLength || 1);
        const s = (idf * tf * (this.k1 + 1)) / (tf + this.k1 * norm);
        scores.set(docIndex, (scores.get(docIndex) ?? 0) + s);
      }
    }
    return [...scores.entries()]
      .map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** Query terms that exist in the index — handy for explaining keyword matches in the UI. */
  matchedTerms(query: string): string[] {
    return [...new Set(tokenize(query))].filter((t) => this.postings.has(t));
  }
}
