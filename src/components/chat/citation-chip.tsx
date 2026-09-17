"use client";

import { DocTypeBadge } from "@/components/common/doc-type";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { truncate } from "@/lib/format";
import { formatLocation } from "@/lib/rag/generation/context";
import type { RetrievedChunk } from "@/lib/rag/types";

interface CitationChipProps {
  n: number | null;
  source?: RetrievedChunk;
  onClick?: () => void;
}

/** Inline [n] marker. Hover previews the passage; click opens it in the evidence panel. */
export function CitationChip({ n, source, onClick }: CitationChipProps) {
  if (!n || !source) {
    return (
      <span
        title="This citation does not match any retrieved source"
        className="bg-destructive/10 text-destructive ring-destructive/25 mx-0.5 inline-flex h-[18px] items-center rounded-md px-1 align-[1px] text-[10.5px] font-semibold ring-1"
      >
        ?
      </span>
    );
  }
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-citation
          onClick={onClick}
          aria-label={`Source ${n}: ${source.document.name}`}
          className="bg-brand/10 text-brand ring-brand/30 hover:bg-brand/20 mx-0.5 inline-flex h-[18px] min-w-[18px] cursor-pointer items-center justify-center rounded-md px-1 align-[1px] text-[10.5px] font-semibold tabular-nums ring-1 transition-colors ring-inset"
        >
          {n}
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 space-y-2 p-3" side="top">
        <div className="flex items-center gap-2">
          <span className="bg-brand/15 text-brand grid size-5 place-items-center rounded text-[10px] font-semibold">{n}</span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{source.document.name}</span>
          <DocTypeBadge type={source.document.docType} />
        </div>
        {formatLocation(source.chunk) && <p className="text-muted-foreground text-[11px]">{formatLocation(source.chunk)}</p>}
        <p className="text-muted-foreground text-xs leading-relaxed">{truncate(source.chunk.text, 320)}</p>
      </HoverCardContent>
    </HoverCard>
  );
}
