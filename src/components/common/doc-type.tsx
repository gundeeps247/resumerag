import { FileCode2, FileText, FileType2, NotebookText } from "lucide-react";
import { DOC_TYPE_LABELS, type DocType, type SupportedFormat } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

export const DOC_TYPE_STYLES: Record<DocType, string> = {
  resume: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  project_report: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  job_description: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  company_info: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300",
  research_paper: "bg-pink-500/10 text-pink-700 ring-pink-500/20 dark:text-pink-300",
  internship: "bg-teal-500/10 text-teal-700 ring-teal-500/20 dark:text-teal-300",
  notes: "bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-300",
  other: "bg-zinc-500/10 text-zinc-700 ring-zinc-500/20 dark:text-zinc-300",
};

export function DocTypeBadge({ type, className }: { type: DocType; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        DOC_TYPE_STYLES[type],
        className,
      )}
    >
      {DOC_TYPE_LABELS[type]}
    </span>
  );
}

const FORMAT_ICON: Record<SupportedFormat, { icon: typeof FileText; className: string }> = {
  pdf: { icon: FileText, className: "text-red-500 bg-red-500/10" },
  docx: { icon: FileType2, className: "text-blue-500 bg-blue-500/10" },
  md: { icon: FileCode2, className: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" },
  txt: { icon: NotebookText, className: "text-zinc-500 bg-zinc-500/10" },
};

export function FormatIcon({ format, className }: { format: SupportedFormat; className?: string }) {
  const { icon: Icon, className: tone } = FORMAT_ICON[format];
  return (
    <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg", tone, className)}>
      <Icon className="size-[18px]" />
    </div>
  );
}
