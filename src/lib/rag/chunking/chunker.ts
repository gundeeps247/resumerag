/**
 * Structure-aware chunking.
 *
 * Instead of slicing text every N characters, the chunker walks the *blocks* produced
 * by the parser (headings, paragraphs, list items) and packs them into chunks:
 *
 *  1. A heading starts a new section. Chunks never span two sections, and every chunk
 *     remembers its heading path (e.g. ["Projects", "LexiSearch"]).
 *  2. Blocks are packed whole until the chunk reaches `chunkSize` tokens.
 *  3. A block too big to fit is split at sentence boundaries (never mid-sentence,
 *     unless a single "sentence" is itself larger than a chunk).
 *  4. When a chunk fills up inside a section, the next chunk starts with the last
 *     ~`chunkOverlap` tokens of the previous one, so facts on the boundary survive.
 *  5. Tiny leftovers (e.g. a two-word "Languages" section) are merged into a neighbour.
 */
import type { BlockKind, ChunkDraft, ChunkingOptions, TextBlock } from "../types";
import { splitByWords, splitSentences } from "./sentences";
import { estimateTokens } from "./tokens";

/** An atomic piece of text that the packer places into chunks. */
interface Unit {
  text: string;
  tokens: number;
  kind: BlockKind;
  blockId: number;
  /** True when this unit is the first piece of its block (used for list markers). */
  blockStart: boolean;
  page?: number;
  overlap?: boolean;
}

type Draft = Omit<ChunkDraft, "index">;

export function chunkBlocks(blocks: TextBlock[], options: ChunkingOptions): ChunkDraft[] {
  const size = Math.max(32, options.chunkSize);
  const overlapBudget = Math.max(0, Math.min(options.chunkOverlap, Math.floor(size / 2)));

  const drafts: Draft[] = [];
  const headingStack: { level: number; text: string }[] = [];
  let path: string[] = [];
  let units: Unit[] = [];
  let tokens = 0;

  const newTokens = () => units.filter((u) => !u.overlap).reduce((sum, u) => sum + u.tokens, 0);

  const flush = (carryOverlap: boolean) => {
    // A chunk made only of overlap text carries no new information.
    if (units.some((u) => !u.overlap)) drafts.push(buildDraft(units, path));
    units = carryOverlap ? takeOverlap(units, overlapBudget) : [];
    tokens = units.reduce((sum, u) => sum + u.tokens, 0);
  };

  const push = (unit: Unit) => {
    units.push(unit);
    tokens += unit.tokens;
  };

  blocks.forEach((block, blockId) => {
    const text = block.text.trim();
    if (!text) return;

    if (block.kind === "heading") {
      flush(false);
      const level = block.level ?? 1;
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });
      path = headingStack.map((h) => h.text);
      return;
    }

    const blockTokens = estimateTokens(text);
    const base = { kind: block.kind, blockId, page: block.page };

    if (tokens + blockTokens <= size) {
      push({ ...base, text, tokens: blockTokens, blockStart: true });
      return;
    }

    // The block does not fit. If it is small and the current chunk already holds a
    // good amount of text, start a fresh chunk. Otherwise split it into sentences.
    if (blockTokens <= size && newTokens() >= size * 0.5) {
      flush(true);
      push({ ...base, text, tokens: blockTokens, blockStart: true });
      return;
    }

    splitIntoPieces(text, size).forEach((piece, i) => {
      const pieceTokens = estimateTokens(piece);
      if (tokens + pieceTokens > size && units.some((u) => !u.overlap)) flush(true);
      push({ ...base, text: piece, tokens: pieceTokens, blockStart: i === 0 });
    });
  });
  flush(false);

  return mergeSmallDrafts(drafts, options.minChunkSize, size).map((d, index) => ({ ...d, index }));
}

/** Sentences, with over-long sentences further split on word boundaries. */
function splitIntoPieces(text: string, size: number): string[] {
  const maxChars = size * 4;
  return splitSentences(text).flatMap((s) => (estimateTokens(s) > size ? splitByWords(s, maxChars) : [s]));
}

