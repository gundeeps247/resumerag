/**
 * Sentence splitting.
 *
 * Uses the built-in `Intl.Segmenter` (available in every modern browser and Node 16+),
 * which knows about abbreviations and decimals far better than a naive split on ".".
 * A regex fallback keeps things working in unusual runtimes.
 */

type SentenceSegmenter = { segment(input: string): Iterable<{ segment: string }> };

let segmenter: SentenceSegmenter | null | undefined;

function getSegmenter(): SentenceSegmenter | null {
  if (segmenter !== undefined) return segmenter;
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: object) => SentenceSegmenter }).Segmenter;
  segmenter = Seg ? new Seg("en", { granularity: "sentence" }) : null;
  return segmenter;
}

export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const seg = getSegmenter();
  const parts = seg ? Array.from(seg.segment(trimmed), (s) => s.segment) : trimmed.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
  return mergeFalseBreaks(parts.map((s) => s.trim()).filter(Boolean));
}

// Common abbreviations the segmenter may still break after ("e.g. The", "vs. X").
const ABBREVIATION_END = /\b(?:e\.g|i\.e|etc|vs|approx|incl|dept|fig|no|dr|mr|ms|mrs|prof|inc|ltd|jr|sr)\.$/i;

function mergeFalseBreaks(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev && ABBREVIATION_END.test(prev)) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out;
}

/** Splits an over-long string into word-bounded pieces of at most `maxChars`. */
export function splitByWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + word.length + 1 > maxChars) {
      pieces.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}
