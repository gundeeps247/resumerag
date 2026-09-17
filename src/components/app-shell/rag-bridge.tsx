"use client";

import { useEffect } from "react";
import { getRag } from "@/lib/client/rag-client";
import { useSettings } from "@/lib/client/settings";
import { useKbStats } from "@/hooks/use-kb";

/**
 * Keeps the Web Worker in sync with user settings and pre-loads the models in the
 * background once the knowledge base has documents, so the first question is fast.
 */
export function RagBridge() {
  const { embeddingModelId, device, retrieval } = useSettings();
  const stats = useKbStats();
  const hasDocs = (stats?.ready ?? 0) > 0;

  useEffect(() => {
    void getRag().configure({ embeddingModelId, device });
  }, [embeddingModelId, device]);

  useEffect(() => {
    if (!hasDocs) return;
    const idle = window.setTimeout(() => {
      void getRag()
        .warmup({ reranker: retrieval.rerank })
        .catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(idle);
  }, [hasDocs, retrieval.rerank, embeddingModelId]);

  return null;
}
