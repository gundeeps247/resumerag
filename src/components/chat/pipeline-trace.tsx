"use client";

/**
 * "How this answer was generated" — a step-by-step view of the RAG pipeline for one
 * answer: query → embedding → semantic search → BM25 → fusion → reranking → context
 * → generation → citation check. Designed to double as a teaching and demo tool.
 */
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Binary,
  Layers,
  ListOrdered,
  Merge,
  MessageSquareText,
  Minus,
  PenLine,
  Search,
  TextSearch,
} from "lucide-react";
import { ConfidenceBadge } from "@/components/common/confidence-badge";
import { ScoreBar } from "@/components/common/score-bar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AnswerRecordTrace } from "@/lib/db/records";
import { formatMs, truncate } from "@/lib/format";
import { getEmbeddingModel } from "@/lib/rag/embeddings/models";
import type { RetrievalResult, ScoredCandidate } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

function Step({
  icon: Icon,
  title,
  meta,
  children,
  last,
  muted,
}: {
  icon: typeof Search;
  title: string;
  meta?: React.ReactNode;
  children?: React.ReactNode;
  last?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="relative flex gap-3">
      {!last && <div className="bg-border absolute top-8 bottom-0 left-[13px] w-px" />}
      <div
        className={cn(
          "bg-card z-10 grid size-7 shrink-0 place-items-center rounded-lg border",
          muted ? "text-muted-foreground" : "text-brand",
        )}
      >
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] font-medium">{title}</p>
          {meta && <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">{meta}</span>}
        </div>
        {children && <div className="text-muted-foreground mt-1.5 space-y-1.5 text-xs">{children}</div>}
      </div>
    </div>
  );
}

function CandidateLine({ r, c, value, label }: { r: RetrievalResult; c: ScoredCandidate; value: number; label: string }) {
  const p = r.previews[c.chunkId];
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">{p?.docName ?? c.docId}</span>
        {p?.headingPath.length ? <span> · {p.headingPath[p.headingPath.length - 1]}</span> : null}
      </span>
      <ScoreBar value={Math.min(1, value)} className="w-14" tone={c.selected ? "brand" : "muted"} />
      <span className="text-foreground w-12 text-right font-mono text-[10.5px] tabular-nums">{label}</span>
    </div>
  );
}

function RankChange({ before, after }: { before: number; after: number }) {
  if (before === after) return <Minus className="text-muted-foreground size-3" />;
  return before > after ? (
    <span className="text-success flex items-center">
      <ArrowUp className="size-3" />
      {before - after}
    </span>
  ) : (
    <span className="text-destructive flex items-center">
      <ArrowDown className="size-3" />
      {after - before}
    </span>
  );
}

