"use client";

import { useEffect, useMemo, useState } from "react";
import * as Comlink from "comlink";
import { toast } from "sonner";
import { CircleCheck, CircleX, FlaskConical, Loader2, Play, TriangleAlert } from "lucide-react";
import { GroupedBars, type BarSeries } from "@/components/charts/grouped-bars";
import { LlmFallbackNotice } from "@/components/common/feature-states";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { StatTile } from "@/components/common/severity";
import { LoadDemoButton } from "@/components/documents/demo-button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocuments } from "@/hooks/use-kb";
import { getRag } from "@/lib/client/rag-client";
import { useSettings } from "@/lib/client/settings";
import { formatMs, pct } from "@/lib/format";
import type { EvalReport } from "@/lib/rag/evaluation/report";
import type { EvalRunResult } from "@/lib/rag/evaluation/runner";
import { cn } from "@/lib/utils";
import { runGenerationEval, type GenerationEvalRow } from "@/lib/workflows/generation-eval";

// Slot order is fixed; the configuration that tells the story (hybrid + rerank) takes slot 1.
const SERIES: BarSeries[] = [
  { id: "hybrid_rerank", label: "Hybrid + rerank", slot: 1 },
  { id: "hybrid", label: "Hybrid (RRF)", slot: 2 },
  { id: "semantic", label: "Semantic only", slot: 3 },
  { id: "keyword", label: "BM25 only", slot: 4 },
];

const decimal = (v: number) => v.toFixed(3);

