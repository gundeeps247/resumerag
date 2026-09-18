"use client";

/**
 * The demo workspace is a trial, not the visitor's data: it is only created when someone asks
 * for it, and it is removed once they close the site.
 *
 * "Closed" is detected with a heartbeat rather than an unload handler. An unload handler cannot
 * reliably finish IndexedDB work, and a visitor may have several tabs open. So while any tab
 * holds demo data it refreshes a timestamp in localStorage; at startup, demo data whose
 * timestamp is missing or stale belonged to a previous visit and is deleted.
 *
 * Anything generated from the demo (chats, mock interviews, saved questions, analyses) is
 * tagged `demo: true` when it is created, so it is removed with the documents.
 */
import { bumpKbVersion, getDb } from "@/lib/db/schema";

const HEARTBEAT_KEY = "resumerag.demo.open";
const HEARTBEAT_MS = 10_000;
/** Generous, so a slow or backgrounded tab is never cleaned up underneath another tab. */
export const STALE_AFTER_MS = 60_000;

let timer: ReturnType<typeof setInterval> | undefined;
let active = false;

/** Whether this visit is currently exploring the demo (used to tag records as demo material). */
export function isDemoActive(): boolean {
  return active;
}

export function isDemoStale(lastSeen: number | null, now = Date.now()): boolean {
  return lastSeen === null || now - lastSeen > STALE_AFTER_MS;
}

function readHeartbeat(): number | null {
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeHeartbeat() {
  try {
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
  } catch {
    // private mode or disabled storage: the demo is then removed on the next visit
  }
}

function clearHeartbeat() {
  try {
    localStorage.removeItem(HEARTBEAT_KEY);
  } catch {
    // ignore
  }
}

function onVisibilityChange() {
  if (active && document.visibilityState === "visible") writeHeartbeat();
}

/** Marks the demo as live for this visit and keeps the heartbeat going. */
export function startDemoSession() {
  active = true;
  if (typeof window === "undefined") return;
  writeHeartbeat();
  timer ??= setInterval(writeHeartbeat, HEARTBEAT_MS);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function stopDemoSession() {
  active = false;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  if (typeof window !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
  clearHeartbeat();
}

export async function hasDemoDocuments(): Promise<boolean> {
  return (
    (await getDb()
      .documents.filter((d) => d.source === "demo")
      .count()) > 0
  );
}

/** Deletes the demo documents and everything generated from them. Returns how many documents went. */
export async function removeDemoWorkspace(): Promise<number> {
  const db = getDb();
  const removed = await db.transaction("rw", db.tables, async () => {
    const ids = (await db.documents.filter((d) => d.source === "demo").toArray()).map((d) => d.id);
    for (const id of ids) {
      await db.chunks.where("docId").equals(id).delete();
      await db.contents.delete(id);
    }
    await db.documents.bulkDelete(ids);

    const conversations = await db.conversations.filter((c) => c.demo === true).toArray();
    for (const conversation of conversations) await db.messages.where("conversationId").equals(conversation.id).delete();
    await db.conversations.bulkDelete(conversations.map((c) => c.id));
    await db.mockSessions.filter((s) => s.demo === true).delete();
    await db.questions.filter((q) => q.demo === true).delete();
    await db.analyses.filter((a) => a.demo === true).delete();

    if (ids.length) await bumpKbVersion(db);
    return ids.length;
  });
  stopDemoSession();
  return removed;
}

let reconciliation: Promise<"kept" | "removed" | "none"> | undefined;
let removedOnStartup = false;

/** Whether the startup reconciliation deleted a demo left by a previous visit. */
export function demoWasRemoved(): boolean {
  return removedOnStartup;
}

/**
 * Runs the startup reconciliation exactly once per page load, and lets anything that touches
 * the demo wait for it. Without this, arriving at /dashboard?demo=1 with a stale demo could
 * race: the loader would skip the documents as duplicates and the cleanup would then delete
 * them, leaving the visitor with nothing.
 */
export function ensureDemoReconciled(): Promise<"kept" | "removed" | "none"> {
  reconciliation ??= reconcileDemoWorkspace();
  return reconciliation;
}

/**
 * Run once at startup: continue this visit's demo, or clear what a previous visit left behind.
 */
export async function reconcileDemoWorkspace(): Promise<"kept" | "removed" | "none"> {
  if (!(await hasDemoDocuments())) {
    clearHeartbeat();
    return "none";
  }
  if (isDemoStale(readHeartbeat())) {
    await removeDemoWorkspace();
    removedOnStartup = true;
    return "removed";
  }
  startDemoSession();
  return "kept";
}
