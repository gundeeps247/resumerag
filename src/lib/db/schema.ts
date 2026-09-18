/**
 * Local database (IndexedDB via Dexie).
 *
 * Everything the user uploads — documents, parsed text, chunks and their vectors — is
 * stored in the browser, on the user's device. Nothing is uploaded to a server.
 * Dexie's live queries let the UI update automatically while the Web Worker writes
 * ingestion progress into the same database.
 */
import Dexie, { type EntityTable } from "dexie";
import type { KbDocument, StoredChunk, TextBlock } from "@/lib/rag/types";
import type { AnswerRecordTrace } from "./records";
import type { MockSessionRecord, SavedAnalysis, SavedQuestion } from "./records";

export interface DocumentContent {
  docId: string;
  title: string;
  blocks: TextBlock[];
  pageCount?: number;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Created while the demo workspace was loaded, so it is removed with it. */
  demo?: true;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  trace?: AnswerRecordTrace;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export class ResumeRagDB extends Dexie {
  documents!: EntityTable<KbDocument, "id">;
  contents!: EntityTable<DocumentContent, "docId">;
  chunks!: EntityTable<StoredChunk, "id">;
  conversations!: EntityTable<ConversationRecord, "id">;
  messages!: EntityTable<MessageRecord, "id">;
  mockSessions!: EntityTable<MockSessionRecord, "id">;
  questions!: EntityTable<SavedQuestion, "id">;
  analyses!: EntityTable<SavedAnalysis, "id">;
  meta!: EntityTable<MetaRecord, "key">;

  constructor() {
    super("resumerag");
    this.version(1).stores({
      documents: "id, hash, docType, status, createdAt",
      contents: "docId",
      chunks: "id, docId",
      conversations: "id, updatedAt",
      messages: "id, conversationId, createdAt",
      mockSessions: "id, createdAt, status",
      questions: "id, category, status, createdAt",
      analyses: "id, kind, createdAt",
      meta: "key",
    });
  }
}

let instance: ResumeRagDB | undefined;

/** Lazily creates the database (IndexedDB only exists in the browser / worker). */
export function getDb(): ResumeRagDB {
  instance ??= new ResumeRagDB();
  return instance;
}

export const KB_VERSION_KEY = "kbVersion";

/** Bumped after every change to documents/chunks so search indexes know to rebuild. */
export async function bumpKbVersion(db: ResumeRagDB = getDb()): Promise<number> {
  const current = ((await db.meta.get(KB_VERSION_KEY))?.value as number | undefined) ?? 0;
  await db.meta.put({ key: KB_VERSION_KEY, value: current + 1 });
  return current + 1;
}

export async function getKbVersion(db: ResumeRagDB = getDb()): Promise<number> {
  return ((await db.meta.get(KB_VERSION_KEY))?.value as number | undefined) ?? 0;
}
