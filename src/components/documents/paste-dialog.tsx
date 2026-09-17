"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addPastedText } from "@/lib/client/documents";
import { useSettings } from "@/lib/client/settings";
import { FILE_LIMITS } from "@/lib/rag/config";
import { DOC_TYPE_LABELS, DOC_TYPES, type DocType } from "@/lib/rag/types";

interface PasteDialogProps {
  defaultType?: DocType;
  trigger?: React.ReactNode;
  onAdded?: (docId: string) => void;
}

export function PasteDialog({ defaultType = "job_description", trigger, onAdded }: PasteDialogProps) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [docType, setDocType] = useState<DocType>(defaultType);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await addPastedText(title || `${DOC_TYPE_LABELS[docType]} (pasted)`, text, docType, settings);
    setBusy(false);
    if (result.added.length) {
      toast.success("Added to your knowledge base");
      onAdded?.(result.added[0]);
      setOpen(false);
      setTitle("");
      setText("");
    } else {
      toast.warning("Not added", { description: result.skipped[0]?.reason });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <ClipboardPaste /> Paste text
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste text</DialogTitle>
          <DialogDescription>
            Useful for job descriptions copied from a careers page, or notes you have not saved as a file.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <div className="grid gap-1.5">
              <Label htmlFor="paste-title">Title</Label>
              <Input id="paste-title" placeholder="e.g. ML Engineer – Northwind" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Document type</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {DOC_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="paste-text">Text</Label>
            <Textarea
              id="paste-text"
              className="max-h-[45vh] min-h-56 font-mono text-xs"
              placeholder="Paste the full text here…"
              value={text}
              maxLength={FILE_LIMITS.maxPasteChars}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-muted-foreground text-right text-[11px] tabular-nums">
              {text.length.toLocaleString()} / {FILE_LIMITS.maxPasteChars.toLocaleString()}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || text.trim().length < 40}>
            Add to knowledge base
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
