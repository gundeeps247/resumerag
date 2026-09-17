"use client";

import { useEffect, useState } from "react";
import { onModelProgress } from "@/lib/client/rag-client";

export interface ModelDownloadState {
  active: boolean;
  model: string;
  /** 0–100 across all files currently downloading. */
  percent: number;
  loadedMb: number;
  totalMb: number;
}

/** Aggregates Transformers.js download events into one progress value for the UI. */
export function useModelProgress(): ModelDownloadState | null {
  const [state, setState] = useState<ModelDownloadState | null>(null);

  useEffect(() => {
    const files = new Map<string, { loaded: number; total: number }>();
    let hideTimer: number | undefined;
    const unsubscribe = onModelProgress((p) => {
      if (p.status === "progress" && p.file && p.total) {
        files.set(`${p.model}/${p.file}`, { loaded: p.loaded ?? 0, total: p.total });
        const loaded = [...files.values()].reduce((n, f) => n + f.loaded, 0);
        const total = [...files.values()].reduce((n, f) => n + f.total, 0);
        window.clearTimeout(hideTimer);
        setState({
          active: loaded < total,
          model: p.model,
          percent: total ? (loaded / total) * 100 : 0,
          loadedMb: loaded / 1024 / 1024,
          totalMb: total / 1024 / 1024,
        });
      } else if (p.status === "ready") {
        files.clear();
        setState((s) => (s ? { ...s, active: false, percent: 100 } : s));
        hideTimer = window.setTimeout(() => setState(null), 1500);
      }
    });
    return () => {
      unsubscribe();
      window.clearTimeout(hideTimer);
    };
  }, []);

  return state;
}
