import { cn } from "@/lib/utils";

interface ScoreBarProps {
  /** 0..1 */
  value: number;
  className?: string;
  tone?: "brand" | "info" | "warning" | "muted" | "auto";
  label?: string;
}

const TONES = {
  brand: "bg-brand",
  info: "bg-info",
  warning: "bg-warning",
  muted: "bg-muted-foreground/50",
};

// Meter track: a lighter step of the fill's own hue, so the state reads across the whole bar.
const TRACKS = {
  brand: "bg-brand/15",
  info: "bg-info/15",
  warning: "bg-warning/20",
  muted: "bg-muted",
};

export function ScoreBar({ value, className, tone = "brand", label }: ScoreBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const resolved = tone === "auto" ? (clamped >= 0.66 ? "brand" : clamped >= 0.33 ? "warning" : "muted") : tone;
  return (
    <div className={cn("flex items-center gap-2", className)} title={label}>
      <div className={cn("h-1.5 w-full overflow-hidden rounded-full", TRACKS[resolved])}>
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", TONES[resolved])}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    </div>
  );
}

/** Circular score (e.g. 78%). */
export function ScoreRing({
  value,
  size = 64,
  label,
  display,
  className,
}: {
  value: number;
  size?: number;
  label?: string;
  /** Text shown in the centre; defaults to the value as a percentage. */
  display?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = clamped >= 0.7 ? "var(--brand)" : clamped >= 0.45 ? "var(--warning)" : "var(--destructive)";
  return (
    <div className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <span className="text-sm font-semibold tabular-nums">{display ?? Math.round(clamped * 100)}</span>
        {label && <span className="text-muted-foreground mt-0.5 text-[9px] uppercase">{label}</span>}
      </div>
    </div>
  );
}
