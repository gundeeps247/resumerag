"use client";

import { useKbStats } from "@/hooks/use-kb";
import { useModelProgress } from "@/hooks/use-model-progress";

/**
 * A thin bar under the top bar that shows the two slow things in this app, on every page:
 * downloading a model (determinate, often hundreds of MB) and indexing documents
 * (indeterminate). Without it the app can look idle while a worker is busy.
 */
export function ActivityBar() {
  const download = useModelProgress();
  const stats = useKbStats();
  const downloading = download?.active && download.totalMb > 0;
  const indexing = (stats?.processing ?? 0) > 0;
  if (!downloading && !indexing) return null;

  const label = downloading
    ? `Downloading ${download.model.split("/").pop()} — ${download.loadedMb.toFixed(0)} of ${download.totalMb.toFixed(0)} MB`
    : `Indexing ${stats?.processing} document${stats?.processing === 1 ? "" : "s"}`;

  return (
    <div
      className="bg-muted sticky top-14 z-10 h-0.5 w-full overflow-hidden"
      role="progressbar"
      aria-label={label}
      aria-valuenow={downloading ? Math.round(download.percent) : undefined}
    >
      {downloading ? (
        <div className="bg-brand h-full transition-[width] duration-300" style={{ width: `${Math.min(100, download.percent)}%` }} />
      ) : (
        <div className="bg-brand animate-indeterminate h-full w-1/3" />
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}
