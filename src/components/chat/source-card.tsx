"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, FileSearch } from "lucide-react";
import { DocTypeBadge } from "@/components/common/doc-type";
import { ScoreBar } from "@/components/common/score-bar";
import { Button } from "@/components/ui/button";
import { formatLocation } from "@/lib/rag/generation/context";
import type { RetrievedChunk } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

interface SourceCardProps {
  n: number;
  source: RetrievedChunk;
  highlighted?: boolean;
  onOpenDocument?: (docId: string, chunkId: string) => void;
}

export function SourceCard({ n, source, highlighted, onOpenDocument }: SourceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { candidate, chunk, document } = source;
  const reranked = candidate.rerankScore !== undefined;
  const score = reranked ? candidate.rerankScore! : (candidate.denseScore ?? 0);

  return (
    <div
      id={`source-${n}`}
      ref={(el) => {
        if (highlighted && el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }}
      className={cn("bg-card rounded-lg border p-3 transition-shadow", highlighted && "border-brand ring-brand/20 shadow-sm ring-2")}
    >
      <div className="flex items-start gap-2">
        <span className="bg-brand/15 text-brand mt-0.5 grid size-5 shrink-0 place-items-center rounded text-[10px] font-semibold">{n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-xs font-medium">{document.name}</p>
            <DocTypeBadge type={document.docType} />
          </div>
          {formatLocation(chunk) && <p className="text-muted-foreground truncate text-[11px]">{formatLocation(chunk)}</p>}
        </div>
      </div>

      {source.via === "skill-lookup" ? (
        <p className="text-muted-foreground mt-2 text-[11px]">Found by an exact mention of the skill</p>
      ) : (
        <div className="text-muted-foreground mt-2 flex items-center gap-2 text-[11px]">
          <span className="w-24 shrink-0">{reranked ? "Reranker" : "Similarity"}</span>
          <ScoreBar value={score} tone="auto" className="flex-1" />
          <span className="text-foreground w-9 text-right font-medium tabular-nums">{score.toFixed(2)}</span>
        </div>
      )}

      <p className={cn("text-foreground/90 mt-2 text-[0.8rem] leading-relaxed whitespace-pre-wrap", !expanded && "line-clamp-5")}>
        {chunk.text}
      </p>

      {chunk.suspicious && (
        <p className="text-destructive mt-2 flex items-center gap-1.5 text-[11px]">
          <AlertTriangle className="size-3" /> Contains instruction-like text — treated strictly as data.
        </p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <Button variant="ghost" size="xs" onClick={() => setExpanded((e) => !e)}>
          <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} /> {expanded ? "Less" : "Full passage"}
        </Button>
        {onOpenDocument && (
          <Button variant="ghost" size="xs" onClick={() => onOpenDocument(document.id, chunk.id)}>
            <FileSearch /> Open in document
          </Button>
        )}
      </div>
    </div>
  );
}
