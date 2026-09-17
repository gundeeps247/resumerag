"use client";

import { ChevronDown } from "lucide-react";
import { CitationChip } from "@/components/chat/citation-chip";
import { SourceCard } from "@/components/chat/source-card";
import { Markdown } from "@/components/common/markdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { linkCitations } from "@/lib/rag/generation/citations";
import type { BuiltContext } from "@/lib/rag/generation/context";
import type { RetrievedChunk } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

/** Markdown text whose [n] markers become interactive citation chips. */
export function CitedText({ text, sources, className }: { text: string; sources: RetrievedChunk[]; className?: string }) {
  return (
    <Markdown className={className} renderCitation={(n) => <CitationChip n={n} source={n ? sources[n - 1] : undefined} />}>
      {linkCitations(text, sources.length)}
    </Markdown>
  );
}

/** A row of citation chips for a list of source numbers. */
export function SourceChips({ nums, sources, className }: { nums: number[]; sources: RetrievedChunk[]; className?: string }) {
  if (!nums.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-0.5", className)}>
      {nums.map((n) => (
        <CitationChip key={n} n={n} source={sources[n - 1]} />
      ))}
    </span>
  );
}

/** Collapsible list of the passages a result was built from. */
export function EvidenceDisclosure({
  context,
  title = "Evidence used",
  defaultOpen = false,
}: {
  context: BuiltContext;
  title?: string;
  defaultOpen?: boolean;
}) {
  if (!context.sources.length) return null;
  return (
    <Collapsible defaultOpen={defaultOpen} className="bg-card rounded-xl border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-sm font-medium">
        <span>
          {title} <span className="text-muted-foreground font-normal">· {context.sources.length} passages from your documents</span>
        </span>
        <ChevronDown className="text-muted-foreground size-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-3 border-t p-3 md:grid-cols-2">
          {context.sources.map((s) => (
            <SourceCard key={s.result.chunk.id} n={s.n} source={s.result} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