export function PipelineTrace({ trace }: { trace: AnswerRecordTrace }) {
  const r = trace.retrieval;
  const model = getEmbeddingModel(r.embeddingModel);
  const dense = r.candidates.filter((c) => c.denseRank).sort((a, b) => a.denseRank! - b.denseRank!);
  const keyword = r.candidates.filter((c) => c.keywordRank).sort((a, b) => a.keywordRank! - b.keywordRank!);
  const fused = [...r.candidates].filter((c) => c.fusedRank).sort((a, b) => a.fusedRank - b.fusedRank);
  const reranked = r.candidates.filter((c) => c.rerankRank).sort((a, b) => a.rerankRank! - b.rerankRank!);
  const maxBm25 = Math.max(1, ...keyword.map((c) => c.keywordScore ?? 0));
  const gen = trace.generation;
  const tokPerSec = gen?.completionTokens && gen.durationMs ? gen.completionTokens / (gen.durationMs / 1000) : undefined;

  return (
    <div className="space-y-1">
      <Step icon={MessageSquareText} title="Your question" meta={`total retrieval ${formatMs(r.timings.totalMs)}`}>
        <p className="text-foreground">“{trace.originalQuery}”</p>
        {trace.searchQuery !== trace.originalQuery && (
          <p className="bg-muted rounded-md px-2 py-1">
            Rewritten for search (follow-up): <span className="text-foreground">“{trace.searchQuery}”</span>
          </p>
        )}
      </Step>

      {r.options.mode !== "keyword" && (
        <Step icon={Binary} title="Query embedding" meta={formatMs(r.timings.embedMs)}>
          <p>
            <span className="text-foreground">{model.label}</span> turns the question into a {model.dims}-dimensional vector that captures
            its meaning.
          </p>
          {model.queryPrefix && <p className="font-mono text-[10.5px]">prefix: “{model.queryPrefix.trim()}”</p>}
        </Step>
      )}

      {dense.length > 0 && (
        <Step
          icon={Search}
          title="Semantic search (cosine similarity)"
          meta={`${r.chunksSearched} chunks · ${formatMs(r.timings.denseMs)}`}
        >
          {dense.slice(0, 5).map((c) => (
            <CandidateLine key={c.chunkId} r={r} c={c} value={c.denseScore ?? 0} label={(c.denseScore ?? 0).toFixed(3)} />
          ))}
        </Step>
      )}

      {r.options.mode !== "semantic" && (
        <Step icon={TextSearch} title="Keyword search (BM25)" meta={formatMs(r.timings.keywordMs)}>
          {r.keywordQuery && r.keywordQuery !== r.query && (
            <p className="bg-muted rounded-md px-2 py-1">
              Expanded with interview vocabulary: <span className="text-foreground">{r.keywordQuery.slice(r.query.length).trim()}</span>
            </p>
          )}
          {keyword.length ? (
            keyword
              .slice(0, 5)
              .map((c) => (
                <CandidateLine
                  key={c.chunkId}
                  r={r}
                  c={c}
                  value={(c.keywordScore ?? 0) / maxBm25}
                  label={(c.keywordScore ?? 0).toFixed(2)}
                />
              ))
          ) : (
            <p>No exact keyword matches.</p>
          )}
        </Step>
      )}

      {r.options.mode === "hybrid" && (
        <Step icon={Merge} title="Reciprocal rank fusion" meta={`k = ${r.options.rrfK} · ${formatMs(r.timings.fusionMs)}`}>
          <p>Each list votes 1 / (k + rank). Chunks ranked well by both retrievers rise to the top.</p>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 font-mono text-[10.5px]">
            <span className="font-sans">Chunk</span>
            <span>sem</span>
            <span>bm25</span>
            <span>fused</span>
            {fused.slice(0, 6).map((c) => (
              <FusedRow key={c.chunkId} r={r} c={c} />
            ))}
          </div>
        </Step>
      )}

      {reranked.length > 0 ? (
        <Step icon={ListOrdered} title="Cross-encoder reranking" meta={formatMs(r.timings.rerankMs)}>
          <p>
            <span className="text-foreground">{r.rerankerModel?.split("/").pop()}</span> reads the question and each candidate together and
            scores relevance (0–1).
          </p>
          {reranked.slice(0, 6).map((c) => (
            <div key={c.chunkId} className="flex items-center gap-2">
              <span className="w-8">
                <RankChange before={c.fusedRank} after={c.rerankRank!} />
              </span>
              <CandidateLine r={r} c={c} value={c.rerankScore ?? 0} label={(c.rerankScore ?? 0).toFixed(3)} />
            </div>
          ))}
        </Step>
      ) : (
        <Step icon={ListOrdered} title="Reranking" muted>
          <p>Skipped (disabled in settings).</p>
        </Step>
      )}

      <Step icon={Layers} title="Context sent to the model" meta={trace.prompt ? `~${trace.prompt.contextTokens} tokens` : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <ConfidenceBadge confidence={r.confidence} />
          <span>
            {r.results.length} of {r.candidates.length} candidates kept (top-{r.options.topK})
          </span>
        </div>
        {trace.mode === "refused" && (
          <p className="text-foreground">Confidence too low — the model was not called, so nothing could be invented.</p>
        )}
      </Step>

      {gen ? (
        <Step icon={PenLine} title="Generation" meta={formatMs(gen.durationMs)}>
          <p>
            <span className="text-foreground">{gen.model}</span>
            {gen.firstTokenMs !== undefined && <> · first token after {formatMs(gen.firstTokenMs)}</>}
          </p>
          {(gen.promptTokens || gen.completionTokens) && (
            <p className="tabular-nums">
              {gen.promptTokens ?? "?"} prompt tokens → {gen.completionTokens ?? "?"} output tokens
              {tokPerSec ? ` · ${tokPerSec.toFixed(1)} tokens/s` : ""}
            </p>
          )}
        </Step>
      ) : (
        trace.mode === "evidence-only" && (
          <Step icon={PenLine} title="Generation" muted>
            <p>No language model reachable — showing extracted evidence instead. {trace.error && `(${truncate(trace.error, 120)})`}</p>
          </Step>
        )
      )}

      {trace.verification && (
        <Step icon={BadgeCheck} title="Citation check" last>
          <p>
            <span className="text-foreground">
              {trace.verification.checks.filter((c) => c.supported).length} of {trace.verification.checks.length}
            </span>{" "}
            sentences are semantically supported by the passages they cite.
          </p>
          {trace.verification.invalidCitations.length > 0 && (
            <p className="text-destructive">Invalid citation numbers: {trace.verification.invalidCitations.join(", ")}</p>
          )}
          {trace.verification.checks
            .filter((c) => !c.supported)
            .slice(0, 4)
            .map((c, i) => (
              <p key={i} className="border-warning/30 bg-warning/5 rounded-md border px-2 py-1">
                Unverified
                {c.missingNumbers?.length
                  ? ` — number not in the cited source: ${c.missingNumbers.join(", ")}`
                  : ` (similarity ${c.support.toFixed(2)})`}
                : “{truncate(c.sentence, 140)}”
              </p>
            ))}
        </Step>
      )}

      <CandidatesTable r={r} />
    </div>
  );
}

function FusedRow({ r, c }: { r: RetrievalResult; c: ScoredCandidate }) {
  const p = r.previews[c.chunkId];
  return (
    <>
      <span className={cn("truncate font-sans", c.selected ? "text-foreground" : "")}>{p?.docName ?? c.docId}</span>
      <span>{c.denseRank ?? "–"}</span>
      <span>{c.keywordRank ?? "–"}</span>
      <span className="text-foreground">{c.fusedRank}</span>
    </>
  );
}

export function CandidatesTable({ r }: { r: RetrievalResult }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-brand text-xs font-medium hover:underline">
        Show all {r.candidates.length} candidates
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 overflow-x-auto rounded-lg border">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Chunk</th>
                <th className="px-2 py-1.5 text-right font-medium">Cosine</th>
                <th className="px-2 py-1.5 text-right font-medium">BM25</th>
                <th className="px-2 py-1.5 text-right font-medium">RRF #</th>
                <th className="px-2 py-1.5 text-right font-medium">Rerank</th>
                <th className="px-2 py-1.5 text-left font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.candidates.map((c) => (
                <tr key={c.chunkId} className={c.selected ? "bg-brand/5" : ""}>
                  <td className="max-w-40 truncate px-2 py-1.5" title={r.previews[c.chunkId]?.snippet}>
                    {r.previews[c.chunkId]?.docName}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{c.denseScore?.toFixed(3) ?? "–"}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{c.keywordScore?.toFixed(2) ?? "–"}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{c.fusedRank || "–"}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{c.rerankScore?.toFixed(3) ?? "–"}</td>
                  <td className="px-2 py-1.5">
                    {c.selected ? (
                      <span className="text-brand">#{c.finalRank} in context</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {c.dropReason === "below_threshold" ? "below threshold" : "not in top-K"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
