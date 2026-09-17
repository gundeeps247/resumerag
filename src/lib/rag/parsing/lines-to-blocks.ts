/**
 * Turns a sequence of text lines into structural blocks (headings, paragraphs, list items).
 * Shared by the plain-text parser and the PDF parser, which differ only in how much
 * layout information (font size, vertical gaps) they can provide for each line.
 */
import type { TextBlock } from "../types";
import { isAllCapsHeading, isColonHeading, joinLines, stripBullet } from "./clean";

export interface LayoutLine {
  text: string;
  page?: number;
  /** Heading level decided by the caller from layout (e.g. font size), if any. */
  headingLevel?: number;
  /** True when there is a visible vertical gap (blank line) before this line. */
  gapBefore?: boolean;
  /** True when the previous line ended well before the right margin (paragraph ended). */
  prevLineShort?: boolean;
}

const MAX_HEADING_WORDS = 12;
const LABEL_LINE = /^[A-Z][A-Za-z0-9 /&+().-]{1,30}:\s+\S/;

export function linesToBlocks(lines: LayoutLine[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  let open: TextBlock | null = null;

  const close = () => {
    if (open && open.text.trim()) blocks.push(open);
    open = null;
  };

  for (const line of lines) {
    const raw = line.text.trim();
    if (!raw) {
      close();
      continue;
    }
    const words = raw.split(/\s+/).length;

    // 1. Layout says heading (e.g. larger font in a PDF).
    if (line.headingLevel !== undefined && words <= MAX_HEADING_WORDS) {
      close();
      blocks.push({ kind: "heading", level: line.headingLevel, text: raw.replace(/:$/, ""), page: line.page });
      continue;
    }

    // 2. Bullets are checked before text heuristics so "- SQL" is a list item, not a heading.
    const { isBullet, text } = stripBullet(raw);
    if (isBullet) {
      close();
      open = { kind: "list_item", text, page: line.page };
      continue;
    }

    // 3. Text-only heading heuristics: "EXPERIENCE", "Requirements:".
    if (words <= MAX_HEADING_WORDS && (isAllCapsHeading(raw) || isColonHeading(raw))) {
      close();
      const level = isAllCapsHeading(raw) ? 2 : 3;
      blocks.push({ kind: "heading", level, text: raw.replace(/:$/, ""), page: line.page });
      continue;
    }

    const startsNewParagraph =
      !open ||
      line.gapBefore ||
      // "Languages: Python, SQL" / "Location: Remote" — label lines are separate facts.
      LABEL_LINE.test(text) ||
      (line.prevLineShort && /[.!?:]$/.test(open.text) && /^[A-Z0-9"(]/.test(text));

    if (startsNewParagraph) {
      close();
      open = { kind: "paragraph", text, page: line.page };
    } else if (open) {
      // Continuation of the current paragraph or of a wrapped bullet.
      open.text = joinLines(open.text, text);
    }
  }
  close();
  return blocks;
}
