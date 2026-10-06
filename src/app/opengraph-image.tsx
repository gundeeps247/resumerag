import { ImageResponse } from "next/og";
import report from "../../public/eval/reference-results.json";

/**
 * The preview card shown when the site's link is shared (LinkedIn, Slack, WhatsApp…).
 * Rendered once at build time. The three figures are read from the same reference evaluation
 * the landing page uses, so the card cannot drift from what `npm run eval` measured.
 */
export const alt = "ResumeRAG — interview prep grounded in your own documents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const best = report.runs.find((r) => r.config.id === "hybrid_rerank")!;

const STATS = [
  { value: `${Math.round(best.metrics.recall * 100)}%`, label: `Recall@${report.k}` },
  { value: best.metrics.mrr.toFixed(2), label: "MRR" },
  { value: `${Math.round(best.abstention.accuracy * 100)}%`, label: "answer-or-refuse accuracy" },
];

// The light theme's colours (globals.css) as hex, because the image renderer does not read CSS variables.
const BRAND = "#15877c";
const INK = "#17181d";
const MUTED = "#636773";
const LINE = "#e3e4e8";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px",
        background: "#fafafb",
        color: INK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        {/* The same mark as src/app/icon.svg. */}
        <svg width="72" height="72" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" fill={BRAND} />
          <g transform="translate(4 4)" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21V7" />
            <path d="m16 12 2 2 4-4" />
            <path d="M22 6V4a1 1 0 0 0-1-1h-5a4 4 0 0 0-4 4 4 4 0 0 0-4-4H3a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6a1 1 0 0 0 1-1v-1.3" />
          </g>
        </svg>
        <div style={{ marginLeft: 24, fontSize: 44, letterSpacing: -1 }}>ResumeRAG</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 76, lineHeight: 1.08, letterSpacing: -2.5 }}>Interview prep, grounded in your own documents.</div>
        <div style={{ marginTop: 28, fontSize: 32, lineHeight: 1.35, color: MUTED }}>
          Every answer cites the exact passage, or the app refuses. Retrieval and generation run in your browser.
        </div>
      </div>

      <div
        style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderTop: `2px solid ${LINE}`, paddingTop: 28 }}
      >
        <div style={{ display: "flex" }}>
          {STATS.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", marginRight: 56 }}>
              <div style={{ fontSize: 52, letterSpacing: -1.5, color: BRAND }}>{s.value}</div>
              <div style={{ fontSize: 22, color: MUTED }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 22, color: MUTED }}>{`${report.questions} labelled questions · open source`}</div>
      </div>
    </div>,
    size,
  );
}
