"use client";

/**
 * Main-thread handle to the in-browser language model (src/workers/llm.worker.ts).
 *
 * The worker is created on first use, so pages that never generate text never download
 * a model. Tokens arrive through a Comlink callback and are exposed as the same
 * `StreamEvent` stream the server and Ollama providers produce.
 */
import * as Comlink from "comlink";
import { notifyModelProgress } from "@/lib/client/rag-client";
import type { BrowserBackend, BrowserLlmEngine } from "@/workers/llm.worker";
import { browserModelWeightsUrl, getBrowserModel } from "./browser-models";
import { createAsyncQueue } from "./stream";
import type { ChatMessage, GenerateOptions, ProviderStatus, StreamEvent } from "./types";

let engine: Comlink.Remote<BrowserLlmEngine> | null = null;
/** Rejects when the worker crashes (e.g. the tab runs out of memory), so callers never hang. */
let crashed: Promise<never> | null = null;
let loaded: { id: string; backend: BrowserBackend } | null = null;

function getEngine(): { engine: Comlink.Remote<BrowserLlmEngine>; crashed: Promise<never> } {
  if (typeof window === "undefined") throw new Error("The in-browser model only runs in the browser.");
  if (!engine || !crashed) {
    const worker = new Worker(new URL("../../workers/llm.worker.ts", import.meta.url), { type: "module", name: "llm-engine" });
    const remote = Comlink.wrap<BrowserLlmEngine>(worker);
    void remote.onProgress(Comlink.proxy(notifyModelProgress));
    const crash = new Promise<never>((_, reject) => {
      worker.addEventListener("error", (event) => {
        engine = null;
        crashed = null;
        loaded = null;
        worker.terminate();
        reject(
          new Error(
            `The in-browser model stopped (${event.message || "the browser ran out of memory"}). Try again or use a smaller model.`,
          ),
        );
      });
    });
    crash.catch(() => undefined);
    engine = remote;
    crashed = crash;
  }
  return { engine, crashed };
}

export function supportsInBrowserModel(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

export function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Downloads (first time) and loads the model. Aborting stops waiting; the download continues in the worker. */
export async function loadBrowserModel(id: string, signal?: AbortSignal): Promise<{ id: string; backend: BrowserBackend }> {
  if (loaded?.id === id) return loaded;
  const { engine, crashed } = getEngine();
  const aborted = new Promise<never>((_, reject) => {
    if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  aborted.catch(() => undefined);
  loaded = await Promise.race([engine.load(id), crashed, aborted]);
  return loaded;
}

export async function* streamInBrowser(id: string, messages: ChatMessage[], options: GenerateOptions = {}): AsyncGenerator<StreamEvent> {
  const { engine, crashed } = getEngine();
  const queue = createAsyncQueue<string>();
  const requestId = crypto.randomUUID();
  const onAbort = () => {
    void engine.cancel(requestId);
    queue.fail(new DOMException("Aborted", "AbortError"));
  };
  if (options.signal?.aborted) onAbort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const finished = Promise.race([
    engine.generate(
      requestId,
      id,
      { messages, maxTokens: options.maxTokens ?? 800, temperature: options.temperature ?? 0.2, json: Boolean(options.json) },
      Comlink.proxy((text: string) => queue.push(text)),
    ),
    crashed,
  ]);
  finished.then(
    () => queue.close(),
    (error) => queue.fail(error),
  );

  try {
    for await (const text of queue) yield { type: "delta", text };
    const stats = await finished;
    loaded = { id, backend: stats.backend };
    yield {
      type: "done",
      model: `${stats.model} (in browser, ${stats.backend === "webgpu" ? "WebGPU" : "CPU"})`,
      promptTokens: stats.promptTokens,
      completionTokens: stats.completionTokens,
      durationMs: Math.round(stats.durationMs),
    };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Whether the model's weights are already in the browser cache (so no download is needed). */
export async function isBrowserModelCached(id: string): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    return Boolean(await caches.match(browserModelWeightsUrl(id)));
  } catch {
    return false;
  }
}

export interface BrowserModelStatus extends ProviderStatus {
  inBrowser: { id: string; downloadMb: number; cached: boolean; loaded: boolean; backend: BrowserBackend | null; webgpu: boolean };
}

export async function browserModelStatus(id: string): Promise<BrowserModelStatus> {
  const info = getBrowserModel(id);
  const supported = supportsInBrowserModel();
  const cached = supported && (loaded?.id === info.id || (await isBrowserModelCached(info.id)));
  return {
    provider: "in-browser",
    label: "In-browser model",
    model: info.label,
    available: supported,
    models: [],
    error: supported ? undefined : "This browser cannot run the in-browser model (Web Workers and WebAssembly are required).",
    inBrowser: {
      id: info.id,
      downloadMb: info.downloadMb,
      cached,
      loaded: loaded?.id === info.id,
      backend: loaded?.id === info.id ? loaded.backend : null,
      webgpu: hasWebGpu(),
    },
  };
}
