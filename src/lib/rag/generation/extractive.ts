/**
 * Evidence-only answers (no LLM).
 *
 * When no language model is reachable (e.g. a static deployment without Ollama) the app
 * still works as a semantic search engine: it shows the most relevant sentences from the
 * retrieved chunks, each with its citation. Nothing is generated, so nothing can be
 * hallucinated — the answer is clearly labelled as extracted evidence.
 */
import { splitSentences } from "../chunking/sentences";
import { tokenize } from "../retrieval/tokenizer";
import type { RetrievedChunk } from "../types";

export function extractiveAnswer(question: string, results: RetrievedChunk[], maxSources = 3): string {
  const queryTerms = new Set(tokenize(question));
  const lines: string[] = [];

  results.slice(0, maxSources).forEach((result, i) => {
    const sentences = splitSentences(result.chunk.text.replace(/^- /gm, "")).filter((s) => s.length > 20);
    const ranked = sentences
      .map((s, order) => ({ s, order, overlap: tokenize(s).filter((t) => queryTerms.has(t)).length }))
      .sort((a, b) => b.overlap - a.overlap || a.order - b.order)
      .slice(0, 2)
      .sort((a, b) => a.order - b.order);
    const picked = ranked.length ? ranked.map((r) => r.s) : [result.chunk.text.slice(0, 280)];
    for (const sentence of picked) lines.push(`- ${sentence.trim()} [${i + 1}]`);
  });

  return `**Evidence from your documents** (no language model connected — these are direct quotes, not a generated answer):\n\n${lines.join("\n")}`;
}