/** Picks the trailing units (or trailing sentences of the last unit) that fit the overlap budget. */
function takeOverlap(units: Unit[], budget: number): Unit[] {
  if (budget <= 0) return [];
  const picked: Unit[] = [];
  let remaining = budget;
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    if (unit.tokens <= remaining) {
      picked.unshift({ ...unit, overlap: true });
      remaining -= unit.tokens;
      continue;
    }
    // Take trailing sentences of this unit that still fit, then stop.
    const sentences = splitSentences(unit.text);
    const tail: string[] = [];
    for (let j = sentences.length - 1; j >= 1; j--) {
      const t = estimateTokens(sentences[j]);
      if (t > remaining) break;
      tail.unshift(sentences[j]);
      remaining -= t;
    }
    if (tail.length) {
      const text = tail.join(" ");
      picked.unshift({ ...unit, text, tokens: estimateTokens(text), blockStart: false, overlap: true });
    }
    break;
  }
  return picked;
}

function buildDraft(units: Unit[], path: string[]): Draft {
  let text = "";
  let overlapChars = 0;
  let prev: Unit | undefined;
  for (const unit of units) {
    const piece = unit.kind === "list_item" && unit.blockStart ? `- ${unit.text}` : unit.text;
    if (!prev) text = piece;
    else if (prev.blockId === unit.blockId) text += ` ${piece}`;
    else if (prev.kind === unit.kind && (unit.kind === "list_item" || unit.kind === "table_row")) text += `\n${piece}`;
    else text += `\n\n${piece}`;
    if (unit.overlap) overlapChars = text.length;
    prev = unit;
  }
  const pages = units.map((u) => u.page).filter((p): p is number => typeof p === "number");
  return {
    text,
    headingPath: [...path],
    pageStart: pages.length ? Math.min(...pages) : undefined,
    pageEnd: pages.length ? Math.max(...pages) : undefined,
    tokenCount: estimateTokens(text),
    overlapChars: overlapChars || undefined,
  };
}

/** Merges chunks smaller than `minTokens` into an adjacent chunk when the result still fits. */
function mergeSmallDrafts(drafts: Draft[], minTokens: number, size: number): Draft[] {
  const out: Draft[] = [];
  for (const draft of drafts) {
    const prev = out[out.length - 1];
    const isSmall = draft.tokenCount < minTokens;
    const prevIsSmall = prev && prev.tokenCount < minTokens;
    if (prev && (isSmall || prevIsSmall) && prev.tokenCount + draft.tokenCount <= size) {
      out[out.length - 1] = mergeTwo(prev, draft);
    } else {
      out.push(draft);
    }
  }
  return out;
}

function mergeTwo(a: Draft, b: Draft): Draft {
  const common: string[] = [];
  for (let i = 0; i < Math.min(a.headingPath.length, b.headingPath.length); i++) {
    if (a.headingPath[i] !== b.headingPath[i]) break;
    common.push(a.headingPath[i]);
  }
  // When the merged pieces came from different sections, keep their heading inline
  // so the text still says what it is about ("Awards: Winner, HackNorth 2023").
  const label = (d: Draft) => (d.headingPath.length > common.length ? `${d.headingPath[d.headingPath.length - 1]}:\n` : "");
  const text = `${label(a)}${a.text}\n\n${label(b)}${b.text}`;
  const pages = [a.pageStart, a.pageEnd, b.pageStart, b.pageEnd].filter((p): p is number => typeof p === "number");
  return {
    text,
    headingPath: common,
    pageStart: pages.length ? Math.min(...pages) : undefined,
    pageEnd: pages.length ? Math.max(...pages) : undefined,
    tokenCount: estimateTokens(text),
    overlapChars: a.overlapChars ? a.overlapChars + label(a).length : undefined,
  };
}

/**
 * The text that gets embedded: document title + heading path + chunk text.
 * This "contextual header" lets a bullet like "Improved AUC from 0.78 to 0.89" be found
 * by a question about the churn project even though the bullet never names the project.
 */
export function buildEmbedText(docTitle: string, headingPath: string[], text: string): string {
  const header = [docTitle, ...headingPath].filter(Boolean).join(" > ");
  return header ? `${header}\n${text}` : text;
}
