import { BookOpenCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-brand text-brand-foreground grid size-8 shrink-0 place-items-center rounded-lg shadow-sm ring-1 ring-black/5",
        className,
      )}
    >
      <BookOpenCheck className="size-[18px]" strokeWidth={2.2} />
    </div>
  );
}

export function Logo({ className, subtitle = true }: { className?: string; subtitle?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="grid leading-tight">
        <span className="text-[0.95rem] font-semibold tracking-tight">ResumeRAG</span>
        {subtitle && <span className="text-muted-foreground text-[11px]">Grounded interview prep</span>}
      </div>
    </div>
  );
}
