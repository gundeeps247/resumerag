"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { PageContainer } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";

/**
 * Catches render errors in the app so a failure shows something actionable instead of a blank
 * page. Nothing is lost: documents and history live in IndexedDB, not in React state.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center">
        <div className="bg-warning/10 grid size-11 place-items-center rounded-xl">
          <TriangleAlert className="text-warning size-5" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">Something went wrong on this page</p>
          <p className="text-muted-foreground text-sm">
            Your documents and history are safe — they are stored in this browser. Try again, or go back to the start.
          </p>
          {error.message && <p className="text-muted-foreground mt-2 font-mono text-xs break-words">{error.message.slice(0, 300)}</p>}
        </div>
        <div className="flex gap-2">
          <Button onClick={reset}>
            <RotateCcw /> Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to start</Link>
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
