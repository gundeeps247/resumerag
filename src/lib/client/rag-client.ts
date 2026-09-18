"use client";

/**
 * Main-thread handle to the RAG Web Worker.
 *
 * `getRag()` returns a Comlink proxy: calling `rag.search(...)` sends a message to the
 * worker and resolves with its answer, so UI code reads like ordinary async calls.
 */
import * as Comlink from "comlink";
import type { ModelLoadProgress } from "@/lib/rag/embeddings/embedder";
import type { RagEngine } from "@/workers/rag.worker";

let remote: Comlink.Remote<RagEngine> | null = null;
const progressListeners = new Set<(p: ModelLoadProgress) => void>();

export function getRag(): Comlink.Remote<RagEngine> {
  if (typeof window === "undefined") throw new Error("The RAG engine only runs in the browser.");
  if (!remote) {
    const worker = new Worker(new URL("../../workers/rag.worker.ts", import.meta.url), { type: "module", name: "rag-engine" });
    remote = Comlink.wrap<RagEngine>(worker);
    void remote.onModelProgress(Comlink.proxy(notifyModelProgress));
  }
  return remote;
}

/** Publishes a download / load progress event (from the RAG worker or the in-browser LLM worker). */
export function notifyModelProgress(progress: ModelLoadProgress) {
  for (const listener of progressListeners) listener(progress);
}

/** Subscribes to model download / load progress events coming from the workers. */
export function onModelProgress(listener: (p: ModelLoadProgress) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}
