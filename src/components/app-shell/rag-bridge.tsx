"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { ensureDemoReconciled } from "@/lib/client/demo-session";
import { getRag } from "@/lib/client/rag-client";
import { useSettings } from "@/lib/client/settings";
import { useKbStats } from "@/hooks/use-kb";

/**
 * Keeps the Web Worker in sync with user settings and pre-loads the models in the
 * background once the knowledge base has documents, so the first question is fast.
 *
 * Also settles the demo workspace on startup: a demo left by a previous visit is deleted, and
 * one belonging to this visit keeps its heartbeat (see lib/client/demo-session.ts).
 */
export function RagBridge() {
  const { embeddingModelId, device, retrieval } = useSettings();
  const stats = useKbStats();
  const hasDocs = (stats?.ready ?? 0) > 0;

  useEffect(() => {
    void getRag().configure({ embeddingModelId, device });
  }, [embeddingModelId, device]);

  useEffect(() => {
    void ensureDemoReconciled().then((outcome) => {
      if (outcome === "removed") {
        toast.info("Demo documents removed", {
          description: "The fictional demo workspace is cleared when you close the site. Load it again whenever you like.",
        });
      }
    });
  }, []);

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
