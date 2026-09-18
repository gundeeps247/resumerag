"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FlaskRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { loadDemoWorkspace } from "@/lib/client/documents";
import { useSettings } from "@/lib/client/settings";

export function LoadDemoButton({
  variant = "outline",
  label = "Load demo workspace",
  onLoaded,
}: {
  variant?: "outline" | "default" | "secondary";
  label?: string;
  onLoaded?: () => void;
}) {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const result = await loadDemoWorkspace(settings);
      if (result.added.length) {
        toast.success("Demo workspace loading", {
          description: "6 fictional documents for “Alex Rivera” are being indexed in your browser.",
        });
        onLoaded?.();
      } else {
        toast.info("The demo documents are already in your knowledge base.");
      }
    } catch (error) {
      toast.error("Could not load the demo", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} onClick={() => void load()} disabled={busy}>
      {busy ? <Spinner /> : <FlaskRound />} {busy ? "Loading demo…" : label}
    </Button>
  );
}
