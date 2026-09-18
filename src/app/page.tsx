import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Binary,
  FileSearch,
  FileText,
  FlaskConical,
  FolderGit2,
  Gauge,
  GitCompareArrows,
  HardDrive,
  Layers,
  ListOrdered,
  Lock,
  Merge,
  MessagesSquare,
  PenLine,
  ScanSearch,
  ShieldCheck,
  Star,
  Target,
  UsersRound,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import report from "../../public/eval/reference-results.json";

const best = report.runs.find((r) => r.config.id === "hybrid_rerank")!;
const baseline = report.runs.find((r) => r.config.id === "keyword")!;

const PIPELINE = [
  { icon: FileText, title: "Parse", text: "PDF, DOCX, Markdown and text become headings, paragraphs and bullets — with page numbers." },
  { icon: Layers, title: "Chunk", text: "Structure-aware chunks that never mix two sections, each tagged with its heading path." },
  { icon: Binary, title: "Embed", text: "An open-source model turns every chunk into a 384-dimensional meaning vector — in your browser." },
  { icon: Merge, title: "Hybrid search", text: "Semantic search and BM25 keyword search, fused with reciprocal rank fusion." },
  { icon: ListOrdered, title: "Rerank", text: "A cross-encoder re-reads the top candidates together with the question." },
  { icon: PenLine, title: "Generate", text: "A local LLM answers only from the numbered passages — or refuses." },
  { icon: BadgeCheck, title: "Cite & verify", text: "Every sentence is checked against the passage it cites." },
];

const FEATURES = [
  {
    icon: MessagesSquare,
    title: "Grounded answers",
    text: "Ask anything about your experience. Every claim cites the exact passage, page and section it came from.",
  },
  {
    icon: ScanSearch,
    title: "Resume X-ray & Grill mode",
    text: "Flags vague ownership, unquantified impact and expert claims — then asks the hardest legitimate questions.",
  },
  {
    icon: FolderGit2,
    title: "Project deep dive",
    text: "Explain a project in 30 seconds or in depth, and climb a ladder of increasingly hard follow-ups.",
  },
  { icon: Target, title: "JD match", text: "Requirement-by-requirement evidence. A skill only counts when your own documents prove it." },
  {
    icon: UsersRound,
    title: "Mock interview",
    text: "Adaptive questions, rubric scoring, and a check of your answer's claims against your documents.",
  },
  {
    icon: Star,
    title: "STAR builder",
    text: "Behavioural answers from real experiences, with facts and suggested wording kept visibly apart.",
  },
  {
    icon: GitCompareArrows,
    title: "Consistency checker",
    text: "Catches “AUC 0.91 on the resume, 0.89 in the report” before an interviewer does.",
  },
  { icon: FlaskConical, title: "RAG lab", text: "A retrieval playground and an evaluation suite that measure each pipeline stage." },
];

