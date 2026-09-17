/**
 * Citation handling.
 *
 * The model is asked to cite sources as [1], [2]… After generation we:
 *   1. find every citation and flag numbers that point to no source ("invalid");
 *   2. split the answer into sentences and measure how well each sentence is supported
 *      by the chunks it cites (embedding similarity, computed by the worker).
 * Sentences with weak support are highlighted as "unverified" in the UI.
 */

import { tokenize } from "../retrieval/tokenizer";

const CITATION = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;
const NUMBER_TOKEN = /\d+(?:[.,]\d+)*%?/g;

/** Numbers a sentence states ("0.89", "40%", "120,000"), normalised for comparison. */
export function numbersIn(text: string): string[] {
  return [...new Set((text.match(NUMBER_TOKEN) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, "").replace(/%$/, "")))];
}

export interface LexicalSupport {
  /** Share of the sentence's content words that appear in the cited passages. */
  overlap: number;
  /** Numbers in the sentence that appear in none of the cited passages. */
  missingNumbers: string[];
}

export function lexicalSupport(sentence: string, passages: string[]): LexicalSupport {
  const words = [...new Set(tokenize(sentence))].filter((t) => t.length > 2 && !/^\d/.test(t));
  const passageTokens = new Set(passages.flatMap((p) => tokenize(p)));
  const overlap = words.length ? words.filter((w) => passageTokens.has(w)).length / words.length : 1;
  const passageNumbers = new Set(passages.flatMap(numbersIn));
  return { overlap, missingNumbers: numbersIn(sentence).filter((n) => !passageNumbers.has(n)) };
}

/** Calibrated on hand-labelled sentence/passage pairs (scripts/dev/debug-verify.ts). */
export const SUPPORT_THRESHOLDS = { strong: 0.8, weak: 0.62, lexical: 0.5 };

/**
 * A sentence is supported when it states no number missing from its sources and is either
 * very similar to a source sentence, or moderately similar and shares most content words.
 */
export function judgeSupport(similarity: number, lexical: LexicalSupport, t = SUPPORT_THRESHOLDS): boolean {
  if (lexical.missingNumbers.length) return false;
  return similarity >= t.strong || (similarity >= t.weak && lexical.overlap >= t.lexical);
}

export const REFUSAL_TEXT = "I couldn't find enough evidence in your uploaded documents to answer this confidently.";

export function parseCitations(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(CITATION)) {
    for (const n of match[1].split(",")) found.add(Number(n.trim()));
  }
  return [...found].sort((a, b) => a - b);
}

export function invalidCitations(text: string, sourceCount: number): number[] {
  return parseCitations(text).filter((n) => n < 1 || n > sourceCount);
}

export interface AnswerSentence {
  text: string;
  citations: number[];
}

/** Splits a markdown answer into checkable sentences, keeping each sentence's citations. */
export function splitAnswerSentences(markdown: string): AnswerSentence[] {
  const lines = markdown
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+/, "").trim())
    .filter(Boolean);

  const sentences: AnswerSentence[] = [];
  for (const line of lines) {
    // Split after sentence punctuation (optionally followed by citations).
    const parts = line.split(/(?<=[.!?](?:\s*\[\d{1,2}(?:\s*,\s*\d{1,2})*\])*)\s+(?=[A-Z"(*])/);
    for (const part of parts) {
      const citations = parseCitations(part);
      const text = part
        .replace(CITATION, "")
        .replace(/\*\*/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s+([.,;:!?])/g, "$1")
        .trim();
      if (text.split(/\s+/).length < 4) continue; // headings, "Sure!" and similar fragments
      if (text.startsWith(REFUSAL_TEXT.slice(0, 30))) continue;
      sentences.push({ text, citations });
    }
  }
  return sentences;
}

/** Converts "[1][2]" / "[1, 2]" into markdown links the UI renders as citation chips. */
export function linkCitations(markdown: string, sourceCount: number): string {
  return markdown.replace(CITATION, (whole, nums: string) =>
    nums
      .split(",")
      .map((n) => Number(n.trim()))
      .map((n) => (n >= 1 && n <= sourceCount ? `[${n}](#cite-${n})` : `[${n}?](#cite-invalid)`))
      .join(""),
  );
}
