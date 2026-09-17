/**
 * DOCX parser.
 *
 * `mammoth` converts a Word document into simple, predictable HTML (h1–h6, p, li, table)
 * based on paragraph styles. We then convert that HTML into blocks with a small
 * dedicated converter — no DOM required, so it also runs inside a Web Worker.
 *
 * Word has no fixed pages (pagination depends on the renderer), so DOCX citations use
 * the section heading path instead of page numbers.
 */
import mammoth from "mammoth";
import type { ParsedDocument, TextBlock } from "../types";
import { cleanLine, normalizeText } from "./clean";

const STYLE_MAP = ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"];

export async function parseDocx(bytes: Uint8Array, title: string): Promise<ParsedDocument> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // mammoth's browser build reads `arrayBuffer`, its Node build reads `buffer`; pass both so
  // the same parser works in the Web Worker and in the Node evaluation script.
  const input = { arrayBuffer, buffer: arrayBuffer } as unknown as { arrayBuffer: ArrayBuffer };
  const result = await mammoth.convertToHtml(input, { styleMap: STYLE_MAP });
  const warnings = result.messages
    .filter((m) => m.type === "error")
    .map((m) => `DOCX: ${m.message}`)
    .slice(0, 3);
  return { title, format: "docx", blocks: htmlToBlocks(result.value), warnings };
}

const ELEMENT = /<(h[1-6]|p|li|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** Converts mammoth's HTML output into blocks. Exported for unit tests. */
export function htmlToBlocks(html: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const match of html.matchAll(ELEMENT)) {
    const tag = match[1].toLowerCase();
    const inner = match[2];

    if (tag === "tr") {
      const cells = [...inner.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => toText(c[1])).filter(Boolean);
      if (cells.length) blocks.push({ kind: "table_row", text: cells.join(" | ") });
      continue;
    }

    const text = toText(inner);
    if (!text) continue;

    if (tag.startsWith("h")) {
      blocks.push({ kind: "heading", level: Number(tag[1]), text });
    } else if (tag === "li") {
      blocks.push({ kind: "list_item", text });
    } else if (isBoldOnlyShort(inner, text)) {
      // Many Word documents use bold paragraphs as headings instead of heading styles.
      blocks.push({ kind: "heading", level: 4, text: text.replace(/:$/, "") });
    } else {
      blocks.push({ kind: "paragraph", text });
    }
  }
  return blocks;
}

function isBoldOnlyShort(innerHtml: string, text: string): boolean {
  const trimmed = innerHtml.trim();
  return (
    /^<strong>[\s\S]*<\/strong>$/i.test(trimmed) &&
    !/<\/strong>[\s\S]*<strong>/i.test(trimmed) &&
    text.split(/\s+/).length <= 10 &&
    !/[.!?]$/.test(text)
  );
}

function toText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, " ").replace(/<\/(p|li|td|th)>/gi, " ");
  return cleanLine(normalizeText(decodeEntities(withBreaks.replace(/<[^>]+>/g, ""))));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}
