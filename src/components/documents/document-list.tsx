"use client";

import { toast } from "sonner";
import { AlertTriangle, Eye, MoreHorizontal, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { DocTypeBadge, FormatIcon } from "@/components/common/doc-type";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteDocument, reindexDocuments, setDocumentType } from "@/lib/client/documents";
import { useSettings } from "@/lib/client/settings";
import { formatBytes, formatRelative } from "@/lib/format";
import { DOC_TYPE_LABELS, DOC_TYPES, type DocType, type KbDocument } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

const STAGE_LABEL: Record<KbDocument["status"], string> = {
  queued: "Queued",
  parsing: "Extracting text",
  chunking: "Chunking",
  embedding: "Embedding",
  ready: "Ready",
  error: "Failed",
};

export function DocumentList({ documents, onView }: { documents: KbDocument[]; onView: (id: string) => void }) {
  return (
    <div className="bg-card divide-y overflow-hidden rounded-xl border">
      {documents.map((doc) => (
        <DocumentRow key={doc.id} doc={doc} onView={() => onView(doc.id)} />
      ))}
    </div>
  );
}

function DocumentRow({ doc, onView }: { doc: KbDocument; onView: () => void }) {
  const settings = useSettings();
  const processing = !["ready", "error"].includes(doc.status);

  async function remove() {
    await deleteDocument(doc.id);
    toast.success(`Removed ${doc.name}`, { description: "Its chunks and vectors were deleted from this browser." });
  }

  return (
    <div className="hover:bg-muted/30 flex items-center gap-3 px-4 py-3 transition-colors">
      <FormatIcon format={doc.format} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onView}
            disabled={doc.status !== "ready"}
            className="truncate text-left text-sm font-medium hover:underline disabled:no-underline"
          >
            {doc.name}
          </button>
          <DocTypeBadge type={doc.docType} className="hidden sm:inline-flex" />
          {doc.warnings.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="text-warning size-3.5 shrink-0" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{doc.warnings.join(" ")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {processing ? (
          <div className="flex max-w-sm items-center gap-2">
            <Progress value={doc.progress} className="h-1.5" />
            <span className="text-muted-foreground shrink-0 text-xs">
              {STAGE_LABEL[doc.status]}… {doc.progress > 0 ? `${doc.progress}%` : ""}
            </span>
          </div>
        ) : doc.status === "error" ? (
          <div className="flex items-center gap-2">
            <p className="text-destructive line-clamp-2 text-xs" title={doc.error}>
              {doc.error ?? "Processing failed."}
            </p>
            <Button
              variant="outline"
              size="xs"
              className="shrink-0"
              onClick={async () => {
                const queued = await reindexDocuments([doc.id], settings);
                if (!queued) toast.info("This file could not be read. Remove it and upload it again.");
              }}
            >
              <RefreshCw /> Retry
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground truncate text-xs">
            {doc.chunkCount} chunks
            {doc.pageCount ? ` · ${doc.pageCount} page${doc.pageCount > 1 ? "s" : ""}` : ""} · {formatBytes(doc.size)} ·{" "}
            {doc.source === "demo" ? "demo" : doc.source === "paste" ? "pasted" : "uploaded"} {formatRelative(doc.createdAt)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        {doc.status === "ready" && (
          <Button variant="ghost" size="sm" onClick={onView} className="hidden sm:inline-flex">
            <Eye /> Inspect
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${doc.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{doc.name}</DropdownMenuLabel>
            <DropdownMenuItem onClick={onView} disabled={doc.status !== "ready"}>
              <Eye /> Inspect chunks
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ShieldAlert /> Document type
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={doc.docType} onValueChange={(v) => void setDocumentType(doc.id, v as DocType)}>
                  {DOC_TYPES.map((t) => (
                    <DropdownMenuRadioItem key={t} value={t}>
                      {DOC_TYPE_LABELS[t]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={processing}
              onClick={async () => {
                const queued = await reindexDocuments([doc.id], settings);
                toast.info(queued ? `Re-indexing ${doc.name}` : "This file could not be read. Remove it and upload it again.");
              }}
            >
              <RefreshCw /> Re-index
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function DocumentListSkeleton() {
  return (
    <div className="bg-card divide-y overflow-hidden rounded-xl border">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="bg-muted size-9 animate-pulse rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className={cn("bg-muted h-3.5 animate-pulse rounded", i === 1 ? "w-1/3" : "w-1/2")} />
            <div className="bg-muted h-3 w-1/4 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
