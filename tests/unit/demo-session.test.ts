/**
 * The demo workspace must disappear when the visitor closes the site — and must never take the
 * visitor's own documents or work with it. These tests run against a real IndexedDB
 * implementation (fake-indexeddb) so the deletions are exercised, not mocked.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { hasDemoDocuments, isDemoStale, removeDemoWorkspace, STALE_AFTER_MS } from "@/lib/client/demo-session";
import { failInterruptedIngestion } from "@/lib/client/documents";
import { getDb } from "@/lib/db/schema";
import type { KbDocument } from "@/lib/rag/types";

function doc(id: string, source: KbDocument["source"]): KbDocument {
  return {
    id,
    name: `${id}.pdf`,
    docType: "resume",
    format: "pdf",
    size: 100,
    hash: id,
    source,
    status: "ready",
    progress: 100,
    warnings: [],
    charCount: 10,
    chunkCount: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function seed() {
  const db = getDb();
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.documents.bulkAdd([doc("demo1", "demo"), doc("demo2", "demo"), doc("mine", "upload")]);
  await db.contents.bulkAdd([
    { docId: "demo1", title: "demo1", blocks: [], pageCount: 1 },
    { docId: "mine", title: "mine", blocks: [], pageCount: 1 },
  ]);
  const chunk = (id: string, docId: string) => ({
    id,
    docId,
    index: 0,
    text: "text",
    embedText: "text",
    headingPath: [],
    tokenCount: 1,
    vector: new Float32Array([1]),
  });
  await db.chunks.bulkAdd([chunk("demo1:0", "demo1"), chunk("mine:0", "mine")]);
  // Two of each record: one made while exploring the demo, one the visitor's own.
  await db.conversations.bulkAdd([
    { id: "c-demo", title: "demo chat", createdAt: 1, updatedAt: 1, demo: true },
    { id: "c-mine", title: "my chat", createdAt: 1, updatedAt: 1 },
  ]);
  await db.messages.bulkAdd([
    { id: "m1", conversationId: "c-demo", role: "user", content: "x", createdAt: 1 },
    { id: "m2", conversationId: "c-mine", role: "user", content: "y", createdAt: 1 },
  ]);
  await db.mockSessions.bulkAdd([
    { id: "s-demo", title: "demo", focus: "{}", status: "completed", createdAt: 1, updatedAt: 1, turns: [], demo: true },
    { id: "s-mine", title: "mine", focus: "{}", status: "completed", createdAt: 1, updatedAt: 1, turns: [] },
  ]);
  await db.questions.bulkAdd([
    {
      id: "q-demo",
      question: "a",
      category: "technical",
      difficulty: "medium",
      sourceChunkIds: [],
      status: "new",
      origin: "t",
      createdAt: 1,
      demo: true,
    },
    {
      id: "q-mine",
      question: "b",
      category: "technical",
      difficulty: "medium",
      sourceChunkIds: [],
      status: "new",
      origin: "t",
      createdAt: 1,
    },
  ]);
  await db.analyses.bulkAdd([
    { id: "a-demo", kind: "resume-xray", title: "demo", createdAt: 1, kbVersion: 1, result: {}, demo: true },
    { id: "a-mine", kind: "resume-xray", title: "mine", createdAt: 1, kbVersion: 1, result: {} },
  ]);
}

describe("demo workspace lifecycle", () => {
  beforeEach(seed);

  it("removes the demo documents, their text and their vectors", async () => {
    const db = getDb();
    expect(await hasDemoDocuments()).toBe(true);

    expect(await removeDemoWorkspace()).toBe(2);

    expect(await hasDemoDocuments()).toBe(false);
    expect((await db.documents.toArray()).map((d) => d.id)).toEqual(["mine"]);
    expect((await db.contents.toArray()).map((c) => c.docId)).toEqual(["mine"]);
    expect((await db.chunks.toArray()).map((c) => c.id)).toEqual(["mine:0"]);
  });

  it("removes what the demo generated and keeps the visitor's own work", async () => {
    const db = getDb();
    await removeDemoWorkspace();

    expect((await db.conversations.toArray()).map((c) => c.id)).toEqual(["c-mine"]);
    expect((await db.messages.toArray()).map((m) => m.id)).toEqual(["m2"]);
    expect((await db.mockSessions.toArray()).map((s) => s.id)).toEqual(["s-mine"]);
    expect((await db.questions.toArray()).map((q) => q.id)).toEqual(["q-mine"]);
    expect((await db.analyses.toArray()).map((a) => a.id)).toEqual(["a-mine"]);
  });

  it("bumps the knowledge-base version so the worker rebuilds its index", async () => {
    const before = (await getDb().meta.get("kbVersion"))?.value ?? 0;
    await removeDemoWorkspace();
    const after = (await getDb().meta.get("kbVersion"))?.value ?? 0;
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  it("does nothing when there is no demo to remove", async () => {
    const db = getDb();
    await db.documents.filter((d) => d.source === "demo").delete();
    expect(await removeDemoWorkspace()).toBe(0);
    expect((await db.documents.toArray()).map((d) => d.id)).toEqual(["mine"]);
  });
});

describe("detecting that the site was closed", () => {
  it("treats a missing or old heartbeat as closed, and a recent one as still open", () => {
    const now = 1_000_000;
    expect(isDemoStale(null, now)).toBe(true);
    expect(isDemoStale(now - STALE_AFTER_MS - 1, now)).toBe(true);
    // A tab that refreshed the heartbeat seconds ago is still open: keep its demo.
    expect(isDemoStale(now - 5_000, now)).toBe(false);
    expect(isDemoStale(now, now)).toBe(false);
  });
});

describe("indexing interrupted by a page reload", () => {
  /** Ingestion runs in the page's worker, so a reload abandons whatever was still in flight. */
  it("marks documents left mid-indexing as failed, so the row offers Retry again", async () => {
    const db = getDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.documents.bulkAdd([
      { ...doc("queued", "upload"), status: "queued", progress: 0 },
      { ...doc("parsing", "upload"), status: "parsing", progress: 10 },
      { ...doc("embedding", "demo"), status: "embedding", progress: 60 },
      { ...doc("done", "upload"), status: "ready" },
      { ...doc("failed", "upload"), status: "error", error: "Unsupported file." },
    ]);

    expect(await failInterruptedIngestion()).toBe(3);

    const byId = new Map((await db.documents.toArray()).map((d) => [d.id, d]));
    for (const id of ["queued", "parsing", "embedding"]) {
      expect(byId.get(id)?.status).toBe("error");
    }
    // An upload interrupted before its text was stored cannot be retried: the original file is
    // never kept, so the message must ask for the file rather than promise a retry.
    expect(byId.get("queued")?.error).toMatch(/add the file again/i);
    expect(byId.get("parsing")?.error).toMatch(/add the file again/i);
    // A demo file ships with the app, so it can always be fetched again.
    expect(byId.get("embedding")?.error).toMatch(/retry to finish it/i);
    // Finished and already-failed documents are left exactly as they were.
    expect(byId.get("done")?.status).toBe("ready");
    expect(byId.get("failed")?.error).toBe("Unsupported file.");
  });

  it("offers a retry for an upload whose text was already stored", async () => {
    const db = getDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.documents.add({ ...doc("half", "upload"), status: "embedding", progress: 70 });
    await db.contents.add({ docId: "half", title: "half", blocks: [], pageCount: 1 });

    await failInterruptedIngestion();

    expect((await db.documents.get("half"))?.error).toMatch(/retry to finish it/i);
  });

  it("does nothing when every document is settled", async () => {
    const db = getDb();
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.documents.add({ ...doc("done", "upload"), status: "ready" });
    expect(await failInterruptedIngestion()).toBe(0);
    expect((await db.documents.get("done"))?.status).toBe("ready");
  });
});
