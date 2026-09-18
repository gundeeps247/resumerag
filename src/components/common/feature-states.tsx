"use client";

import Link from "next/link";
import { Download, FileStack, Loader2, TriangleAlert } from "lucide-react";
import { LoadDemoButton } from "@/components/documents/demo-button";
import { Button } from "@/components/ui/button";
import { useKbStats } from "@/hooks/use-kb";
import { useLlmStatus } from "@/hooks/use-llm-status";
import { useModelProgress } from "@/hooks/use-model-progress";

/** Renders children only when the knowledge base has at least one indexed document. */
export function RequireDocuments({ children, what = "this feature" }: { children: React.ReactNode; what?: string }) {
  const stats = useKbStats();
  if (stats === undefined) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-16 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading your knowledge base…
      </div>
    );
  }
  if (stats.ready === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center">
        <div className="bg-muted grid size-11 place-items-center rounded-xl">
          <FileStack className="text-muted-foreground size-5" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">Add documents to use {what}</p>
          <p className="text-muted-foreground max-w-md text-sm">
            {stats.processing > 0
              ? `${stats.processing} document(s) are still being indexed…`
              : "Everything here is grounded in your own documents. Upload a resume and a project report, or try the fictional demo."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/documents">Upload documents</Link>
          </Button>
          <LoadDemoButton variant="default" />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/** Explains that results are template/heuristic-based when no LLM is reachable. */
export function LlmFallbackNotice({ feature }: { feature: string }) {
  const { status } = useLlmStatus();
  if (!status || status.available) return null;
  return (
    <div className="border-warning/30 bg-warning/5 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
      <TriangleAlert className="text-warning mt-0.5 size-3.5 shrink-0" />
      <span>
        No language model connected. {feature} will use deterministic analysis and templates only.{" "}
        <Link href="/settings#model" className="font-medium underline underline-offset-2">
          Choose a model
        </Link>{" "}
        for full results.
      </span>
    </div>
  );
}

export function GeneratingNote({ label, chars }: { label: string; chars?: number }) {
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="text-brand size-4 animate-spin" />
        <span>
          {label}
          {chars ? <span className="tabular-nums"> · {chars.toLocaleString()} characters generated</span> : null}
        </span>
      </div>
      <ModelDownloadNote />
    </div>
  );
}

/**
 * Shown while the in-browser model downloads. Without it the app looks stuck on the first
 * question: nothing can be generated until several hundred MB of weights have arrived.
 */
export function ModelDownloadNote() {
  const progress = useModelProgress();
  if (!progress?.active || !progress.totalMb) return null;
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <Download className="text-brand size-3.5 animate-pulse" />
      <span className="tabular-nums">
        Downloading the language model to your browser — {progress.loadedMb.toFixed(0)} / {progress.totalMb.toFixed(0)} MB (
        {Math.round(progress.percent)}%). One time only, then it is cached.
      </span>
    </div>
  );
}
