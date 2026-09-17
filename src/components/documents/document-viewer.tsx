"use client";

import { AlertTriangle, Hash, Layers } from "lucide-react";
import { DocTypeBadge } from "@/components/common/doc-type";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentDetail } from "@/hooks/use-kb";
import { formatLocation } from "@/lib/rag/generation/context";
import type { Chunk, TextBlock } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

interface DocumentViewerProps {
  docId: string | null;
  onClose: () => void;
  /** Chunk to highlight and scroll to (e.g. from a citation). */
  focusChunkId?: string;
}

export function DocumentViewer({ docId, onClose, focusChunkId }: DocumentViewerProps) {
  const detail = useDocumentDetail(docId);

  return (
    <Sheet open={Boolean(docId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
        {detail ? (
          <>
            <SheetHeader className="border-b p-5">
              <div className="flex items-center gap-2">
                <DocTypeBadge type={detail.doc.docType} />
                <span className="text-muted-foreground text-xs uppercase">{detail.doc.format}</span>
              </div>
              <SheetTitle className="truncate text-base">{detail.doc.name}</SheetTitle>
              <SheetDescription>
                {detail.chunks.length} chunks · {detail.chunks[0]?.dims ?? 0}-dimensional vectors ·{" "}
                {detail.doc.embeddingModel?.split("/").pop()}
                {detail.doc.chunking && ` · ${detail.doc.chunking.chunkSize}-token chunks, ${detail.doc.chunking.chunkOverlap} overlap`}
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="chunks" className="flex min-h-0 flex-1 flex-col gap-0">
              <div className="border-b px-5 py-2">
                <TabsList>
                  <TabsTrigger value="chunks">
                    <Layers /> Chunks
                  </TabsTrigger>
                  <TabsTrigger value="text">
                    <Hash /> Parsed text
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="chunks" className="min-h-0 flex-1 overflow-y-auto">
                <div>
                  <div className="space-y-3 p-5">
                    <p className="text-muted-foreground text-xs">
                      These are the exact pieces that get embedded and retrieved. The breadcrumb is the heading path added to each chunk for
                      context; shaded text is overlap repeated from the previous chunk.
                    </p>
                    {detail.chunks.map((chunk) => (
                      <ChunkCard key={chunk.id} chunk={chunk} focused={chunk.id === focusChunkId} />
                    ))}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="text" className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-2 p-5">{detail.content && <ParsedBlocks blocks={detail.content.blocks} />}</div>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>Loading…</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ChunkCard({ chunk, focused }: { chunk: Chunk; focused?: boolean }) {
  const overlap = chunk.overlapChars ?? 0;
  return (
    <div
      ref={(el) => {
        if (focused && el) el.scrollIntoView({ block: "center" });
      }}
      className={cn("bg-card rounded-lg border p-3 text-sm", focused && "border-brand ring-brand/20 ring-2")}
    >
      <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="secondary" className="font-mono">
          #{chunk.index}
        </Badge>
        <span className="tabular-nums">~{chunk.tokenCount} tokens</span>
        {formatLocation(chunk) && <span className="truncate">· {formatLocation(chunk)}</span>}
        {chunk.suspicious && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle /> Instruction-like text
          </Badge>
        )}
      </div>
      <p className="text-[0.85rem] leading-relaxed whitespace-pre-wrap">
        {overlap > 0 && <span className="bg-muted text-muted-foreground rounded-sm">{chunk.text.slice(0, overlap)}</span>}
        {chunk.text.slice(overlap)}
      </p>
    </div>
  );
}

/** Page number of the nearest earlier block that has one. */
function previousPage(blocks: TextBlock[], index: number): number | undefined {
  for (let j = index - 1; j >= 0; j--) if (blocks[j].page) return blocks[j].page;
  return undefined;
}

function ParsedBlocks({ blocks }: { blocks: TextBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        const pageBreak = block.page && block.page !== previousPage(blocks, i) ? block.page : undefined;
        return (
          <div key={i}>
            {pageBreak && (
              <div className="text-muted-foreground my-3 flex items-center gap-2 text-[11px]">
                <div className="bg-border h-px flex-1" /> Page {pageBreak} <div className="bg-border h-px flex-1" />
              </div>
            )}
            {block.kind === "heading" ? (
              <p className={cn("pt-2 font-semibold", (block.level ?? 1) <= 2 ? "text-base" : "text-sm")}>{block.text}</p>
            ) : block.kind === "list_item" ? (
              <p className="flex gap-2 text-sm">
                <span className="text-muted-foreground">•</span>
                {block.text}
              </p>
            ) : block.kind === "table_row" ? (
              <p className="font-mono text-xs">{block.text}</p>
            ) : (
              <p className="text-sm leading-relaxed">{block.text}</p>
            )}
          </div>
        );
      })}
    </>
  );
}
