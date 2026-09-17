/**
 * Upload validation.
 *
 * File extensions and browser-reported MIME types are easy to fake, so we also check
 * the file's "magic bytes" (its first few bytes): PDFs start with "%PDF-", DOCX files
 * are ZIP archives starting with "PK\x03\x04", and text files must not contain NUL bytes.
 */
import { FILE_LIMITS } from "../config";
import type { SupportedFormat } from "../types";

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

export function formatFromName(fileName: string): SupportedFormat | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt") return "txt";
  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  for (const b of sample) if (b === 0) return false;
  return true;
}

/** Throws a user-friendly FileValidationError when the file is not acceptable. */
export function validateFile(fileName: string, bytes: Uint8Array): SupportedFormat {
  const format = formatFromName(fileName);
  if (!format) {
    throw new FileValidationError(`"${fileName}" is not supported. Upload PDF, DOCX, Markdown or TXT files.`);
  }
  if (bytes.byteLength === 0) throw new FileValidationError(`"${fileName}" is empty.`);
  if (bytes.byteLength > FILE_LIMITS.maxFileBytes) {
    const mb = (FILE_LIMITS.maxFileBytes / 1024 / 1024).toFixed(0);
    throw new FileValidationError(`"${fileName}" is larger than the ${mb} MB limit.`);
  }

  const ok =
    format === "pdf"
      ? startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
      : format === "docx"
        ? startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) // PK.. (zip)
        : looksLikeText(bytes);
  if (!ok) {
    throw new FileValidationError(`"${fileName}" does not look like a valid ${format.toUpperCase()} file.`);
  }
  return format;
}

/** Turns "alex_rivera-resume_2026.pdf" into "alex rivera-resume 2026". */
export function titleFromFileName(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[_]+/g, " ")
      .trim() || fileName
  );
}
