import { describe, expect, it } from "vitest";
import { buildEmbedText, chunkBlocks } from "@/lib/rag/chunking/chunker";
import { splitSentences } from "@/lib/rag/chunking/sentences";
import { estimateTokens } from "@/lib/rag/chunking/tokens";
import type { TextBlock } from "@/lib/rag/types";

const opts = { chunkSize: 60, chunkOverlap: 12, minChunkSize: 8 };

describe("chunkBlocks", () => {
  it("never mixes two sections in one chunk and records the heading path", () => {
    const blocks: TextBlock[] = [
      { kind: "heading", level: 1, text: "Projects" },
      { kind: "heading", level: 2, text: "Churn Prediction" },
      { kind: "list_item", text: "Built a customer churn prediction system using XGBoost on 120k customers." },
      { kind: "heading", level: 2, text: "LexiSearch" },
      { kind: "list_item", text: "Semantic search engine for legal documents using FAISS and sentence-transformers." },
    ];
    const chunks = chunkBlocks(blocks, { ...opts, minChunkSize: 1 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toEqual(["Projects", "Churn Prediction"]);
    expect(chunks[0].text).toContain("XGBoost");
    expect(chunks[0].text).not.toContain("FAISS");
    expect(chunks[1].headingPath).toEqual(["Projects", "LexiSearch"]);
  });

  it("respects the chunk size and splits long paragraphs at sentence boundaries", () => {
    const sentence = "The model was retrained weekly with fresh customer data from the warehouse.";
    const blocks: TextBlock[] = [{ kind: "paragraph", text: Array(12).fill(sentence).join(" ") }];
    const chunks = chunkBlocks(blocks, opts);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(opts.chunkSize + 5);
      // Every chunk ends at a sentence boundary.
      expect(c.text.trim().endsWith(".")).toBe(true);
    }
  });

  it("adds overlap between consecutive chunks of the same section", () => {
    const blocks: TextBlock[] = Array.from({ length: 8 }, (_, i) => ({
      kind: "paragraph" as const,
      text: `Paragraph ${i} explains one design decision about the retrieval pipeline. It was measured.`,
    }));
    const chunks = chunkBlocks(blocks, opts);
    expect(chunks.length).toBeGreaterThan(1);
    const second = chunks[1];
    expect(second.overlapChars).toBeGreaterThan(0);
    const overlapText = second.text.slice(0, second.overlapChars);
    expect(overlapText.trim()).toBe("It was measured.");
    expect(chunks[0].text.endsWith(overlapText.trim())).toBe(true);
  });

  it("never carries a partial sentence as overlap", () => {
    const blocks: TextBlock[] = Array.from({ length: 6 }, (_, i) => ({
      kind: "paragraph" as const,
      text: `Paragraph ${i} is one long sentence that is bigger than the whole overlap budget allows.`,
    }));
    const chunks = chunkBlocks(blocks, opts);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => !c.overlapChars)).toBe(true);
  });

  it("keeps page ranges", () => {
    const blocks: TextBlock[] = [
      { kind: "paragraph", text: "Page one text about data cleaning.", page: 1 },
      { kind: "paragraph", text: "Page two text about model training.", page: 2 },
    ];
    const [chunk] = chunkBlocks(blocks, { ...opts, chunkSize: 200 });
    expect(chunk.pageStart).toBe(1);
    expect(chunk.pageEnd).toBe(2);
  });

  it("merges tiny sections into a neighbour and keeps their heading inline", () => {
    const blocks: TextBlock[] = [
      { kind: "heading", level: 2, text: "Skills" },
      { kind: "paragraph", text: "Python, TypeScript, SQL, PyTorch, scikit-learn, Docker and AWS." },
      { kind: "heading", level: 2, text: "Languages" },
      { kind: "paragraph", text: "English, Hindi." },
    ];
    const chunks = chunkBlocks(blocks, { chunkSize: 100, chunkOverlap: 10, minChunkSize: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("Languages:");
    expect(chunks[0].text).toContain("English, Hindi.");
  });

  it("renders list items with a dash so the LLM sees the structure", () => {
    const blocks: TextBlock[] = [
      { kind: "list_item", text: "First bullet." },
      { kind: "list_item", text: "Second bullet." },
    ];
    const [chunk] = chunkBlocks(blocks, { ...opts, minChunkSize: 1 });
    expect(chunk.text).toBe("- First bullet.\n- Second bullet.");
  });

  it("returns no chunks for empty input", () => {
    expect(chunkBlocks([], opts)).toEqual([]);
  });
});

describe("helpers", () => {
  it("estimates ~4 characters per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd".repeat(10))).toBe(10);
  });

  it("splits sentences without breaking decimals or abbreviations", () => {
    const s = splitSentences("AUC improved to 0.89 in testing. We used XGBoost, e.g. for ranking. Done.");
    expect(s).toEqual(["AUC improved to 0.89 in testing.", "We used XGBoost, e.g. for ranking.", "Done."]);
  });

  it("builds a contextual header for embeddings", () => {
    expect(buildEmbedText("Resume", ["Projects", "Churn"], "Built X")).toBe("Resume > Projects > Churn\nBuilt X");
  });
});
