"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Check, CircleDashed, FileUp, MessagesSquare, ScanSearch, Target, UsersRound } from "lucide-react";
import { DocTypeBadge } from "@/components/common/doc-type";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { ScoreBar } from "@/components/common/score-bar";
import { StatTile } from "@/components/common/severity";
import { LoadDemoButton } from "@/components/documents/demo-button";
import { Button } from "@/components/ui/button";
import { useKbStats, type KbStats } from "@/hooks/use-kb";
import { loadDemoWorkspace } from "@/lib/client/documents";
import { useSettings } from "@/lib/client/settings";
import type { MockSessionRecord, SavedAnalysis, SavedQuestion } from "@/lib/db/records";
import { getDb, type MessageRecord } from "@/lib/db/schema";
import { formatRelative } from "@/lib/format";
import { DOC_TYPES } from "@/lib/rag/types";
import { RUBRIC } from "@/lib/workflows/mock";

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}

interface DashboardData {
  analyses: SavedAnalysis[];
  sessions: MockSessionRecord[];
  questions: SavedQuestion[];
  recent: MessageRecord[];
}

function Dashboard() {
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

  if (!stats || !data) return <PageContainer />;

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="Your interview readiness, based on what you have analysed and practised so far."
        actions={
          stats.documents > 0 && (
            <>
              <Button asChild variant="outline">
                <Link href="/ask">
                  <MessagesSquare /> Ask
                </Link>
              </Button>
              <Button asChild>
                <Link href="/mock">
                  <UsersRound /> Start mock interview
                </Link>
              </Button>
            </>
          )
        }
      />
      {stats.documents === 0 ? <Onboarding /> : <Overview stats={stats} data={data} />}
    </PageContainer>
  );
}

function Onboarding() {
  const steps = [
    {
      icon: FileUp,
      title: "1 · Add your documents",
      text: "Resume, project reports, notes and a target job description. Parsed and embedded in your browser.",
    },
    {
      icon: ScanSearch,
      title: "2 · Analyse",
      text: "See which claims interviewers will challenge, how you match the job, and where your stories are thin.",
    },
    { icon: UsersRound, title: "3 · Practise", text: "Mock interviews with rubric feedback checked against your own documents." },
  ];
  return (
    <div className="space-y-6">
      <div className="bg-card relative overflow-hidden rounded-2xl border p-8">
        <div className="bg-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)] opacity-40" />
        <div className="relative max-w-xl space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Start with your own documents — or the demo</h2>
          <p className="text-muted-foreground text-sm">
            The demo workspace loads six fictional documents for “Alex Rivera” (resume, internship report, project notes, behavioural notes,
            a job description and company research) so you can try every feature in a minute.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <LoadDemoButton variant="default" />
            <Button asChild variant="outline">
              <Link href="/documents">
                <FileUp /> Upload documents
              </Link>
            </Button>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.title} className="bg-card rounded-xl border p-5">
            <s.icon className="text-brand size-5" />
            <p className="mt-3 font-medium">{s.title}</p>
            <p className="text-muted-foreground mt-1 text-sm">{s.text}</p>
          </div>
        ))}
      </div>
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
      label: "Knowledge base",
      weight: 20,
      value:
        (has("resume") ? 0.4 : 0) +
        (has("project_report") || has("notes") || has("internship") ? 0.3 : 0) +
        (has("job_description") ? 0.3 : 0),
      detail: `${stats.ready} documents indexed`,
    },
    {
      label: "Resume reviewed",
      weight: 20,
      value: xray?.stats ? 0.5 + 0.5 * (1 - xray.stats.high / Math.max(1, xray.stats.claims)) : 0,
      detail: xray?.stats ? `${xray.stats.high} high-risk claims` : "Run the Resume X-ray",
    },
    {
      label: "Job fit",
      weight: 20,
      value: jd?.coverage ?? 0,
      detail: jd ? `${Math.round(jd.coverage * 100)}% JD coverage` : "Run a JD match",
    },
    {
      label: "Practice",
      weight: 30,
      value: (avgMock / 10) * Math.min(1, completed.length / 2),
      detail: completed.length ? `${completed.length} mock interview(s), avg ${avgMock.toFixed(1)}/10` : "No mock interviews yet",
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
  if (!has("job_description")) steps.push({ title: "Add a target job description", text: "Paste it from the careers page.", href: "/jd" });
  if (!xray) steps.push({ title: "Run the Resume X-ray", text: "Find the claims interviewers will challenge.", href: "/prep/resume" });
  else if (xray.stats && xray.stats.high > 0)
    steps.push({
      title: `Prepare ${xray.stats.high} high-risk claim(s)`,
      text: "Unclear ownership and expert claims get probed first.",
      href: "/prep/resume",
    });
  if (has("job_description") && !jd)
    steps.push({ title: "Compare yourself with the JD", text: "See strong, partial and missing requirements.", href: "/jd" });
  if (!completed.length)
    steps.push({ title: "Do your first mock interview", text: "Five questions, rubric feedback, about 15 minutes.", href: "/mock" });
  else if (weakDims[0])
    steps.push({
      title: `Practise ${weakDims[0].label.toLowerCase()}`,
      text: `Your weakest rubric area (${weakDims[0].avg.toFixed(1)}/5).`,
      href: "/mock",
    });
  const fresh = data.questions.filter((q) => q.status !== "confident").length;
  if (fresh)
    steps.push({
      title: `Review ${fresh} saved question(s)`,
      text: "Mark the ones you can answer confidently.",
      href: "/prep/questions#bank",
    });

  const weakAreas = [
    ...weakDims.map((d) => ({ label: d.label, detail: `Mock interview average ${d.avg.toFixed(1)}/5` })),
    ...(jd?.gaps ?? []).slice(0, 3).map((g) => ({ label: g, detail: "Required by the JD, not found in your documents" })),
  ];
  return { score, parts, steps: steps.slice(0, 4), weakAreas };
}

