"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Columns4, FlaskConical, Info, Loader2, Play } from "lucide-react";
import { CandidatesTable, PipelineTrace } from "@/components/chat/pipeline-trace";
import { SourceCard } from "@/components/chat/source-card";
import { ConfidenceBadge } from "@/components/common/confidence-badge";
import { RequireDocuments } from "@/components/common/feature-states";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getRag } from "@/lib/client/rag-client";
import { useSettings } from "@/lib/client/settings";
import { SUGGESTED_QUESTIONS } from "@/lib/demo";
import { formatMs } from "@/lib/format";
import type { ChunkingOptions, RetrievalMode, RetrievalOptions, RetrievalResult } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

interface RunResult {
  retrieval: RetrievalResult;
  chunkCount?: number;
  avgChunkTokens?: number;
  buildMs?: number;
}

const COMPARE: { label: string; patch: Partial<RetrievalOptions> }[] = [
  { label: "BM25 only", patch: { mode: "keyword", rerank: false } },
  { label: "Semantic only", patch: { mode: "semantic", rerank: false } },
  { label: "Hybrid (RRF)", patch: { mode: "hybrid", rerank: false } },
  { label: "Hybrid + rerank", patch: { mode: "hybrid", rerank: true } },
];

export default function PlaygroundPage() {
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Under the hood"
        title="Retrieval playground"
        description="Change one knob at a time and watch how the retrieved evidence changes. Custom chunk sizes build a temporary index — your real knowledge base is not modified."
      />
      <RequireDocuments what="the playground">
        <Playground />
      </RequireDocuments>
    </PageContainer>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="text-muted-foreground size-3.5 cursor-help" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{children}</TooltipContent>
    </Tooltip>
  );
}

