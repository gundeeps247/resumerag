"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchLlmStatus, type LlmStatus } from "@/lib/llm/client";
import { useSettings } from "@/lib/client/settings";

export interface LlmStatusState {
  status: LlmStatus | null;
  loading: boolean;
  refresh: () => void;
}

const POLL_MS = 30_000;

/** Polls the configured LLM provider so the UI can show "connected" vs "evidence-only". */
export function useLlmStatus(): LlmStatusState {
  const { llm } = useSettings();
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setLoading(true);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLlmStatus(llm)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setStatus({
          provider: llm.mode === "browser-ollama" ? "ollama" : "none",
          label: "Unavailable",
          model: llm.model ?? "",
          available: false,
          models: [],
          error: error.message,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Background polling does not flip the loading flag, so the UI does not flicker.
    const timer = window.setTimeout(() => setTick((t) => t + 1), POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [llm, tick]);

  return { status, loading, refresh };
}
