"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRight,
  ChevronDown,
  ClipboardList,
  Check,
  FileUp,
  FlaskConical,
  FolderGit2,
  Gauge,
  GitCompareArrows,
  ListChecks,
  MessagesSquare,
  ScanSearch,
  Star,
  Target,
  UsersRound,
} from "lucide-react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { PageSkeleton } from "@/components/common/page-skeleton";
import { ScoreBar } from "@/components/common/score-bar";
import { StatTile } from "@/components/common/severity";
import { DemoNotice } from "@/components/documents/demo-notice";
import { LoadDemoButton } from "@/components/documents/demo-button";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useKbStats, type KbStats } from "@/hooks/use-kb";
import { loadDemoWorkspace } from "@/lib/client/documents";
import { useSettings } from "@/lib/client/settings";
import type { MockSessionRecord, SavedAnalysis, SavedQuestion } from "@/lib/db/records";
import { getDb, type MessageRecord } from "@/lib/db/schema";
import { RUBRIC } from "@/lib/workflows/mock";

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Home />
    </Suspense>
  );
}

interface DashboardData {
  analyses: SavedAnalysis[];
  sessions: MockSessionRecord[];
  questions: SavedQuestion[];
  recent: MessageRecord[];
}

function Home() {
  const settings = useSettings();
  const stats = useKbStats();
  const params = useSearchParams();
  const router = useRouter();
  const demoStarted = useRef(false);
  const data = useLiveQuery<DashboardData>(async () => {
    const db = getDb();
    const [analyses, sessions, questions, recent] = await Promise.all([
      db.analyses.toArray(),
      db.mockSessions.toArray(),
      db.questions.toArray(),
      db.messages
        .orderBy("createdAt")
        .reverse()
        .filter((m) => m.role === "user")
        .limit(5)
        .toArray(),
    ]);
    return { analyses, sessions, questions, recent };
  }, []);

  // The landing page links to /dashboard?demo=1 to load the demo workspace in one click.
  useEffect(() => {
    if (params.get("demo") !== "1" || !stats || demoStarted.current) return;
    demoStarted.current = true;
    const load = stats.documents === 0 ? loadDemoWorkspace(settings) : Promise.resolve();
    void load.finally(() => router.replace("/dashboard"));
  }, [params, stats, settings, router]);

  if (!stats || !data) return <PageSkeleton />;

  return (
    <PageContainer>
      <PageHeader
        title="Interview prep, grounded in your documents"
        description="Two things to do here: ask questions about your own material, and practise answering out loud. Everything cites the passage it came from."
      />
      {stats.documents === 0 ? <FirstRun /> : <Ready stats={stats} data={data} />}
    </PageContainer>
  );
}

/** Nothing indexed yet: one decision to make — your documents, or the demo. */
function FirstRun() {
  return (
    <div className="space-y-6">
      <div className="bg-card relative overflow-hidden rounded-2xl border p-8">
        <div className="bg-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)] opacity-40" />
        <div className="relative max-w-xl space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Start with your own documents — or the demo</h2>
          <p className="text-muted-foreground text-sm">
            Add a resume and anything that describes your work: project reports, notes, a job description. They are parsed and indexed in
            this browser and never uploaded. The demo loads six fictional documents so you can try everything in a minute; it is removed
            again when you close the site.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <LoadDemoButton variant="default" />
            <Button asChild variant="outline">
              <Link href="/documents">
                <FileUp /> Add my documents
              </Link>
            </Button>
          </div>
        </div>
      </div>
      <Steps done={0} />
    </div>
  );
}

/** The three steps, with the one you are on highlighted. */
function Steps({ done }: { done: number }) {
  const steps = [
    { title: "Add your documents", text: "Resume, project reports, notes, a job description." },
    { title: "Ask questions", text: "What your documents actually say — with citations." },
    { title: "Practise answering", text: "Mock interview, scored against your own evidence." },
  ];
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {steps.map((s, i) => {
        const state = i < done ? "done" : i === done ? "current" : "todo";
        return (
          <li
            key={s.title}
            className={
              state === "current"
                ? "border-brand/40 bg-brand/5 rounded-xl border p-4"
                : "bg-card rounded-xl border p-4" + (state === "todo" ? " opacity-70" : "")
            }
          >
            <div className="flex items-center gap-2">
              <span
                className={
                  state === "done"
                    ? "bg-success/15 text-success grid size-5 shrink-0 place-items-center rounded-full text-xs font-medium"
                    : state === "current"
                      ? "bg-brand text-brand-foreground grid size-5 shrink-0 place-items-center rounded-full text-xs font-medium"
                      : "bg-muted text-muted-foreground grid size-5 shrink-0 place-items-center rounded-full text-xs font-medium"
                }
              >
                {state === "done" ? <Check className="size-3" /> : i + 1}
              </span>
              <p className="text-sm font-medium">{s.title}</p>
            </div>
            <p className="text-muted-foreground mt-1.5 pl-7 text-xs">{s.text}</p>
          </li>
        );
      })}
    </ol>
  );
}

