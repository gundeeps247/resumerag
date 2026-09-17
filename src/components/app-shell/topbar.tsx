"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Download, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLlmStatus } from "@/hooks/use-llm-status";
import { useModelProgress } from "@/hooks/use-model-progress";
import { cn } from "@/lib/utils";
import { findNavItem } from "./nav";

export function Topbar() {
  const pathname = usePathname();
  const item = findNavItem(pathname);

  return (
    <header className="bg-background/80 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur-md sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item?.title ?? "ResumeRAG"}</div>
      </div>
      <ModelDownloadPill />
      <LlmStatusPill />
      <ThemeToggle />
    </header>
  );
}

function ModelDownloadPill() {
  const progress = useModelProgress();
  if (!progress) return null;
  const name = progress.model.split("/").pop();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="bg-card hidden h-7 items-center gap-2 rounded-md border px-2 text-xs sm:flex">
          <Download className={cn("text-brand size-3.5", progress.active && "animate-pulse")} />
          <span className="text-muted-foreground max-w-32 truncate">{name}</span>
          <span className="font-medium tabular-nums">{Math.round(progress.percent)}%</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Downloading open-source model to your browser ({progress.loadedMb.toFixed(1)} / {progress.totalMb.toFixed(1)} MB). Cached after the
        first time.
      </TooltipContent>
    </Tooltip>
  );
}

function LlmStatusPill() {
  const { status, loading } = useLlmStatus();
  const available = status?.available;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/settings#model"
          className="bg-card hover:bg-muted flex h-7 max-w-52 items-center gap-2 rounded-md border px-2 text-xs transition-colors"
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              loading && !status ? "bg-muted-foreground/40 animate-pulse" : available ? "bg-success" : "bg-warning",
            )}
          />
          <span className="truncate">{loading && !status ? "Checking model…" : available ? status?.model : "Evidence-only mode"}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {available
          ? `Generating with ${status?.label} · ${status?.model}`
          : `${status?.error ?? "No language model is reachable."} Retrieval and citations still work; answers show extracted evidence.`}
      </TooltipContent>
    </Tooltip>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  );
}
