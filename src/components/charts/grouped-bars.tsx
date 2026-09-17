"use client";

/**
 * Small-multiple horizontal bar chart: one row per metric, one thin bar per series.
 * Follows the project's chart rules: validated categorical slots assigned in order,
 * ≤ 24px bars with a 4px rounded data-end and square baseline, 2px surface gap between
 * bars, legend always present, only the highlighted series is direct-labelled, and a
 * per-bar tooltip (hover and keyboard focus). Every value is also in the table view
 * rendered next to the chart, so the tooltip never gates information.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface BarSeries {
  id: string;
  label: string;
  /** 1-based categorical slot (maps to --chart-N). Assign in order; never cycle. */
  slot: 1 | 2 | 3 | 4 | 5;
}

export interface BarRow {
  label: string;
  hint?: string;
  values: Record<string, number>;
  format?: (v: number) => string;
}

interface GroupedBarsProps {
  series: BarSeries[];
  rows: BarRow[];
  /** Series whose value is printed at the bar tip. */
  highlight?: string;
  max?: number;
  className?: string;
  ariaLabel: string;
}

const SLOT_BG: Record<BarSeries["slot"], string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
};

const percent = (v: number) => `${(v * 100).toFixed(1)}%`;

export function GroupedBars({ series, rows, highlight, max = 1, className, ariaLabel }: GroupedBarsProps) {
  return (
    <figure className={cn("space-y-4", className)} aria-label={ariaLabel}>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s) => (
          <span key={s.id} className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span className={cn("size-2.5 rounded-[3px]", SLOT_BG[s.slot])} />
            {s.label}
          </span>
        ))}
      </figcaption>
      <div className="space-y-4">
        {rows.map((row) => {
          const format = row.format ?? percent;
          return (
            <div key={row.label} className="grid gap-2 sm:grid-cols-[150px_1fr] sm:items-center">
              <div>
                <p className="text-sm font-medium">{row.label}</p>
                {row.hint && <p className="text-muted-foreground text-[11px]">{row.hint}</p>}
              </div>
              <div className="border-border flex flex-col gap-[2px] border-l py-0.5">
                {series.map((s) => {
                  const value = row.values[s.id] ?? 0;
                  const width = Math.max(0, Math.min(1, value / max)) * 100;
                  return (
                    <Tooltip key={s.id}>
                      <TooltipTrigger asChild>
                        <div
                          tabIndex={0}
                          aria-label={`${row.label}, ${s.label}: ${format(value)}`}
                          className="group focus-visible:ring-ring rounded-sm py-[1px] outline-none focus-visible:ring-2"
                        >
                          {/* The right margin reserves room for the tip label, so bar widths stay proportional. */}
                          <div className="relative mr-14 h-2.5">
                            <div
                              className={cn(
                                "h-full rounded-r-[4px] transition-[width,filter] duration-500 group-hover:brightness-110",
                                SLOT_BG[s.slot],
                              )}
                              style={{ width: `${width}%`, minWidth: value > 0 ? 3 : 0 }}
                            />
                            {s.id === highlight && (
                              <span
                                className="text-foreground absolute top-1/2 -translate-y-1/2 pl-1.5 text-[11px] leading-none font-medium whitespace-nowrap tabular-nums"
                                style={{ left: `${width}%` }}
                              >
                                {format(value)}
                              </span>
                            )}
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <span className="font-semibold tabular-nums">{format(value)}</span> <span className="opacity-80">· {s.label}</span>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
