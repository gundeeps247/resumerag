"use client";

import { CircleCheck, CircleDashed, FileText, Loader2, TriangleAlert, Workflow } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { ConfidenceBadge } from "@/components/common/confidence-badge";
import { Markdown } from "@/components/common/markdown";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AnswerRecordTrace } from "@/lib/db/records";
import { formatMs } from "@/lib/format";
import { linkCitations } from "@/lib/rag/generation/citations";
import type { AskStage } from "@/lib/workflows/ask";
import { cn } from "@/lib/utils";
import type { EvidenceTab } from "./evidence-panel";
import { CitationChip } from "./citation-chip";

const STAGE_TEXT: Record<AskStage, string> = {
  rewriting: "Understanding your follow-up…",
  retrieving: "Searching your documents…",
  generating: "Writing a grounded answer…",
  verifying: "Checking citations…",
};

interface AssistantMessageProps {
  content: string;
  trace?: AnswerRecordTrace;
  stage?: AskStage;
  active?: boolean;
  developerMode?: boolean;
  onOpenEvidence?: (tab: EvidenceTab, source?: number) => void;
}

export function AssistantMessage({ content, trace, stage, active, developerMode, onOpenEvidence }: AssistantMessageProps) {
  const results = trace?.retrieval.results ?? [];
  const sourceCount = trace?.prompt?.sourceCount ?? results.length;
  const verification = trace?.verification;
  const supported = verification?.checks.filter((c) => c.supported).length ?? 0;

  return (
    <div className={cn("group flex gap-3", active && "")}>
      <LogoMark className="mt-0.5 size-7 rounded-md [&_svg]:size-4" />
      <div className="min-w-0 flex-1 space-y-3">
        {trace?.mode === "evidence-only" && (
          <p className="text-warning flex items-center gap-1.5 text-xs">
            <TriangleAlert className="size-3.5" /> Evidence-only mode — no language model was reachable.
          </p>
        )}

        {content ? (
          <Markdown
            renderCitation={(n) => (
              <CitationChip
                n={n}
                source={n && n <= sourceCount ? results[n - 1] : undefined}
                onClick={() => n && onOpenEvidence?.("sources", n)}
              />
            )}
          >
            {linkCitations(content, sourceCount)}
          </Markdown>
        ) : null}

        {stage && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="text-brand size-4 animate-spin" />
            {STAGE_TEXT[stage]}
          </p>
        )}

        {trace && !stage && (
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge confidence={trace.retrieval.confidence} />
            {verification && verification.checks.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "inline-flex h-6 cursor-default items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset",
                      supported === verification.checks.length && verification.invalidCitations.length === 0
                        ? "bg-success/10 text-success ring-success/25"
                        : "bg-warning/10 text-warning ring-warning/30",
                    )}
                  >
                    {supported === verification.checks.length ? (
                      <CircleCheck className="size-3.5" />
                    ) : (
                      <CircleDashed className="size-3.5" />
                    )}
                    {supported}/{verification.checks.length} verified
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Each sentence is compared (with embeddings) against the passages it cites. Unverified sentences may paraphrase loosely or
                  lack support — check them in the Pipeline tab.
                </TooltipContent>
              </Tooltip>
            )}
            <Button variant="outline" size="xs" onClick={() => onOpenEvidence?.("sources")}>
              <FileText /> {results.length} sources
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onOpenEvidence?.("pipeline")}>
              <Workflow /> How this answer was generated
            </Button>
            {developerMode && (
              <span className="text-muted-foreground text-[11px] tabular-nums">
                retrieval {formatMs(trace.retrieval.timings.totalMs)}
                {trace.generation && ` · generation ${formatMs(trace.generation.durationMs)}`}
                {trace.prompt && ` · ${trace.prompt.contextTokens} ctx tokens`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
