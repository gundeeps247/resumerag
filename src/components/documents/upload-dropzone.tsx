"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Lock, UploadCloud } from "lucide-react";
import { addBrowserFiles } from "@/lib/client/documents";
import { useSettings } from "@/lib/client/settings";
import { ACCEPTED_EXTENSIONS, FILE_LIMITS } from "@/lib/rag/config";
import { cn } from "@/lib/utils";

export function UploadDropzone({ compact = false }: { compact?: boolean }) {
  const settings = useSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    try {
      const result = await addBrowserFiles(Array.from(list), settings);
      if (result.added.length) {
        toast.success(`Processing ${result.added.length} document${result.added.length > 1 ? "s" : ""}`, {
          description: "Parsing, chunking and embedding happen in your browser.",
        });
      }
      for (const skipped of result.skipped) toast.warning(`Skipped ${skipped.name}`, { description: skipped.reason });
    } catch (error) {
      toast.error("Upload failed", { description: (error as Error).message });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload documents"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "group bg-card focus-visible:ring-ring relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center transition-colors outline-none focus-visible:ring-2",
        compact ? "px-4 py-6" : "px-6 py-10",
        dragging ? "border-brand bg-brand/5" : "hover:border-foreground/25 hover:bg-muted/40",
        busy && "pointer-events-none opacity-70",
      )}
    >
      <div
        className={cn(
          "bg-background grid size-11 place-items-center rounded-xl border shadow-sm transition-transform group-hover:-translate-y-0.5",
          dragging && "border-brand text-brand",
        )}
      >
        <UploadCloud className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{dragging ? "Drop to add to your knowledge base" : "Drop files here or click to browse"}</p>
        <p className="text-muted-foreground text-xs">
          PDF, DOCX, Markdown or TXT · up to {FILE_LIMITS.maxFileBytes / 1024 / 1024} MB each · {FILE_LIMITS.maxFilesPerUpload} files at a
          time
        </p>
      </div>
      {!compact && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Lock className="size-3" /> Processed locally in your browser — files are never uploaded to a server.
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(",")}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </div>
  );
}
