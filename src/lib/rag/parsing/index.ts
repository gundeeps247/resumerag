/**
 * Parser entry point: validates the file, dispatches to the right parser and
 * enforces size limits. Returns structured blocks, never raw strings.
 */
import { FILE_LIMITS } from "../config";
import type { ParsedDocument } from "../types";
import { parseDocx } from "./docx";
import { parsePdf } from "./pdf";
import { parseMarkdown, parsePlainText } from "./text";
import { titleFromFileName, validateFile } from "./validate";

export { FileValidationError, formatFromName, titleFromFileName, validateFile } from "./validate";

export async function parseFile(fileName: string, bytes: Uint8Array): Promise<ParsedDocument> {
  const format = validateFile(fileName, bytes);
  const title = titleFromFileName(fileName);

  let parsed: ParsedDocument;
  switch (format) {
    case "pdf":
      parsed = await parsePdf(bytes, title, { maxPages: FILE_LIMITS.maxPdfPages });
      break;
    case "docx":
      parsed = await parseDocx(bytes, title);
      break;
    case "md":
      parsed = parseMarkdown(decodeUtf8(bytes), title);
      break;
    case "txt":
      parsed = parsePlainText(decodeUtf8(bytes), title);
      break;
  }
  return enforceLimits(parsed);
}

/** Parses text the user pasted (e.g. a job description copied from a careers page). */
export function parsePastedText(text: string, title: string): ParsedDocument {
  const trimmed = text.slice(0, FILE_LIMITS.maxPasteChars);
  const looksLikeMarkdown = /^\s{0,3}#{1,6}\s/m.test(trimmed);
  return enforceLimits(looksLikeMarkdown ? parseMarkdown(trimmed, title) : parsePlainText(trimmed, title));
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function enforceLimits(doc: ParsedDocument): ParsedDocument {
  let total = 0;
  const blocks = [];
  for (const block of doc.blocks) {
    total += block.text.length;
    if (total > FILE_LIMITS.maxChars) {
      doc.warnings.push("Document was truncated because it exceeds the maximum supported length.");
      break;
    }
    blocks.push(block);
  }
  if (!blocks.some((b) => b.kind !== "heading")) {
    doc.warnings.push("No readable text was found in this document.");
  }
  return { ...doc, blocks };
}

/** Plain text view of a parsed document (used by the document viewer). */
export function blocksToText(doc: ParsedDocument): string {
  return doc.blocks
    .map((b) => (b.kind === "heading" ? `${"#".repeat(b.level ?? 1)} ${b.text}` : b.kind === "list_item" ? `- ${b.text}` : b.text))
    .join("\n\n");
}