function Overview({ stats, data }: { stats: KbStats; data: DashboardData }) {
  const { score, parts, steps, weakAreas } = computeReadiness(stats, data);
  const completed = data.sessions.filter((s) => s.status === "completed").length;
  const confident = data.questions.filter((q) => q.status === "confident").length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="bg-card rounded-xl border p-5 lg:col-span-2">
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="shrink-0">
              <p className="text-muted-foreground text-xs font-medium">Interview readiness</p>
              <p className="mt-1 text-6xl font-semibold tracking-tight">
                {score}
                <span className="text-muted-foreground text-xl font-medium">/100</span>
              </p>
              <p className="text-muted-foreground mt-1 max-w-44 text-xs">
                A rough guide combining coverage, review and practice — not a prediction.
              </p>
            </div>
            <div className="flex-1 space-y-3">
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
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Documents" value={stats.ready} hint={stats.processing ? `${stats.processing} processing` : "indexed"} />
          <StatTile label="Chunks" value={stats.chunks} hint="searchable passages" />
          <StatTile label="Mock interviews" value={completed} hint="completed" />
          <StatTile label="Confident answers" value={confident} hint={`of ${data.questions.length} saved`} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card rounded-xl border p-5">
          <p className="font-semibold tracking-tight">Recommended next steps</p>
          <div className="mt-3 space-y-2">
            {steps.length ? (
              steps.map((s) => (
                <Link
                  key={s.title}
                  href={s.href}
                  className="group hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-3 transition-colors"
                >
                  <CircleDashed className="text-brand size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-muted-foreground text-xs">{s.text}</p>
                  </div>
                  <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">You have covered the essentials. Keep practising with harder mock interviews.</p>
            )}
          </div>
        </div>
        <div className="bg-card rounded-xl border p-5">
          <p className="font-semibold tracking-tight">Weak areas</p>
          <div className="mt-3 space-y-2">
            {weakAreas.length ? (
              weakAreas.map((w) => (
                <div key={w.label} className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm font-medium">{w.label}</p>
                  <p className="text-muted-foreground text-xs">{w.detail}</p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">Weak areas appear after a JD match or a mock interview.</p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/jd">
                <Target /> JD match
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/prep/resume">
                <ScanSearch /> Resume X-ray
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card rounded-xl border p-5">
          <p className="font-semibold tracking-tight">Recent questions</p>
          <div className="mt-3 divide-y">
            {data.recent.length ? (
              data.recent.map((m) => (
                <Link key={m.id} href="/ask" className="hover:text-brand flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate">{m.content}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{formatRelative(m.createdAt)}</span>
                </Link>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">Questions you ask appear here.</p>
            )}
          </div>
        </div>
        <div className="bg-card rounded-xl border p-5">
          <p className="font-semibold tracking-tight">Knowledge base coverage</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DOC_TYPES.filter((t) => t !== "other").map((t) => {
              const n = stats.byType[t] ?? 0;
              return (
                <div key={t} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <DocTypeBadge type={t} />
                  {n ? (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Check className="text-success size-3.5" /> {n}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
