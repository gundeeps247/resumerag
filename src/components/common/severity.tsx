import type { Severity } from "@/lib/rag/analysis/claims";
import { cn } from "@/lib/utils";

const STYLES: Record<Severity, string> = {
  high: "bg-destructive/10 text-destructive ring-destructive/25",
  medium: "bg-warning/10 text-warning ring-warning/30",
  low: "bg-muted text-muted-foreground ring-border",
};

export function SeverityBadge({ severity, children, className }: { severity: Severity; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        STYLES[severity],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-card rounded-xl border px-4 py-3", className)}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="text-muted-foreground mt-0.5 text-[11px]">{hint}</p>}
    </div>
  );
}
