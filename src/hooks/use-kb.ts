"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/schema";
import type { KbDocument } from "@/lib/rag/types";

/** All documents, newest first. `undefined` while loading. */
export function useDocuments(): KbDocument[] | undefined {
  return useLiveQuery(() => getDb().documents.orderBy("createdAt").reverse().toArray(), []);
}

export interface KbStats {
  documents: number;
  ready: number;
  processing: number;
  failed: number;
  chunks: number;
  byType: Record<string, number>;
}

export function useKbStats(): KbStats | undefined {
  return useLiveQuery(async () => {
    const db = getDb();
    const docs = await db.documents.toArray();
    const byType: Record<string, number> = {};
    for (const d of docs) if (d.status === "ready") byType[d.docType] = (byType[d.docType] ?? 0) + 1;
    return {
      documents: docs.length,
      ready: docs.filter((d) => d.status === "ready").length,
      processing: docs.filter((d) => !["ready", "error"].includes(d.status)).length,
      failed: docs.filter((d) => d.status === "error").length,
      chunks: docs.filter((d) => d.status === "ready").reduce((n, d) => n + d.chunkCount, 0),
      byType,
    };
  }, []);
}

export function useDocumentDetail(docId: string | null) {
  return useLiveQuery(async () => {
    if (!docId) return null;
    const db = getDb();
    const [doc, content, chunks] = await Promise.all([
      db.documents.get(docId),
      db.contents.get(docId),
      db.chunks.where("docId").equals(docId).toArray(),
    ]);
    if (!doc) return null;
    return {
      doc,
      content,
      chunks: chunks.sort((a, b) => a.index - b.index).map(({ vector, ...rest }) => ({ ...rest, dims: vector.length })),
    };
  }, [docId]);
}
