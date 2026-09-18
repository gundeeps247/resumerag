"use client";

/**
 * Knowledge-base operations called by the UI: upload, paste, demo workspace, delete,
 * re-index and change document type. Heavy work (parsing, embedding) is delegated to
 * the Web Worker; this module handles validation, de-duplication and bookkeeping.
 */
import * as Comlink from "comlink";
import { bumpKbVersion, getDb } from "@/lib/db/schema";
import { DEMO_DOCUMENTS } from "@/lib/demo";
import { FILE_LIMITS } from "@/lib/rag/config";
import { FileValidationError, formatFromName, validateFile } from "@/lib/rag/parsing/validate";
import type { DocType, KbDocument, SupportedFormat } from "@/lib/rag/types";
import { ensureDemoReconciled, startDemoSession } from "./demo-session";
import { getRag } from "./rag-client";
import type { AppSettings } from "./settings";

export interface AddResult {
  added: string[];
  skipped: { name: string; reason: string }[];
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newDocument(partial: Pick<KbDocument, "name" | "format" | "size" | "hash" | "source"> & { docType?: DocType }): KbDocument {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    docType: partial.docType ?? "other",
    status: "queued",
    progress: 0,
    warnings: [],
    charCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

async function findDuplicate(hash: string): Promise<KbDocument | undefined> {
  return getDb().documents.where("hash").equals(hash).first();
}

/** Validates, de-duplicates and queues files for ingestion. Returns immediately after queuing. */
export async function addFiles(
  files: { name: string; bytes: Uint8Array; docType?: DocType; source?: KbDocument["source"] }[],
  settings: AppSettings,
): Promise<AddResult> {
  const result: AddResult = { added: [], skipped: [] };
  if (files.length > FILE_LIMITS.maxFilesPerUpload) {
    result.skipped.push({
      name: `${files.length - FILE_LIMITS.maxFilesPerUpload} file(s)`,
      reason: `At most ${FILE_LIMITS.maxFilesPerUpload} files per upload.`,
    });
    files = files.slice(0, FILE_LIMITS.maxFilesPerUpload);
  }

  const rag = getRag();
  for (const file of files) {
    let format: SupportedFormat;
    try {
      format = validateFile(file.name, file.bytes);
    } catch (error) {
      result.skipped.push({ name: file.name, reason: error instanceof FileValidationError ? error.message : "Invalid file." });
      continue;
    }
    const hash = await sha256Hex(file.bytes);
    const duplicate = await findDuplicate(hash);
    if (duplicate) {
      result.skipped.push({ name: file.name, reason: `Already in your knowledge base as "${duplicate.name}".` });
      continue;
    }

    const doc = newDocument({
      name: file.name,
      format,
      size: file.bytes.byteLength,
      hash,
      source: file.source ?? "upload",
      docType: file.docType,
    });
    await getDb().documents.add(doc);
    result.added.push(doc.id);

    const bytes = file.bytes.slice(); // copy, because the buffer is transferred to the worker
    void rag
      .ingest(
        Comlink.transfer(
          { docId: doc.id, source: { kind: "file", fileName: file.name, bytes }, chunking: settings.chunking, docTypeHint: file.docType },
          [bytes.buffer as ArrayBuffer],
        ),
      )
      .catch(() => undefined); // errors are written to the document record by the worker
  }
  return result;
}

export async function addBrowserFiles(files: File[], settings: AppSettings): Promise<AddResult> {
  const prepared = [];
  const skipped: AddResult["skipped"] = [];
  for (const file of files) {
    if (!formatFromName(file.name)) {
      skipped.push({ name: file.name, reason: "Unsupported file type. Use PDF, DOCX, Markdown or TXT." });
      continue;
    }
    if (file.size > FILE_LIMITS.maxFileBytes) {
      skipped.push({ name: file.name, reason: `Larger than the ${FILE_LIMITS.maxFileBytes / 1024 / 1024} MB limit.` });
      continue;
    }
    prepared.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  const result = await addFiles(prepared, settings);
  return { added: result.added, skipped: [...skipped, ...result.skipped] };
}

/** Adds pasted text (typically a job description) as a document. */
export async function addPastedText(title: string, text: string, docType: DocType, settings: AppSettings): Promise<AddResult> {
  const trimmed = text.trim();
  if (trimmed.length < 40) return { added: [], skipped: [{ name: title, reason: "Please paste at least a few sentences." }] };
  if (trimmed.length > FILE_LIMITS.maxPasteChars) {
    return {
      added: [],
      skipped: [{ name: title, reason: `Pasted text is limited to ${FILE_LIMITS.maxPasteChars.toLocaleString()} characters.` }],
    };
  }
  const hash = await sha256Hex(trimmed);
  const duplicate = await findDuplicate(hash);
  if (duplicate) return { added: [], skipped: [{ name: title, reason: `Already added as "${duplicate.name}".` }] };

  const name = title.trim() || "Pasted text";
  const doc = newDocument({ name, format: "txt", size: trimmed.length, hash, source: "paste", docType });
  await getDb().documents.add({ ...doc, docTypeLocked: true });
  void getRag()
    .ingest({ docId: doc.id, source: { kind: "text", title: name, text: trimmed }, chunking: settings.chunking, docTypeHint: docType })
    .catch(() => undefined);
  return { added: [doc.id], skipped: [] };
}

/** Loads the fictional "Alex Rivera" demo documents. */
export async function loadDemoWorkspace(settings: AppSettings): Promise<AddResult> {
  // A demo left by a previous visit is cleared first, so these documents are not skipped as
  // duplicates and then deleted by the startup cleanup.
  await ensureDemoReconciled();
  const files = await Promise.all(
    DEMO_DOCUMENTS.map(async (demo) => {
      const response = await fetch(`/demo/${demo.file}`);
      if (!response.ok) throw new Error(`Could not load demo file ${demo.file}`);
      return { name: demo.file, bytes: new Uint8Array(await response.arrayBuffer()), docType: demo.docType, source: "demo" as const };
    }),
  );
  const result = await addFiles(files, settings);
  // From here on, anything the visitor creates is demo material too.
  startDemoSession();
  return result;
}

export async function deleteDocument(docId: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.documents, db.contents, db.chunks, db.meta, async () => {
    await db.chunks.where("docId").equals(docId).delete();
    await db.contents.delete(docId);
    await db.documents.delete(docId);
    await bumpKbVersion(db);
  });
}

export async function clearKnowledgeBase(): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.documents, db.contents, db.chunks, db.meta], async () => {
    await Promise.all([db.documents.clear(), db.contents.clear(), db.chunks.clear()]);
    await bumpKbVersion(db);
  });
}

/** Deletes every locally stored record: documents, chats, sessions, analyses. */
export async function deleteAllData(): Promise<void> {
  const db = getDb();
  await Promise.all(db.tables.map((t) => t.clear()));
  await bumpKbVersion(db);
}

export async function setDocumentType(docId: string, docType: DocType): Promise<void> {
  const db = getDb();
  await db.documents.update(docId, { docType, docTypeLocked: true, updatedAt: Date.now() });
  await bumpKbVersion(db);
}

/**
 * Re-chunks and re-embeds documents using the current settings (keeps the parsed text).
 * Returns how many documents were queued; documents that never parsed cannot be re-indexed.
 */
export async function reindexDocuments(docIds: string[], settings: AppSettings): Promise<number> {
  const db = getDb();
  const withContent = (await db.contents.bulkGet(docIds)).filter(Boolean).map((c) => c!.docId);
  if (!withContent.length) return 0;
  await Promise.all(withContent.map((id) => db.documents.update(id, { status: "queued", progress: 0, error: undefined })));
  void getRag()
    .reindex(withContent, settings.chunking)
    .catch(() => undefined);
  return withContent.length;
}
