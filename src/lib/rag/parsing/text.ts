/**
 * Markdown and plain-text parsers.
 *
 * Markdown already encodes structure (# headings, - lists, | tables), so we read it
 * directly. Plain text is handled with the same line heuristics used for PDFs.
 */
import type { ParsedDocument, TextBlock } from "../types";
import { cleanLine, normalizeText } from "./clean";
import { linesToBlocks } from "./lines-to-blocks";

/** Removes inline markdown syntax: **bold**, `code`, [link](url), ![img](url). */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "");
}

export function parseMarkdown(raw: string, title: string): ParsedDocument {
  const lines = normalizeText(raw).split("\n");
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let inCode = false;
  let code: string[] = [];

  const flushParagraph = () => {
    const text = cleanLine(stripInlineMarkdown(paragraph.join(" ")));
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*(```|~~~)/.test(line)) {
      if (inCode) {
        if (code.length) blocks.push({ kind: "paragraph", text: code.join("\n").trim() });
        code = [];
      } else {
        flushParagraph();
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    const atx = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (atx) {
      flushParagraph();
      blocks.push({ kind: "heading", level: atx[1].length, text: stripInlineMarkdown(atx[2]) });
      continue;
    }

    // Setext headings: a text line underlined with === or ---.
    const next = lines[i + 1];
    if (paragraph.length === 0 && line.trim() && next && /^\s*(=+|-+)\s*$/.test(next) && !/^\s*[-*+]\s/.test(line)) {
      blocks.push({ kind: "heading", level: next.trim().startsWith("=") ? 1 : 2, text: stripInlineMarkdown(line.trim()) });
      i++;
      continue;
    }

    const list = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (list) {
      flushParagraph();
      blocks.push({ kind: "list_item", text: cleanLine(stripInlineMarkdown(list[1])) });
      continue;
    }

    if (/^\s*\|/.test(line)) {
      flushParagraph();
      if (/^\s*\|?\s*:?-{2,}/.test(line.replace(/\|/g, "|"))) continue; // |---|---| separator
      const cells = line
        .split("|")
        .map((c) => cleanLine(stripInlineMarkdown(c)))
        .filter(Boolean);
      if (cells.length) blocks.push({ kind: "table_row", text: cells.join(" | ") });
      continue;
    }

    if (/^\s*(>\s*)/.test(line)) {
      paragraph.push(line.replace(/^\s*>\s*/, ""));
      continue;
    }

    if (!line.trim() || /^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushParagraph();
      continue;
    }

    // A line that is entirely bold ("**LexiSearch**") is used as a heading in many notes.
    const boldLine = line.trim().match(/^(\*\*|__)([^*_]{2,80})\1:?$/);
    if (boldLine) {
      flushParagraph();
      blocks.push({ kind: "heading", level: 4, text: boldLine[2].trim() });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();

  return { title, format: "md", blocks, warnings: [] };
}

export function parsePlainText(raw: string, title: string): ParsedDocument {
  const lines = normalizeText(raw).split("\n");
  const firstIndex = lines.findIndex((l) => l.trim());
  const blocks = linesToBlocks(
    lines.map((text, i) => {
      // A short opening line ("Machine Learning Engineer - Northwind") is the document title.
      const isTitle = i === firstIndex && text.trim().split(/\s+/).length <= 12 && !/[.!?]$/.test(text.trim()) && !/^\s*[-*•]/.test(text);
      return { text, gapBefore: i > 0 && !lines[i - 1].trim(), headingLevel: isTitle ? 1 : undefined };
    }),
  );
  return { title, format: "txt", blocks, warnings: [] };
}
