import { describe, expect, it } from "vitest";
import { cosineSimilarity, l2Normalize, topKByDot } from "@/lib/rag/embeddings/vector-math";
import { Bm25Index } from "@/lib/rag/retrieval/bm25";
import { reciprocalRankFusion } from "@/lib/rag/retrieval/fusion";
import { tokenize } from "@/lib/rag/retrieval/tokenizer";

describe("tokenize", () => {
  it("keeps technical terms intact and also emits their parts", () => {
    const tokens = tokenize("Built APIs in Node.js, C++ and scikit-learn with CI/CD");
    expect(tokens).toEqual(expect.arrayContaining(["node.js", "node", "js", "c++", "scikit-learn", "scikit", "learn", "ci/cd"]));
  });

  it("drops stopwords and question words", () => {
    expect(tokenize("What machine learning project did I build?")).toEqual(["machine", "learning", "project", "build"]);
  });

  it("folds simple plurals consistently", () => {
    expect(tokenize("projects models")).toEqual(["project", "model"]);
    expect(tokenize("analysis status class")).toEqual(["analysis", "status", "class"]);
  });

  it("keeps decimal numbers whole", () => {
    expect(tokenize("AUC of 0.89")).toEqual(["auc", "0.89"]);
  });
});

describe("Bm25Index", () => {
  const docs = [
    "Built a customer churn prediction system using XGBoost.",
    "Designed a semantic search engine with FAISS and sentence-transformers.",
    "Led a team project building a campus marketplace in Next.js.",
    "Project report: churn churn churn analysis for the retention team.",
  ];
  const index = new Bm25Index(docs);

  it("ranks the chunk containing a rare exact term first", () => {
    const [top] = index.search("XGBoost", 3);
    expect(top.index).toBe(0);
  });

  it("gives rare terms more weight than common ones", () => {
    expect(index.idf("xgboost")).toBeGreaterThan(index.idf("churn"));
  });

  it("returns nothing for unknown terms and honours filters", () => {
    expect(index.search("kubernetes", 3)).toEqual([]);
    const filtered = index.search("churn", 5, (i) => i !== 3);
    expect(filtered.map((h) => h.index)).toEqual([0]);
  });

  it("saturates term frequency (k1) so repetition does not dominate", () => {
    const hits = index.search("churn prediction", 4);
    expect(hits[0].index).toBe(0);
  });

  it("reports matched terms", () => {
    expect(index.matchedTerms("XGBoost and Kubernetes")).toEqual(["xgboost"]);
  });
});

describe("reciprocalRankFusion", () => {
  it("rewards items ranked well by both retrievers", () => {
    const scores = reciprocalRankFusion([
      ["a", "b", "c"],
      ["b", "d", "a"],
    ]);
    const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(ranked.slice(0, 2)).toEqual(["b", "a"]);
    expect(scores.get("b")).toBeCloseTo(1 / 62 + 1 / 61);
  });

  it("supports weights", () => {
    const scores = reciprocalRankFusion([["a"], ["b"]], 60, [2, 1]);
    expect(scores.get("a")!).toBeGreaterThan(scores.get("b")!);
  });
});

describe("vector math", () => {
  it("normalises vectors so dot product equals cosine similarity", () => {
    const a = l2Normalize(new Float32Array([3, 4]));
    const b = l2Normalize(new Float32Array([4, 3]));
    expect(a[0]).toBeCloseTo(0.6);
    expect(a[0] * b[0] + a[1] * b[1]).toBeCloseTo(cosineSimilarity([3, 4], [4, 3]));
  });

  it("finds exact nearest neighbours in a flat matrix", () => {
    const matrix = new Float32Array([1, 0, 0, 1, 0.7071, 0.7071]);
    const hits = topKByDot(matrix, 2, new Float32Array([1, 0]), 2);
    expect(hits.map((h) => h.index)).toEqual([0, 2]);
    const filtered = topKByDot(matrix, 2, new Float32Array([1, 0]), 2, (i) => i !== 0);
    expect(filtered[0].index).toBe(2);
  });
});
