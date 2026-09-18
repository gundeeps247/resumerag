"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { FlaskRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { removeDemoWorkspace } from "@/lib/client/demo-session";
import { getDb } from "@/lib/db/schema";

/**
 * Tells the visitor that what they are looking at is fictional and temporary. Without this the
 * demo could be mistaken for their own data — and its disappearance on the next visit would
 * come as a surprise.
 */
export function DemoNotice({ className }: { className?: string }) {
  const demoCount = useLiveQuery(
    () =>
      getDb()
        .documents.filter((d) => d.source === "demo")
        .count(),
    [],
    0,
  );
  const [busy, setBusy] = useState(false);
  if (!demoCount) return null;

  async function remove() {
    setBusy(true);
    try {
      const removed = await removeDemoWorkspace();
      toast.success(`Removed ${removed} demo document${removed === 1 ? "" : "s"}`, {
        description: "Anything created from them was removed too.",
      });
    } catch (error) {
      toast.error("Could not remove the demo", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className ?? "border-brand/30 bg-brand/5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"}>
      <FlaskRound className="text-brand size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">You are exploring the demo workspace</span>
        <span className="text-muted-foreground">
          {" "}
          — {demoCount} fictional documents for “Alex Rivera”. They are removed when you close this site, along with anything created from
          them.
        </span>
      </p>
      <Button variant="outline" size="sm" onClick={() => void remove()} disabled={busy}>
        {busy ? <Spinner /> : <Trash2 />} Remove now
      </Button>
    </div>
  );
}
