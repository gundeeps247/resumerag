"use client";

/**
 * User settings, persisted in localStorage and shared across components with
 * `useSyncExternalStore` (no state-management library needed).
 */
import { useSyncExternalStore } from "react";
import type { LlmConnection } from "@/lib/llm/client";
import { DEFAULT_CHUNKING, DEFAULT_RETRIEVAL } from "@/lib/rag/config";
import { DEFAULT_EMBEDDING_MODEL_ID } from "@/lib/rag/embeddings/models";
import type { ChunkingOptions, RetrievalOptions } from "@/lib/rag/types";

export interface AppSettings {
  retrieval: RetrievalOptions;
  chunking: ChunkingOptions;
  embeddingModelId: string;
  device: "wasm" | "webgpu";
  llm: LlmConnection;
  temperature: number;
  /** Refuse to generate when retrieval confidence is "none" (recommended). */
  strictGrounding: boolean;
  /** Show engineering metrics (latency, tokens, scores) under answers. */
  developerMode: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  retrieval: DEFAULT_RETRIEVAL,
  chunking: DEFAULT_CHUNKING,
  embeddingModelId: DEFAULT_EMBEDDING_MODEL_ID,
  device: "wasm",
  llm: { mode: "server", ollamaUrl: "http://localhost:11434" },
  temperature: 0.2,
  strictGrounding: true,
  developerMode: false,
};

const STORAGE_KEY = "resumerag.settings.v1";
const listeners = new Set<() => void>();
let current: AppSettings | null = null;

function load(): AppSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      retrieval: { ...DEFAULT_SETTINGS.retrieval, ...saved.retrieval },
      chunking: { ...DEFAULT_SETTINGS.chunking, ...saved.chunking },
      llm: { ...DEFAULT_SETTINGS.llm, ...saved.llm },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function getSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  current ??= load();
  return current;
}

export function updateSettings(update: (s: AppSettings) => AppSettings) {
  current = update(getSettings());
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // storage full or disabled — settings still apply for this session
  }
  for (const listener of listeners) listener();
}

export function resetSettings() {
  updateSettings(() => DEFAULT_SETTINGS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      current = load();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
}