export default function EvaluationPage() {
  const settings = useSettings();
  const [report, setReport] = useState<EvalReport | null>(null);
  const [live, setLive] = useState<EvalRunResult[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);

  useEffect(() => {
    fetch("/eval/reference-results.json")
      .then((r) => r.json() as Promise<EvalReport>)
      .then(setReport)
      .catch(() => toast.error("Could not load the reference results"));
  }, []);

  async function runLive() {
    setProgress({ done: 0, total: 1, label: "Loading models…" });
    try {
      const runs = await getRag().evaluate(
        settings.chunking,
        5,
        Comlink.proxy((done: number, total: number, label: string) => setProgress({ done, total, label })),
      );
      setLive(runs);
      toast.success("Evaluation finished in your browser");
    } catch (error) {
      toast.error("Evaluation failed", { description: (error as Error).message });
    } finally {
      setProgress(null);
    }
  }

  const runs = live ?? report?.runs ?? null;
  const k = runs?.[0]?.k ?? 5;
  const byId = useMemo(() => new Map((runs ?? []).map((r) => [r.config.id, r])), [runs]);
  const best = byId.get("hybrid_rerank");

  return (
    <PageContainer>
      <PageHeader
        eyebrow="RAG lab"
        title="Evaluation"
        description="A RAG system should be measured, not assumed. Each retrieval strategy is scored on 30 labelled questions over the fictional demo documents — including four questions whose answer is deliberately not in the documents."
        actions={
          <Button onClick={() => void runLive()} disabled={Boolean(progress)}>
            {progress ? <Loader2 className="animate-spin" /> : <Play />} Run in your browser
          </Button>
        }
      />

      {progress && (
        <div className="bg-card space-y-2 rounded-xl border p-4">
          <p className="text-sm">{progress.label}</p>
          <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
        </div>
      )}

      {!runs ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading results…
        </p>
      ) : (
        <>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={live ? "default" : "secondary"}>{live ? "Live run · this browser" : "Reference run · npm run eval"}</Badge>
            {report && !live && (
              <span>
                {report.embeddingModel.split("/").pop()} + {report.rerankerModel.split("/").pop()} · {report.chunks} chunks ·{" "}
                {report.chunking.chunkSize}-token chunks · generated {new Date(report.generatedAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {best && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <StatTile label={`Recall@${k}`} value={pct(best.metrics.recall, 1)} hint="needed facts retrieved" />
              <StatTile label="MRR" value={best.metrics.mrr.toFixed(3)} hint="first hit near rank 1" />
              <StatTile label={`nDCG@${k}`} value={best.metrics.ndcg.toFixed(3)} hint="ranking quality" />
              <StatTile label={`Hit@${k}`} value={pct(best.metrics.hitRate, 1)} hint="at least one relevant" />
              <StatTile
                label="Unanswerable refused"
                value={pct(best.abstention.refusalRate)}
                hint={`answered ${pct(best.abstention.answeredRate)} of answerable`}
              />
              <StatTile label="Mean latency" value={formatMs(best.latency.meanMs)} hint="incl. reranking" />
            </div>
          )}

          <section className="bg-card space-y-4 rounded-xl border p-5">
            <div>
              <h2 className="font-semibold tracking-tight">Every stage of the pipeline earns its place</h2>
              <p className="text-muted-foreground text-sm">Same questions, same documents, four retrieval strategies. Higher is better.</p>
            </div>
            <GroupedBars
              ariaLabel="Retrieval metrics by configuration"
              series={SERIES.filter((s) => byId.has(s.id))}
              highlight="hybrid_rerank"
              rows={[
                { label: `Recall@${k}`, hint: "Share of needed facts found", values: pick(byId, (r) => r.metrics.recall) },
                { label: "MRR", hint: "1 / rank of first relevant", values: pick(byId, (r) => r.metrics.mrr), format: decimal },
                { label: `nDCG@${k}`, hint: "Relevant passages near the top", values: pick(byId, (r) => r.metrics.ndcg), format: decimal },
                { label: `Hit@${k}`, hint: "Any relevant passage found", values: pick(byId, (r) => r.metrics.hitRate) },
                { label: "Answer / refuse", hint: "Correct decision to answer", values: pick(byId, (r) => r.abstention.accuracy) },
              ]}
            />
            <ConfigTable runs={SERIES.map((s) => byId.get(s.id)).filter((r): r is EvalRunResult => Boolean(r))} k={k} />
          </section>

          {report?.grid?.length && !live ? <GridTable report={report} /> : null}

          {best && <FailureAnalysis run={best} />}

          <QuestionTable runs={runs} k={k} />
        </>
      )}

      <GenerationEval />
      <Glossary />
    </PageContainer>
  );
}

function pick(byId: Map<string, EvalRunResult>, fn: (r: EvalRunResult) => number): Record<string, number> {
  return Object.fromEntries([...byId.entries()].map(([id, r]) => [id, fn(r)]));
}

function ConfigTable({ runs, k }: { runs: EvalRunResult[]; k: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            {[
              "Configuration",
              `Hit@${k}`,
              `Recall@${k}`,
              `Precision@${k}`,
              "MRR",
              `nDCG@${k}`,
              "Answered",
              "Refused (unanswerable)",
              "Latency",
            ].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {runs.map((r) => (
            <tr key={r.config.id}>
              <td className="px-3 py-2 font-medium whitespace-nowrap">{r.config.label}</td>
              <td className="px-3 py-2">{pct(r.metrics.hitRate, 1)}</td>
              <td className="px-3 py-2">{pct(r.metrics.recall, 1)}</td>
              <td className="px-3 py-2">{pct(r.metrics.precision, 1)}</td>
              <td className="px-3 py-2">{r.metrics.mrr.toFixed(3)}</td>
              <td className="px-3 py-2">{r.metrics.ndcg.toFixed(3)}</td>
              <td className="px-3 py-2">{pct(r.abstention.answeredRate, 1)}</td>
              <td className="px-3 py-2">{pct(r.abstention.refusalRate)}</td>
              <td className="px-3 py-2">{formatMs(r.latency.meanMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GridTable({ report }: { report: EvalReport }) {
  return (
    <section className="bg-card space-y-3 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold tracking-tight">Chunk size sweep</h2>
        <p className="text-muted-foreground text-sm">
          Structure-aware chunking already splits at section boundaries, so short documents barely change past ~220 tokens. Smaller chunks
          give more precise citations; very small chunks lose context and hurt ranking.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Chunk size</th>
              <th className="px-3 py-2 text-left font-medium">Overlap</th>
              <th className="px-3 py-2 text-left font-medium">Hybrid · MRR</th>
              <th className="px-3 py-2 text-left font-medium">Hybrid · Recall@{report.k}</th>
              <th className="px-3 py-2 text-left font-medium">+ Rerank · MRR</th>
              <th className="px-3 py-2 text-left font-medium">+ Rerank · Recall@{report.k}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.grid.map((g) => {
              const h = g.runs.find((r) => r.config.id === "hybrid");
              const hr = g.runs.find((r) => r.config.id === "hybrid_rerank");
              const isDefault = g.chunkSize === report.chunking.chunkSize;
              return (
                <tr key={g.chunkSize} className={isDefault ? "bg-brand/5" : ""}>
                  <td className="px-3 py-2 font-medium">
                    {g.chunkSize} tokens {isDefault && <Badge variant="secondary">default</Badge>}
                  </td>
                  <td className="px-3 py-2">{g.overlap}</td>
                  <td className="px-3 py-2">{h?.metrics.mrr.toFixed(3)}</td>
                  <td className="px-3 py-2">{h && pct(h.metrics.recall, 1)}</td>
                  <td className="px-3 py-2">{hr?.metrics.mrr.toFixed(3)}</td>
                  <td className="px-3 py-2">{hr && pct(hr.metrics.recall, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FailureAnalysis({ run }: { run: EvalRunResult }) {
  const misses = run.questions.filter((q) => q.answerable && !q.metrics?.firstRelevantRank);
  const falseRefusals = run.questions.filter((q) => q.answerable && q.confidence === "none");
  const falseAnswers = run.questions.filter((q) => !q.answerable && q.confidence !== "none");
  return (
    <section className="bg-card space-y-3 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold tracking-tight">Where it still fails</h2>
        <p className="text-muted-foreground text-sm">
          Evaluation is most useful for the failures it exposes. Current weak spots of the best configuration:
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <FailureList
          title="Relevant passage not retrieved"
          items={misses.map((q) => q.question)}
          empty="None — every answerable question retrieved evidence."
        />
        <FailureList
          title="Answerable but refused"
          items={falseRefusals.map((q) => `${q.question} (score ${q.topScore.toFixed(3)})`)}
          empty="None."
        />
        <FailureList
          title="Unanswerable but answered"
          items={falseAnswers.map((q) => q.question)}
          empty="None — all unanswerable questions were refused."
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Typical cause: the cross-encoder was trained on web search queries, so abstract interview phrasing (“What leadership experience…”)
        can get a low relevance score even when the right passage is found. Interview-aware query expansion fixes most such cases. See
        docs/LIMITATIONS_AND_ROADMAP.md.
      </p>
    </section>
  );
}

function FailureList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        {items.length ? <TriangleAlert className="text-warning size-4" /> : <CircleCheck className="text-success size-4" />}
        {title}
        <span className="text-muted-foreground">· {items.length}</span>
      </p>
      {items.length ? (
        <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">{empty}</p>
      )}
    </div>
  );
}

function QuestionTable({ runs, k }: { runs: EvalRunResult[]; k: number }) {
  const [category, setCategory] = useState("all");
  const ordered = SERIES.map((s) => runs.find((r) => r.config.id === s.id)).filter((r): r is EvalRunResult => Boolean(r));
  const questions = ordered[0]?.questions.filter((q) => category === "all" || q.category === category) ?? [];
  const categories = [...new Set(ordered[0]?.questions.map((q) => q.category) ?? [])];
  return (
    <section className="bg-card space-y-3 rounded-xl border p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold tracking-tight">Per-question results</h2>
          <p className="text-muted-foreground text-sm">
            Rank of the first relevant passage (✓) or a miss within the top {k} (✗). Unanswerable questions should be refused.
          </p>
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c} className="capitalize">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Question</th>
              {ordered.map((r) => (
                <th key={r.config.id} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                  {r.config.label.replace(" (BM25 + semantic, RRF)", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {questions.map((q) => (
              <tr key={q.id}>
                <td className="max-w-md px-3 py-2">
                  <p>{q.question}</p>
                  <p className="text-muted-foreground text-[11px] capitalize">{q.category}</p>
                </td>
                {ordered.map((r) => {
                  const row = r.questions.find((x) => x.id === q.id);
                  if (!row) return <td key={r.config.id} />;
                  if (!row.answerable) {
                    const refused = row.confidence === "none";
                    return (
                      <td key={r.config.id} className="px-3 py-2 text-xs whitespace-nowrap">
                        <span className={cn("inline-flex items-center gap-1", refused ? "text-success" : "text-destructive")}>
                          {refused ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                          {refused ? "refused" : "answered"}
                        </span>
                      </td>
                    );
                  }
                  const rank = row.metrics?.firstRelevantRank;
                  return (
                    <td key={r.config.id} className="px-3 py-2 text-xs whitespace-nowrap tabular-nums">
                      <span className={cn("inline-flex items-center gap-1", rank ? "text-success" : "text-destructive")}>
                        {rank ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                        {rank ? `#${rank}` : "miss"}
                      </span>
                      {row.confidence === "none" && <span className="text-warning ml-1">· refused</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GenerationEval() {
  const settings = useSettings();
  const documents = useDocuments();
  const demoReady = (documents?.filter((d) => d.source === "demo" && d.status === "ready").length ?? 0) >= 6;
  const [rows, setRows] = useState<GenerationEvalRow[]>([]);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);

  async function run() {
    setRows([]);
    setRunning({ done: 0, total: 7 });
    try {
      await runGenerationEval(settings, (row, done, total) => {
        setRows((r) => [...r, row]);
        setRunning({ done, total });
      });
    } catch (error) {
      toast.error("Generation evaluation failed", { description: (error as Error).message });
    } finally {
      setRunning(null);
    }
  }

  const mean = (pickFn: (r: GenerationEvalRow) => number | null) => {
    const values = rows.map(pickFn).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };

  return (
    <section className="bg-card space-y-4 rounded-xl border p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-semibold tracking-tight">
            <FlaskConical className="text-brand size-4" /> Generation check
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Runs 7 demo questions through the full Ask pipeline with your language model and measures faithfulness (sentences supported by
            cited passages), answer relevance, context precision and correct refusals — no paid “LLM judge” needed. These are proxies, not
            perfect judges.
          </p>
        </div>
        <Button variant="outline" onClick={() => void run()} disabled={!demoReady || Boolean(running)}>
          {running ? <Loader2 className="animate-spin" /> : <Play />} Run generation check
        </Button>
      </div>
      {!demoReady && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">Needs the six demo documents in your knowledge base (labels refer to them).</span>
          <LoadDemoButton />
        </div>
      )}
      <LlmFallbackNotice feature="The generation check" />
      {running && <Progress value={(running.done / running.total) * 100} />}
      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              label="Faithfulness"
              value={mean((r) => r.faithfulness) === null ? "–" : pct(mean((r) => r.faithfulness)!)}
              hint="supported sentences"
            />
            <StatTile label="Answer relevance" value={mean((r) => r.answerRelevance)?.toFixed(2) ?? "–"} hint="question ↔ answer cosine" />
            <StatTile
              label="Context precision"
              value={mean((r) => r.contextPrecision) === null ? "–" : pct(mean((r) => r.contextPrecision)!)}
              hint="relevant passages in prompt"
            />
            <StatTile
              label="Correct decisions"
              value={`${rows.filter((r) => r.refusedCorrectly).length}/${rows.length}`}
              hint="answer vs refuse"
            />
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  {["Question", "Mode", "Faithful", "Relevance", "Ctx precision", "Decision", "Time"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y tabular-nums">
                {rows.map((r) => (
                  <tr key={r.question}>
                    <td className="max-w-sm px-3 py-2">{r.question}</td>
                    <td className="px-3 py-2 text-xs">{r.mode}</td>
                    <td className="px-3 py-2">{r.faithfulness === null ? "–" : pct(r.faithfulness)}</td>
                    <td className="px-3 py-2">{r.answerRelevance?.toFixed(2) ?? "–"}</td>
                    <td className="px-3 py-2">{r.contextPrecision === null ? "–" : pct(r.contextPrecision)}</td>
                    <td className={cn("px-3 py-2 text-xs", r.refusedCorrectly ? "text-success" : "text-destructive")}>
                      {r.refusedCorrectly ? "correct" : "wrong"}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.seconds.toFixed(0)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

const GLOSSARY = [
  [
    "Hit@K",
    "Did at least one relevant passage appear in the top K results? Like asking: “was the right page anywhere on the first page of search results?”",
  ],
  ["Recall@K", "Of all the facts needed to answer, what share appeared in the top K? Missing facts mean the model cannot mention them."],
  [
    "Precision@K",
    "What share of the top K passages were relevant? Low precision means the model reads more noise. With only 1–2 relevant passages per question, precision@5 is naturally low.",
  ],
  [
    "MRR (mean reciprocal rank)",
    "1 divided by the position of the first relevant passage, averaged. 1.0 means the best passage is always first; 0.5 means it is typically second.",
  ],
  ["nDCG@K", "Like MRR but rewards every relevant passage, discounting those further down the list."],
  [
    "Answer / refuse accuracy",
    "For answerable questions the system should answer; for unanswerable ones it should say it could not find evidence. This measures the confidence gate.",
  ],
  [
    "Faithfulness",
    "Are the sentences in the answer supported by the passages they cite? Measured with embedding similarity between each sentence and its cited passages.",
  ],
  ["Answer relevance", "Does the answer address the question? Cosine similarity between the question and the answer embeddings."],
  ["Context precision", "Share of passages placed in the prompt that contain a labelled fact."],
];

function Glossary() {
  return (
    <section className="bg-card rounded-xl border p-5">
      <h2 className="mb-2 font-semibold tracking-tight">What the metrics mean</h2>
      <Accordion type="multiple">
        {GLOSSARY.map(([term, text]) => (
          <AccordionItem key={term} value={term}>
            <AccordionTrigger>{term}</AccordionTrigger>
            <AccordionContent className="text-muted-foreground">{text}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