const MORE_TOOLS = [
  { href: "/prep/resume", icon: ScanSearch, title: "Resume X-ray", text: "Which claims will be challenged" },
  { href: "/jd", icon: Target, title: "Job match", text: "You against a job description" },
  { href: "/prep/project", icon: FolderGit2, title: "Project deep dive", text: "Explain a project at five depths" },
  { href: "/prep/questions", icon: ListChecks, title: "Question generator", text: "Tailored questions to rehearse" },
  { href: "/prep/star", icon: Star, title: "STAR builder", text: "Behavioural answers from evidence" },
  { href: "/prep/consistency", icon: GitCompareArrows, title: "Consistency checker", text: "Numbers that disagree" },
];

function Ready({ stats, data }: { stats: KbStats; data: DashboardData }) {
  const { score, parts, steps, weakAreas } = computeReadiness(stats, data);
  const practised = data.sessions.filter((s) => s.status === "completed").length;
  const asked = data.recent.length;
  const done = practised > 0 ? 3 : asked > 0 ? 2 : 1;

  return (
    <div className="space-y-6">
      <DemoNotice />
      <Steps done={done} />

      {/* The two things this app is for. */}
      <div className="grid gap-4 md:grid-cols-2">
        <PrimaryCard
          href="/ask"
          icon={MessagesSquare}
          title="Ask your documents"
          text="“How did I handle class imbalance?” Answers quote your own passages, and say so when the evidence is not there."
          cta="Ask a question"
        />
        <PrimaryCard
          href="/mock"
          icon={UsersRound}
          title="Practise an interview"
          text="Five questions drawn from your documents, with rubric feedback and a check for claims your evidence does not support."
          cta="Start practising"
        />
      </div>

      {steps[0] && (
        <Link
          href={steps[0].href}
          className="group bg-card hover:bg-muted/50 flex items-center gap-3 rounded-xl border p-4 transition-colors"
        >
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Next</span>
          <span className="min-w-0 flex-1">
            <span className="text-sm font-medium">{steps[0].title}</span>
            <span className="text-muted-foreground ml-2 text-xs">{steps[0].text}</span>
          </span>
          <ArrowRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">More tools</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MORE_TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="group bg-card hover:bg-muted/50 flex items-start gap-3 rounded-lg border p-3 transition-colors"
            >
              <t.icon className="text-muted-foreground group-hover:text-brand mt-0.5 size-4 shrink-0 transition-colors" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.title}</span>
                <span className="text-muted-foreground block text-xs">{t.text}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-sm">
          <span>
            Your progress · <span className="text-foreground font-medium">{score}/100</span> readiness
            {practised ? ` · ${practised} mock interview${practised === 1 ? "" : "s"}` : ""}
          </span>
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="bg-card space-y-3 rounded-xl border p-5 lg:col-span-2">
              <p className="text-muted-foreground text-xs">
                A rough guide combining document coverage, review and practice — not a prediction.
              </p>
              {parts.map((p) => (
                <div key={p.label} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{p.label}</span>
                    <span className="text-muted-foreground text-xs">{p.detail}</span>
                  </div>
                  <ScoreBar value={p.value} tone="auto" label={`${p.label}: ${Math.round(p.value * 100)}%`} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              <StatTile label="Documents" value={stats.ready} hint={stats.processing ? `${stats.processing} indexing` : "indexed"} />
              <StatTile label="Chunks" value={stats.chunks} hint="searchable passages" />
            </div>
          </div>
          {weakAreas.length > 0 && (
            <div className="bg-card mt-4 rounded-xl border p-5">
              <p className="text-sm font-medium">Weak areas</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {weakAreas.map((w) => (
                  <div key={w.label} className="bg-muted/50 rounded-lg p-3">
                    <p className="text-sm font-medium">{w.label}</p>
                    <p className="text-muted-foreground text-xs">{w.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="text-muted-foreground mt-4 flex flex-wrap gap-4 text-xs">
            <Link href="/lab" className="hover:text-foreground flex items-center gap-1.5">
              <FlaskConical className="size-3.5" /> Retrieval playground
            </Link>
            <Link href="/evaluation" className="hover:text-foreground flex items-center gap-1.5">
              <Gauge className="size-3.5" /> How this system is evaluated
            </Link>
            <Link href="/prep" className="hover:text-foreground flex items-center gap-1.5">
              <ClipboardList className="size-3.5" /> All prep tools
            </Link>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function PrimaryCard({
  href,
  icon: Icon,
  title,
  text,
  cta,
}: {
  href: string;
  icon: typeof MessagesSquare;
  title: string;
  text: string;
  cta: string;
}) {
  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-5">
      <Icon className="text-brand size-5" />
      <div className="flex-1 space-y-1">
        <p className="font-semibold tracking-tight">{title}</p>
        <p className="text-muted-foreground text-sm">{text}</p>
      </div>
      <Button asChild className="self-start">
        <Link href={href}>
          {cta} <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

interface ReadinessPart {
  label: string;
  value: number;
  weight: number;
  detail: string;
}

function computeReadiness(stats: KbStats, data: DashboardData) {
  const has = (t: string) => (stats.byType[t] ?? 0) > 0;
  const xray = data.analyses.find((a) => a.kind === "resume-xray")?.result as { stats?: { claims: number; high: number } } | undefined;
  const jd = data.analyses
    .filter((a) => a.kind === "jd-match")
    .map((a) => a.result as { coverage: number; gaps: string[] })
    .sort((a, b) => b.coverage - a.coverage)[0];
  const completed = data.sessions.filter((s) => s.status === "completed" && s.summary);
  const avgMock = completed.length ? completed.reduce((n, s) => n + (s.summary?.overall ?? 0), 0) / completed.length : 0;
  const confident = data.questions.filter((q) => q.status === "confident").length;

  const parts: ReadinessPart[] = [
    {
      label: "Documents",
      weight: 20,
      value:
        (has("resume") ? 0.4 : 0) +
        (has("project_report") || has("notes") || has("internship") ? 0.3 : 0) +
        (has("job_description") ? 0.3 : 0),
      detail: `${stats.ready} indexed`,
    },
    {
      label: "Resume reviewed",
      weight: 20,
      value: xray?.stats ? 0.5 + 0.5 * (1 - xray.stats.high / Math.max(1, xray.stats.claims)) : 0,
      detail: xray?.stats ? `${xray.stats.high} high-risk claims` : "not run yet",
    },
    {
      label: "Job fit",
      weight: 20,
      value: jd?.coverage ?? 0,
      detail: jd ? `${Math.round(jd.coverage * 100)}% of requirements covered` : "no job description matched",
    },
    {
      label: "Practice",
      weight: 30,
      value: (avgMock / 10) * Math.min(1, completed.length / 2),
      detail: completed.length ? `${completed.length} interview(s), avg ${avgMock.toFixed(1)}/10` : "none yet",
    },
    {
      label: "Question bank",
      weight: 10,
      value: confident / Math.max(5, data.questions.length),
      detail: `${confident} of ${data.questions.length} confident`,
    },
  ];
  const score = Math.round(parts.reduce((n, p) => n + p.value * p.weight, 0));

  const dims = RUBRIC.map((r) => {
    const scored = completed.flatMap((s) => s.turns).filter((t) => t.evaluation);
    return {
      label: r.label,
      avg: scored.length ? scored.reduce((n, t) => n + (t.evaluation!.scores[r.id] ?? 0), 0) / scored.length : 0,
      n: scored.length,
    };
  }).filter((d) => d.n > 0);
  const weakDims = [...dims].sort((a, b) => a.avg - b.avg).slice(0, 2);

  const steps: { title: string; text: string; href: string }[] = [];
  if (!has("resume")) steps.push({ title: "Add your resume", text: "Everything else builds on it.", href: "/documents" });
  if (!data.recent.length) steps.push({ title: "Ask your first question", text: "See how answers cite your documents.", href: "/ask" });
  if (!xray) steps.push({ title: "Run the Resume X-ray", text: "Find the claims interviewers will challenge.", href: "/prep/resume" });
  else if (xray.stats && xray.stats.high > 0)
    steps.push({
      title: `Prepare ${xray.stats.high} high-risk claim(s)`,
      text: "Unclear ownership and expert claims get probed first.",
      href: "/prep/resume",
    });
  if (!has("job_description")) steps.push({ title: "Add a target job description", text: "Then see how you match it.", href: "/jd" });
  else if (!jd) steps.push({ title: "Compare yourself with the job description", text: "Strong, partial and missing.", href: "/jd" });
  if (!completed.length) steps.push({ title: "Do your first mock interview", text: "Five questions, about 15 minutes.", href: "/mock" });
  else if (weakDims[0])
    steps.push({
      title: `Practise ${weakDims[0].label.toLowerCase()}`,
      text: `Your weakest rubric area (${weakDims[0].avg.toFixed(1)}/5).`,
      href: "/mock",
    });

  const weakAreas = [
    ...weakDims.map((d) => ({ label: d.label, detail: `Mock interview average ${d.avg.toFixed(1)}/5` })),
    ...(jd?.gaps ?? []).slice(0, 3).map((g) => ({ label: g, detail: "Required by the job description, not found in your documents" })),
  ];
  return { score, parts, steps, weakAreas };
}
