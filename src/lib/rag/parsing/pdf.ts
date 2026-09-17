/**
 * PDF parser.
 *
 * PDFs do not store paragraphs or headings — only positioned text fragments.
 * We use pdf.js (via `unpdf`) to get every fragment with its x/y position and
 * font size, then rebuild the structure:
 *
 *   fragments → lines (same y) → headings (font noticeably larger than body text)
 *             → paragraphs / bullets (vertical gaps, bullet glyphs)
 *
 * Page numbers are kept on every block so citations can say "resume.pdf, page 2".
 */
import { extractTextItems, getDocumentProxy } from "unpdf";
import type { ParsedDocument } from "../types";
import { cleanLine, normalizeText } from "./clean";
import { linesToBlocks, type LayoutLine } from "./lines-to-blocks";

interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  hasEOL: boolean;
}

interface RawLine {
  text: string;
  y: number;
  xStart: number;
  xEnd: number;
  fontSize: number;
  page: number;
}

export interface PdfParseOptions {
  maxPages: number;
}

export async function parsePdf(bytes: Uint8Array, title: string, options: PdfParseOptions): Promise<ParsedDocument> {
  // pdf.js never executes JavaScript embedded in PDFs; we additionally cap image decoding
  // so a malicious file cannot allocate gigabytes of memory.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: 16_777_216 });
  const warnings: string[] = [];
  const pageCount = pdf.numPages;
  if (pageCount > options.maxPages) {
    throw new Error(`PDF has ${pageCount} pages; the limit is ${options.maxPages}.`);
  }

  const { items } = await extractTextItems(pdf);
  const pages: RawLine[][] = (items as PdfItem[][]).map((pageItems, i) => groupIntoLines(pageItems, i + 1));
  await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();

  const allLines = removeRepeatedHeadersFooters(pages).flat();
  const totalChars = allLines.reduce((n, l) => n + l.text.length, 0);
  if (totalChars < 40 * pageCount) {
    warnings.push(
      "Very little selectable text was found. This PDF may be scanned or image-based; OCR is not supported, so some content may be missing.",
    );
  }

  const bodySize = dominantFontSize(allLines);
  const headingSizes = [...new Set(allLines.map((l) => round(l.fontSize)))].filter((s) => s >= bodySize * 1.08).sort((a, b) => b - a);
  const rightMargin = percentile(
    allLines.map((l) => l.xEnd),
    0.9,
  );

  const layoutLines: LayoutLine[] = allLines.map((line, i) => {
    const prev = allLines[i - 1];
    const samePage = prev && prev.page === line.page;
    const gap = samePage ? prev.y - line.y : 0;
    const lineHeight = Math.max(line.fontSize, prev?.fontSize ?? 0) * 1.2;
    const sizeRank = headingSizes.indexOf(round(line.fontSize));
    return {
      text: line.text,
      page: line.page,
      headingLevel: sizeRank >= 0 ? Math.min(sizeRank + 1, 4) : undefined,
      gapBefore: !samePage || gap > lineHeight * 1.45,
      prevLineShort: samePage && prev.xEnd < rightMargin * 0.8,
    };
  });

  return { title, format: "pdf", blocks: linesToBlocks(layoutLines), pageCount, warnings };
}

/** Groups positioned fragments into visual lines (top-to-bottom, left-to-right). */
function groupIntoLines(items: PdfItem[], page: number): RawLine[] {
  const fragments = items.filter((it) => it.str.trim() || it.hasEOL);
  const lines: { items: PdfItem[]; y: number; size: number }[] = [];

  for (const item of fragments) {
    if (!item.str.trim()) continue;
    const size = item.fontSize || item.height || 10;
    const line = lines.find((l) => Math.abs(l.y - item.y) < Math.max(2, Math.min(l.size, size) * 0.5));
    if (line) {
      line.items.push(item);
      line.size = Math.max(line.size, size);
    } else {
      lines.push({ items: [item], y: item.y, size });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y) // PDF y grows upwards
    .map((line) => {
      const sorted = line.items.sort((a, b) => a.x - b.x);
      let text = "";
      let prevEnd = -Infinity;
      for (const it of sorted) {
        const gap = it.x - prevEnd;
        const needsSpace = text && !text.endsWith(" ") && !it.str.startsWith(" ") && gap > (it.fontSize || 10) * 0.15;
        text += (needsSpace ? " " : "") + it.str;
        prevEnd = it.x + it.width;
      }
      const cleaned = cleanLine(normalizeText(text));
      return {
        text: cleaned,
        y: line.y,
        xStart: sorted[0].x,
        xEnd: prevEnd,
        fontSize: dominantItemSize(sorted),
        page,
      };
    })
    .filter((l) => l.text);
}

function dominantItemSize(items: PdfItem[]): number {
  const weights = new Map<number, number>();
  for (const it of items) {
    const s = round(it.fontSize || it.height || 10);
    weights.set(s, (weights.get(s) ?? 0) + it.str.length);
  }
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/** Most common font size weighted by characters — this is the body text size. */
function dominantFontSize(lines: RawLine[]): number {
  const weights = new Map<number, number>();
  for (const l of lines) weights.set(round(l.fontSize), (weights.get(round(l.fontSize)) ?? 0) + l.text.length);
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/** Drops lines such as "Page 3 of 7" or a running title that repeat on most pages. */
function removeRepeatedHeadersFooters(pages: RawLine[][]): RawLine[][] {
  if (pages.length < 3) return pages;
  const key = (t: string) => t.toLowerCase().replace(/\d+/g, "#");
  const counts = new Map<string, number>();
  for (const page of pages) {
    const edgeLines = [...page.slice(0, 2), ...page.slice(-2)];
    for (const k of new Set(edgeLines.map((l) => key(l.text)))) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const repeated = new Set([...counts.entries()].filter(([, n]) => n >= pages.length * 0.5).map(([k]) => k));
  return pages.map((page) =>
    page.filter((l, i) => {
      const isEdge = i < 2 || i >= page.length - 2;
      return !(isEdge && repeated.has(key(l.text)) && l.text.length < 80);
    }),
  );
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function round(n: number): number {
  return Math.round(n * 2) / 2;
}