function Playground() {
  const settings = useSettings();
  const [query, setQuery] = useState(SUGGESTED_QUESTIONS[0]);
  const [options, setOptions] = useState<RetrievalOptions>(settings.retrieval);
  const [customChunks, setCustomChunks] = useState(false);
  const [chunking, setChunking] = useState<ChunkingOptions>(settings.chunking);
  const [result, setResult] = useState<RunResult | null>(null);
  const [compare, setCompare] = useState<{ label: string; result: RetrievalResult }[] | null>(null);
  const [busy, setBusy] = useState<"run" | "compare" | null>(null);

  const set = (patch: Partial<RetrievalOptions>) => setOptions((o) => ({ ...o, ...patch }));

  async function search(opts: RetrievalOptions): Promise<RunResult> {
    const rag = getRag();
    if (customChunks) {
      const r = await rag.playgroundSearch(query, chunking, opts);
      return r;
    }
    return { retrieval: await rag.search(query, opts) };
  }

  async function run() {
    setBusy("run");
    setCompare(null);
    try {
      setResult(await search(options));
    } catch (error) {
      toast.error("Search failed", { description: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function runCompare() {
    setBusy("compare");
    setResult(null);
    try {
      const out = [];
      for (const c of COMPARE) out.push({ label: c.label, result: (await search({ ...options, ...c.patch })).retrieval });
      setCompare(out);
    } catch (error) {
      toast.error("Comparison failed", { description: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <div className="bg-card space-y-5 rounded-xl border p-4 xl:sticky xl:top-20 xl:self-start">
        <div className="grid gap-2">
          <Label className="flex items-center gap-1.5">
            Search mode{" "}
            <Hint>
              Semantic compares meaning with embeddings; keyword uses BM25 exact-term matching; hybrid fuses both with reciprocal rank
              fusion.
            </Hint>
          </Label>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={options.mode}
            onValueChange={(v) => v && set({ mode: v as RetrievalMode })}
            className="w-full"
          >
            <ToggleGroupItem value="semantic" className="flex-1">
              Semantic
            </ToggleGroupItem>
            <ToggleGroupItem value="keyword" className="flex-1">
              BM25
            </ToggleGroupItem>
            <ToggleGroupItem value="hybrid" className="flex-1">
              Hybrid
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5">
            Cross-encoder rerank{" "}
            <Hint>A second model reads the question and each candidate together and re-scores them. Slower, more accurate.</Hint>
          </Label>
          <Switch checked={options.rerank} onCheckedChange={(v) => set({ rerank: v })} />
        </div>
        <SliderRow
          label="Top-K (passages kept)"
          value={options.topK}
          min={1}
          max={10}
          onChange={(v) => set({ topK: v })}
          hint="How many passages would be sent to the language model."
        />
        <SliderRow
          label="Candidates per retriever"
          value={options.candidateK}
          min={5}
          max={40}
          onChange={(v) => set({ candidateK: v })}
          hint="Results each retriever passes on to fusion and reranking."
        />
        <SliderRow
          label="Min similarity"
          value={options.minSimilarity}
          min={0}
          max={0.9}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => set({ minSimilarity: v })}
          hint="Drop candidates whose cosine similarity is below this value."
        />
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5">
              Custom chunking{" "}
              <Hint>Re-chunks and re-embeds all documents into a temporary index with these settings. Takes a few seconds.</Hint>
            </Label>
            <Switch checked={customChunks} onCheckedChange={setCustomChunks} />
          </div>
          {customChunks && (
            <>
              <SliderRow
                label="Chunk size"
                value={chunking.chunkSize}
                min={60}
                max={600}
                step={10}
                onChange={(v) => setChunking((c) => ({ ...c, chunkSize: v }))}
                suffix=" tok"
              />
              <SliderRow
                label="Overlap"
                value={chunking.chunkOverlap}
                min={0}
                max={150}
                step={5}
                onChange={(v) => setChunking((c) => ({ ...c, chunkOverlap: v }))}
                suffix=" tok"
              />
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void run()}
              placeholder="Type a question…"
              className="h-10 basis-full sm:flex-1 sm:basis-0"
            />
            <Button className="h-10 flex-1 sm:flex-none" onClick={() => void run()} disabled={Boolean(busy) || !query.trim()}>
              {busy === "run" ? <Loader2 className="animate-spin" /> : <Play />} Search
            </Button>
            <Button
              className="h-10 flex-1 sm:flex-none"
              variant="outline"
              onClick={() => void runCompare()}
              disabled={Boolean(busy) || !query.trim()}
            >
              {busy === "compare" ? <Loader2 className="animate-spin" /> : <Columns4 />} Compare modes
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUESTIONS.slice(0, 5).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuery(q)}
                className="text-muted-foreground hover:bg-muted rounded-full border px-2.5 py-0.5 text-xs"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {!result && !compare && !busy && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
            <FlaskConical className="text-muted-foreground size-5" />
            <p className="text-sm font-medium">Run a search to see every stage of retrieval</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Try the same question in keyword and semantic mode, or turn reranking off, and compare which passages come back.
            </p>
          </div>
        )}

        {result && <RunView run={result} />}
        {compare && <CompareView results={compare} />}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  hint,
  format,
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: string;
  format?: (v: number) => string;
  suffix?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label className="flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1.5">
          {label} {hint && <Hint>{hint}</Hint>}
        </span>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {format ? format(value) : value}
          {suffix}
        </span>
      </Label>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

function RunView({ run }: { run: RunResult }) {
  const r = run.retrieval;
  const metrics = [
    { label: "Chunks searched", value: r.chunksSearched },
    ...(run.chunkCount !== undefined
      ? [
          { label: "Avg chunk", value: `${Math.round(run.avgChunkTokens ?? 0)} tok` },
          { label: "Index build", value: formatMs(run.buildMs) },
        ]
      : []),
    { label: "Embed query", value: formatMs(r.timings.embedMs) },
    { label: "Semantic", value: formatMs(r.timings.denseMs) },
    { label: "BM25", value: formatMs(r.timings.keywordMs) },
    { label: "Rerank", value: formatMs(r.timings.rerankMs) },
    { label: "Total", value: formatMs(r.timings.totalMs) },
  ];
  return (
    <div className="space-y-5">
      <div className="bg-card flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <ConfidenceBadge confidence={r.confidence} />
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-2">
          {metrics.map((m) => (
            <div key={m.label} className="text-xs">
              <span className="text-muted-foreground">{m.label} </span>
              <span className="font-medium tabular-nums">{m.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-5 2xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <p className="text-sm font-medium">Top {r.results.length} passages</p>
          {r.results.map((s, i) => (
            <SourceCard key={s.chunk.id} n={i + 1} source={s} />
          ))}
          <CandidatesTable r={r} />
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="mb-3 text-sm font-medium">Pipeline trace</p>
          <PipelineTrace trace={{ mode: "llm", originalQuery: r.query, searchQuery: r.query, retrieval: r }} />
        </div>
      </div>
    </div>
  );
}

function CompareView({ results }: { results: { label: string; result: RetrievalResult }[] }) {
  // Colour passages consistently across columns so movement between modes is visible.
  const ids = [...new Set(results.flatMap((c) => c.result.results.map((r) => r.chunk.id)))];
  const palette = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Same question, four retrieval strategies. A coloured dot marks the same passage across columns.
      </p>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {results.map((c) => (
          <div key={c.label} className="bg-card space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{c.label}</p>
              <span className="text-muted-foreground text-[11px] tabular-nums">{formatMs(c.result.timings.totalMs)}</span>
            </div>
            <ConfidenceBadge confidence={c.result.confidence} />
            <ol className="space-y-1.5">
              {c.result.results.map((r, i) => {
                const idx = ids.indexOf(r.chunk.id);
                return (
                  <li key={r.chunk.id} className="flex gap-2 rounded-md border p-2 text-xs">
                    <span className="text-muted-foreground font-medium tabular-nums">{i + 1}</span>
                    <span
                      className={cn("mt-1 size-2 shrink-0 rounded-full", idx < palette.length ? palette[idx] : "bg-muted-foreground/30")}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.document.name}</span>
                      <span className="text-muted-foreground line-clamp-2">{r.chunk.text}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