export default function LandingPage() {
  return (
    <div className="bg-background min-h-dvh">
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo subtitle={false} />
          <nav className="text-muted-foreground hidden items-center gap-6 text-sm md:flex">
            <a href="#how-it-works" className="hover:text-foreground">
              How it works
            </a>
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#evaluation" className="hover:text-foreground">
              Evaluation
            </a>
            <a href="#privacy" className="hover:text-foreground">
              Privacy
            </a>
          </nav>
          <Button asChild size="sm">
            <Link href="/dashboard">
              Open app <ArrowRight />
            </Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b">
          <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)] opacity-50" />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-24">
            <div className="space-y-6">
              <p className="bg-card text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                <span className="bg-brand size-1.5 rounded-full" /> Open source · Runs in your browser · No paid APIs
              </p>
              <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Interview prep, grounded in your own documents.
              </h1>
              <p className="text-muted-foreground max-w-xl text-lg text-pretty">
                Upload your resume, project reports and job descriptions. ResumeRAG builds a private knowledge base in your browser and
                prepares you for interviews with answers you can trace back to the exact passage.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg" className="h-11 px-5">
                  <Link href="/dashboard?demo=1">
                    Try the demo workspace <ArrowRight />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-11 px-5">
                  <Link href="/documents">Use my own documents</Link>
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                The demo loads six fictional documents for “Alex Rivera”. No sign-up, nothing uploaded.
              </p>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 space-y-10 px-4 py-20 sm:px-6">
          <SectionHeading
            eyebrow="How it works"
            title="Retrieval-augmented generation, step by step"
            text="An open-book exam for a language model: first find the right pages in your documents, then answer only from them."
          />
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
            {PIPELINE.map((step, i) => (
              <li key={step.title} className="bg-card relative rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <step.icon className="text-brand size-5" />
                  <span className="text-muted-foreground text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <p className="mt-3 text-sm font-medium">{step.title}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground text-center text-sm">
            Every answer has a <span className="text-foreground font-medium">“How this answer was generated”</span> panel showing each of
            these stages with its scores and timings.
          </p>
        </section>

        <section id="features" className="bg-surface scroll-mt-20 border-y">
          <div className="mx-auto max-w-6xl space-y-10 px-4 py-20 sm:px-6">
            <SectionHeading
              eyebrow="Features"
              title="Not another “chat with your PDF”"
              text="Specialised interview workflows, all built on the same grounded retrieval pipeline."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <div key={f.title} className="bg-card rounded-xl border p-5">
                  <div className="bg-brand/10 text-brand grid size-9 place-items-center rounded-lg">
                    <f.icon className="size-[18px]" />
                  </div>
                  <p className="mt-4 font-medium">{f.title}</p>
                  <p className="text-muted-foreground mt-1.5 text-sm">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="evaluation" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
          <SectionHeading
            eyebrow="Evaluation"
            title="Measured, not assumed"
            text={`On ${report.questions} labelled questions — including deliberately unanswerable ones — each pipeline stage is scored separately. Hybrid search with cross-encoder reranking finds the needed facts ${Math.round(best.metrics.recall * 100)}% of the time, versus ${Math.round(baseline.metrics.recall * 100)}% for keyword search alone, and refuses every unanswerable question.`}
            align="left"
          />
          <div className="bg-card rounded-2xl border p-6">
            <div className="space-y-4">
              {report.runs.map((r) => (
                <div key={r.config.id} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className={r.config.id === "hybrid_rerank" ? "font-medium" : "text-muted-foreground"}>{r.config.label}</span>
                    <span className="font-medium tabular-nums">{(r.metrics.recall * 100).toFixed(1)}%</span>
                  </div>
                  <div className="bg-muted h-2.5 rounded-r-[4px]">
                    <div
                      className={
                        r.config.id === "hybrid_rerank"
                          ? "bg-chart-1 h-full rounded-r-[4px]"
                          : "bg-muted-foreground/40 h-full rounded-r-[4px]"
                      }
                      style={{ width: `${r.metrics.recall * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-5 text-xs">
              Recall@{report.k} · MRR {best.metrics.mrr.toFixed(2)} with reranking · reproducible with{" "}
              <code className="bg-muted rounded px-1">npm run eval</code>
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/evaluation">
                <Gauge /> See the full evaluation
              </Link>
            </Button>
          </div>
        </section>

        <section id="privacy" className="bg-surface scroll-mt-20 border-t">
          <div className="mx-auto max-w-6xl space-y-10 px-4 py-20 sm:px-6">
            <SectionHeading
              eyebrow="Privacy"
              title="Your resume never touches our servers"
              text="Local-first by design — and honest about the one exception."
            />
            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  icon: HardDrive,
                  title: "Stored on your device",
                  text: "Parsing, chunking, embeddings and search run in a Web Worker. Documents and vectors live in your browser's IndexedDB.",
                },
                {
                  icon: ShieldCheck,
                  title: "Open-weight models, in your browser",
                  text: "Embeddings, reranking and answer generation all run in this tab with Transformers.js — no API key, no account, no server.",
                },
                {
                  icon: Lock,
                  title: "Only what you choose leaves",
                  text: "Nothing leaves your device with the in-browser model or Ollama. Connect a hosted model and only the question plus the top passages are sent.",
                },
              ].map((p) => (
                <div key={p.title} className="bg-card rounded-xl border p-5">
                  <p.icon className="text-brand size-5" />
                  <p className="mt-3 font-medium">{p.title}</p>
                  <p className="text-muted-foreground mt-1.5 text-sm">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Walk into the interview knowing what they will ask.</h2>
          <p className="text-muted-foreground mx-auto mt-3 max-w-xl">Try the fictional demo in one click, then bring your own documents.</p>
          <div className="mt-6 flex justify-center gap-3">
            <Button asChild size="lg" className="h-11 px-5">
              <Link href="/dashboard?demo=1">
                Try the demo <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-5">
              <Link href="/evaluation">How it is evaluated</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>ResumeRAG — an open-source RAG project. All demo data is fictional.</span>
          <span>Next.js · Transformers.js · ONNX Runtime · Ollama · IndexedDB</span>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  text,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  text: string;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl space-y-3 text-center" : "max-w-xl space-y-3"}>
      <p className="text-brand text-xs font-medium tracking-wide uppercase">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight text-balance">{title}</h2>
      <p className="text-muted-foreground text-pretty">{text}</p>
    </div>
  );
}

/** A static illustration of the Ask screen (not a screenshot, so it stays crisp in both themes). */
function ProductPreview() {
  const chip = (n: number) => (
    <span className="bg-brand/10 text-brand ring-brand/30 mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md px-1 align-[1px] text-[10.5px] font-semibold ring-1 ring-inset">
      {n}
    </span>
  );
  const sources = [
    { name: "finlytics-churn-project-report.docx", where: "5. Modelling Approach", score: 0.99 },
    { name: "alex-rivera-resume.pdf", where: "page 1 · Machine Learning Intern", score: 0.95 },
    { name: "behavioral-story-notes.md", where: "Story 2 — Catching data leakage", score: 0.71 },
  ];
  return (
    <div role="img" aria-label="Preview of a grounded answer with citations and sources" className="relative">
      <div className="bg-brand/5 absolute -inset-4 -z-10 rounded-3xl blur-2xl" />
      <div className="bg-card overflow-hidden rounded-2xl border shadow-xl shadow-black/5">
        <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
          <span className="bg-muted-foreground/25 size-2.5 rounded-full" />
          <span className="bg-muted-foreground/25 size-2.5 rounded-full" />
          <span className="bg-muted-foreground/25 size-2.5 rounded-full" />
          <span className="text-muted-foreground ml-3 text-xs">Ask</span>
        </div>
        <div className="grid sm:grid-cols-[1.35fr_1fr]">
          <div className="space-y-4 p-5">
            <div className="bg-primary text-primary-foreground ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm">
              How did I handle class imbalance in the churn model?
            </div>
            <div className="space-y-3 text-sm leading-relaxed">
              <p>
                You used XGBoost&apos;s <span className="font-medium">scale_pos_weight</span> parameter, because only about 7% of customers
                churned {chip(1)}. You also tried SMOTE oversampling but dropped it: it hurt probability calibration and did not improve
                PR-AUC {chip(1)}.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="bg-success/10 text-success ring-success/25 inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset">
                  <ShieldCheck className="size-3.5" /> Strong evidence
                </span>
                <span className="bg-success/10 text-success ring-success/25 inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset">
                  <BadgeCheck className="size-3.5" /> 2/2 verified
                </span>
              </div>
            </div>
          </div>
          <div className="bg-surface space-y-2 border-t p-4 sm:border-t-0 sm:border-l">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <FileSearch className="size-3.5" /> Sources
            </p>
            {sources.map((s, i) => (
              <div key={s.name} className="bg-card rounded-lg border p-2.5">
                <div className="flex items-center gap-2">
                  <span className="bg-brand/15 text-brand grid size-4 place-items-center rounded text-[9px] font-semibold">{i + 1}</span>
                  <span className="truncate text-[11px] font-medium">{s.name}</span>
                </div>
                <p className="text-muted-foreground mt-0.5 truncate pl-6 text-[10px]">{s.where}</p>
                <div className="bg-brand/15 mt-1.5 ml-6 h-1 rounded-full">
                  <div className="bg-brand h-full rounded-full" style={{ width: `${s.score * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 font-mono text-[10.5px]">
          <span>384-d embedding</span>
          <span>BM25 + semantic → RRF</span>
          <span>cross-encoder rerank</span>
          <span>5 passages · 1.3 s</span>
        </div>
      </div>
    </div>
  );
}
