import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RetrievalConfidence } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

const STYLES = {
  high: { label: "Strong evidence", icon: ShieldCheck, className: "text-success bg-success/10 ring-success/25" },
  medium: { label: "Some evidence", icon: ShieldQuestion, className: "text-info bg-info/10 ring-info/25" },
  low: { label: "Weak evidence", icon: ShieldAlert, className: "text-warning bg-warning/10 ring-warning/30" },
  none: { label: "No evidence", icon: ShieldX, className: "text-destructive bg-destructive/10 ring-destructive/25" },
};

export function ConfidenceBadge({ confidence, className }: { confidence: RetrievalConfidence; className?: string }) {
  const style = STYLES[confidence.level];
  const Icon = style.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-6 cursor-default items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset",
            style.className,
            className,
          )}
        >
          <Icon className="size-3.5" />
          {style.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{confidence.reason}</TooltipContent>
    </Tooltip>
  );
}
