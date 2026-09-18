"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookmarkPlus,
  CircleAlert,
  Clock,
  Flag,
  Loader2,
  Play,
  RotateCcw,
  SkipForward,
  Trophy,
} from "lucide-react";
import { CitedText, SourceChips } from "@/components/common/cited-text";
import { GeneratingNote, LlmFallbackNotice, RequireDocuments } from "@/components/common/feature-states";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { ScoreBar, ScoreRing } from "@/components/common/score-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { saveQuestion } from "@/lib/client/question-bank";
import { useSettings } from "@/lib/client/settings";
import { fallbackReason } from "@/lib/workflows/common";
import type { Difficulty, MockSessionRecord, MockTurn } from "@/lib/db/records";
import { getDb } from "@/lib/db/schema";
import { formatRelative, newId, capitalise } from "@/lib/format";
import type { DetectedProject } from "@/lib/rag/analysis/projects";
import type { BuiltContext } from "@/lib/rag/generation/context";
import { cn } from "@/lib/utils";
import { listProjects } from "@/lib/workflows/deep-dive";
import {
  RUBRIC,
  adaptDifficulty,
  evaluateAnswer,
  nextQuestion,
  type DeliveryStats,
  type MockConfig,
  type MockFocus,
} from "@/lib/workflows/mock";

export default function MockInterviewPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Practise"
        title="Mock interview"
        description="The interviewer asks questions grounded in your documents, scores each answer on a rubric, checks your claims against your own documents, and adapts the difficulty."
      />
      <RequireDocuments what="mock interviews">
        <MockInterview />
      </RequireDocuments>
    </PageContainer>
  );
}

interface LiveTurnState {
  whyAsked: string;
  context: BuiltContext;
  evalContext?: BuiltContext;
  stats?: DeliveryStats;
}

function MockInterview() {
  const settings = useSettings();
  const sessions = useLiveQuery(() => getDb().mockSessions.orderBy("createdAt").reverse().toArray(), []);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const session = sessions?.find((s) => s.id === sessionId) ?? null;
  const [config, setConfig] = useState<MockConfig | null>(null);
  const [live, setLive] = useState<Record<number, LiveTurnState>>({});
  const [busy, setBusy] = useState<"question" | "evaluate" | null>(null);
  const [chars, setChars] = useState<number | null>(null);

  const persist = persistSession;

  async function start(cfg: MockConfig) {
    const record = await createSession(cfg);
    setConfig(cfg);
    setLive({});
    setSessionId(record.id);
    await ask(record, cfg, cfg.startDifficulty);
  }

  async function ask(record: MockSessionRecord, cfg: MockConfig, difficulty: Difficulty) {
    setBusy("question");
    try {
      const q = await nextQuestion(cfg, record.turns, difficulty, settings);
      if (q.error) toast.warning("Using a template question", { description: `${capitalise(fallbackReason(q.error))}.` });
      const turns = [...record.turns, q.turn];
      setLive((l) => ({ ...l, [turns.length - 1]: { whyAsked: q.whyAsked, context: q.context } }));
      await persist({ ...record, turns });
    } catch (error) {
      toast.error("Could not generate a question", { description: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function submit(answer: string) {
    if (!session) return;
    const index = session.turns.length - 1;
    const turn = session.turns[index];
    setBusy("evaluate");
    setChars(0);
    try {
      const result = await evaluateAnswer(turn, answer, settings, setChars);
      if (result.error) toast.warning("Heuristic scoring only", { description: `${capitalise(fallbackReason(result.error))}.` });
      const turns = session.turns.map((t, i) => (i === index ? { ...t, answer, evaluation: result.evaluation } : t));
      setLive((l) => ({ ...l, [index]: { ...l[index], evalContext: result.context, stats: result.stats } }));
      await persist({ ...session, turns });
    } finally {
      setBusy(null);
      setChars(null);
    }
  }

  async function next() {
    if (!session) return;
    const cfg = config ?? (JSON.parse(session.focus) as MockConfig);
    const last = session.turns.at(-1);
    const difficulty = last?.evaluation ? adaptDifficulty(last.difficulty, last.evaluation.overall) : cfg.startDifficulty;
    if (session.turns.length >= cfg.length) {
      await finish(session);
      return;
    }
    await ask(session, cfg, difficulty);
  }

  async function finish(record: MockSessionRecord) {
    const scored = record.turns.filter((t) => t.evaluation);
    const overall = scored.length ? scored.reduce((n, t) => n + t.evaluation!.overall, 0) / scored.length : 0;
    const dims = RUBRIC.map((r) => ({
      id: r.id,
      avg: scored.length ? scored.reduce((n, t) => n + (t.evaluation!.scores[r.id] ?? 0), 0) / scored.length : 0,
    }));
    const sortedDims = [...dims].sort((a, b) => b.avg - a.avg);
    await persist({
      ...record,
      status: "completed",
      summary: {
        overall: Math.round(overall * 10) / 10,
        strengths: sortedDims.slice(0, 2).map((d) => RUBRIC.find((r) => r.id === d.id)!.label),
        focusAreas: sortedDims.slice(-2).map((d) => RUBRIC.find((r) => r.id === d.id)!.label),
      },
    });
  }

  if (!session)
    return (
      <Setup
        onStart={(cfg) => void start(cfg)}
        sessions={sessions ?? []}
        onOpen={(id) => setSessionId(id)}
        starting={busy === "question"}
      />
    );

  const cfg = config ?? (JSON.parse(session.focus) as MockConfig);
  if (session.status === "completed") return <Summary session={session} onNew={() => setSessionId(null)} />;

  const index = session.turns.length - 1;
  const turn = session.turns[index];
  return (
    <div className="space-y-5">
      <LlmFallbackNotice feature="The mock interview" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium">
            Question {Math.max(1, session.turns.length)} of {cfg.length}
          </p>
          <div className="flex gap-1">
            {Array.from({ length: cfg.length }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 w-6 rounded-full",
                  i < session.turns.length - (turn?.evaluation ? 0 : 1) ? "bg-brand" : i === index ? "bg-brand/40" : "bg-muted",
                )}
              />
            ))}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void finish(session)}>
          <Flag /> End interview
        </Button>
      </div>

      {!turn || busy === "question" ? (
        <GeneratingNote label="The interviewer is preparing a question from your documents…" />
      ) : (
        <TurnView
          key={index}
          turn={turn}
          live={live[index]}
          busy={busy === "evaluate"}
          chars={chars}
          isLast={session.turns.length >= cfg.length}
          onSubmit={(a) => void submit(a)}
          onNext={() => void next()}
        />
      )}
    </div>
  );
}

function labelFor(focus: MockFocus): string {
  return { profile: "Full profile", technical: "Technical", behavioral: "Behavioural", project: "Project" }[focus];
}

async function persistSession(next: MockSessionRecord) {
  await getDb().mockSessions.put({ ...next, updatedAt: Date.now() });
}

async function createSession(cfg: MockConfig): Promise<MockSessionRecord> {
  const now = Date.now();
  const record: MockSessionRecord = {
    id: newId(),
    title: cfg.topic ? `${labelFor(cfg.focus)}: ${cfg.topic}` : labelFor(cfg.focus),
    focus: JSON.stringify(cfg),
    status: "active",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
  await getDb().mockSessions.add(record);
  return record;
}

function Setup({
  onStart,
  sessions,
  onOpen,
  starting,
}: {
  onStart: (c: MockConfig) => void;
  sessions: MockSessionRecord[];
  onOpen: (id: string) => void;
  starting: boolean;
}) {
  const [focus, setFocus] = useState<MockFocus>("profile");
  const [topic, setTopic] = useState<string>("");
  const [length, setLength] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [projects, setProjects] = useState<DetectedProject[]>([]);

  useEffect(() => {
    void listProjects().then(setProjects);
  }, []);

  const FOCI: { id: MockFocus; title: string; description: string }[] = [
    { id: "profile", title: "Full profile", description: "A mix across your whole background" },
    { id: "technical", title: "Technical", description: "Tools, models and implementation" },
    { id: "behavioral", title: "Behavioural", description: "Teamwork, conflict, ownership" },
    { id: "project", title: "One project", description: "A deep dive into a single project" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="bg-card space-y-5 rounded-xl border p-5">
        <div className="grid gap-2">
          <Label>Interview focus</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {FOCI.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFocus(f.id)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  focus === f.id ? "border-brand bg-brand/5 ring-brand/15 ring-2" : "hover:bg-muted/50",
                )}
              >
                <p className="text-sm font-medium">{f.title}</p>
                <p className="text-muted-foreground text-xs">{f.description}</p>
              </button>
            ))}
          </div>
        </div>
        {focus === "project" && (
          <div className="grid gap-2">
            <Label>Project</Label>
            <Select value={topic} onValueChange={setTopic}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>
              Questions <span className="text-muted-foreground tabular-nums">· {length}</span>
            </Label>
            <Slider min={3} max={8} step={1} value={[length]} onValueChange={([v]) => setLength(v)} className="mt-2" />
          </div>
          <div className="grid gap-2">
            <Label>Starting difficulty</Label>
            <ToggleGroup type="single" variant="outline" value={difficulty} onValueChange={(v) => v && setDifficulty(v as Difficulty)}>
              <ToggleGroupItem value="easy">Easy</ToggleGroupItem>
              <ToggleGroupItem value="medium">Medium</ToggleGroupItem>
              <ToggleGroupItem value="hard">Hard</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Difficulty adapts: a strong answer makes the next question harder, a weak one makes it easier.
        </p>
        <Button
          onClick={() =>
            onStart({ focus, topic: focus === "project" ? topic || undefined : undefined, length, startDifficulty: difficulty })
          }
          disabled={starting || (focus === "project" && !topic)}
        >
          {starting ? <Loader2 className="animate-spin" /> : <Play />} Start interview
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Past sessions</p>
        {sessions.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
            Your completed interviews and scores will appear here.
          </p>
        ) : (
          sessions.slice(0, 8).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpen(s.id)}
              className="bg-card hover:border-foreground/20 flex w-full items-center gap-3 rounded-lg border p-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.title}</p>
                <p className="text-muted-foreground text-[11px]">
                  {s.turns.length} questions · {formatRelative(s.createdAt)} · {s.status === "active" ? "in progress" : "completed"}
                </p>
              </div>
              {s.summary && <span className="text-sm font-semibold tabular-nums">{s.summary.overall.toFixed(1)}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function TurnView({
  turn,
  live,
  busy,
  chars,
  isLast,
  onSubmit,
  onNext,
}: {
  turn: MockTurn;
  live?: LiveTurnState;
  busy: boolean;
  chars: number | null;
  isLast: boolean;
  onSubmit: (answer: string) => void;
  onNext: () => void;
}) {
  const [answer, setAnswer] = useState(turn.answer ?? "");
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  useEffect(() => {
    if (turn.evaluation) return;
    started.current = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [turn.evaluation]);

  const sources = live?.context.sources.map((s) => s.result) ?? [];
  const evidenceNums = turn.evidenceChunkIds.map((id) => sources.findIndex((s) => s.chunk.id === id) + 1).filter((n) => n > 0);

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="capitalize">
            {turn.category.replace("_", " ")}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {turn.difficulty}
          </Badge>
        </div>
        <p className="text-lg leading-snug font-medium tracking-tight">
          {turn.question} <SourceChips nums={evidenceNums} sources={sources} />
        </p>
        {live?.whyAsked && <p className="text-muted-foreground mt-2 text-sm">Why this question: {live.whyAsked}</p>}
      </div>

      {!turn.evaluation ? (
        <div className="space-y-2">
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer as you would say it. Aim for 1–2 minutes (150–300 words)."
            className="min-h-44 text-[0.95rem] leading-relaxed"
            disabled={busy}
          />
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground flex items-center gap-3 text-xs tabular-nums">
              <span>{words} words</span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" /> {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              </span>
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onSubmit("(skipped)")} disabled={busy}>
                <SkipForward /> Skip
              </Button>
              <Button onClick={() => onSubmit(answer)} disabled={busy || words < 5}>
                {busy ? <Loader2 className="animate-spin" /> : null} Submit answer
              </Button>
            </div>
          </div>
          {busy && <GeneratingNote label="Scoring your answer and checking it against your documents…" chars={chars ?? undefined} />}
        </div>
      ) : (
        <Feedback turn={turn} live={live} isLast={isLast} onNext={onNext} />
      )}
    </div>
  );
}

function Feedback({ turn, live, isLast, onNext }: { turn: MockTurn; live?: LiveTurnState; isLast: boolean; onNext: () => void }) {
  const ev = turn.evaluation!;
  const nextDifficulty = adaptDifficulty(turn.difficulty, ev.overall);
  const sources = live?.evalContext?.sources.map((s) => s.result) ?? [];
  return (
    <div className="space-y-4">
      <div className="bg-muted/30 rounded-xl border p-4">
        <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">Your answer</p>
        <p className="text-sm whitespace-pre-wrap">{turn.answer}</p>
      </div>
      <div className="bg-card grid gap-4 rounded-xl border p-5 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-1">
          <ScoreRing value={ev.overall / 10} size={88} label="/ 10" display={ev.overall.toFixed(1)} />
          <p className="text-muted-foreground text-xs">overall score</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {RUBRIC.map((r) => (
            <div key={r.id} title={r.description} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>{r.label}</span>
                <span className="font-medium tabular-nums">{ev.scores[r.id]}/5</span>
              </div>
              <ScoreBar value={(ev.scores[r.id] ?? 0) / 5} tone="auto" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-card rounded-xl border p-4">
          <p className="text-success mb-2 text-sm font-medium">What worked</p>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {ev.strengths.length ? ev.strengths.map((s, i) => <li key={i}>{s}</li>) : <li className="text-muted-foreground">—</li>}
          </ul>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-warning mb-2 text-sm font-medium">How to improve</p>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {ev.improvements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>

      {ev.unsupportedClaims.length > 0 && (
        <div className="border-warning/30 bg-warning/5 rounded-xl border p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlert className="text-warning size-4" /> Claims not backed by your documents
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-6">
            {ev.unsupportedClaims.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-2 text-xs">
            Sentences from your answer that no passage in your documents supports (checked by meaning, shared wording and numbers). They may
            be true — just be ready to back them up, since the interviewer can&apos;t see them on paper.
          </p>
        </div>
      )}

      {ev.betterAnswerOutline && (
        <div className="bg-card rounded-xl border p-4">
          <p className="mb-2 text-sm font-medium">A stronger answer would cover</p>
          <CitedText text={ev.betterAnswerOutline} sources={sources} />
        </div>
      )}

      {live?.stats && <DeliveryView stats={live.stats} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {nextDifficulty !== turn.difficulty &&
            (["easy", "medium", "hard"].indexOf(nextDifficulty) > ["easy", "medium", "hard"].indexOf(turn.difficulty) ? (
              <span className="text-success flex items-center gap-1">
                <ArrowUp className="size-3" /> Next question will be harder
              </span>
            ) : (
              <span className="text-warning flex items-center gap-1">
                <ArrowDown className="size-3" /> Next question will be easier
              </span>
            ))}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={async () => {
              const added = await saveQuestion({
                question: turn.question,
                category: turn.category,
                difficulty: turn.difficulty,
                origin: "Mock interview",
              });
              toast[added ? "success" : "info"](added ? "Saved for more practice" : "Already saved");
            }}
          >
            <BookmarkPlus /> Practise later
          </Button>
          <Button onClick={onNext}>
            {isLast ? "Finish interview" : "Next question"} <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeliveryView({ stats }: { stats: DeliveryStats }) {
  const items = [
    {
      label: "Words",
      value: stats.words,
      hint: stats.words < 80 ? "a bit short" : stats.words > 350 ? "long — tighten it" : "good length",
    },
    {
      label: "Speaking time",
      value: `~${Math.floor(stats.speakingSeconds / 60)}:${String(stats.speakingSeconds % 60).padStart(2, "0")}`,
      hint: "at 140 words/min",
    },
    { label: "Numbers used", value: stats.numbers, hint: stats.numbers ? "specific" : "add a metric" },
    { label: "Filler words", value: stats.fillers, hint: stats.fillers > 3 ? "reduce" : "fine" },
    {
      label: "“I” vs “we”",
      value: `${Math.round(stats.firstPersonRatio * 100)}%`,
      hint: stats.firstPersonRatio < 0.4 ? "clarify your role" : "clear ownership",
    },
    { label: "STAR signals", value: `${stats.starSignals}/4`, hint: "situation · task · action · result" },
  ];
  return (
    <div className="bg-card rounded-xl border p-4">
      <p className="mb-3 text-sm font-medium">Delivery (measured, not AI-judged)</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((i) => (
          <div key={i.label}>
            <p className="text-muted-foreground text-[11px]">{i.label}</p>
            <p className="text-lg font-semibold tabular-nums">{i.value}</p>
            <p className="text-muted-foreground text-[10.5px]">{i.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Summary({ session, onNew }: { session: MockSessionRecord; onNew: () => void }) {
  const scored = session.turns.filter((t) => t.evaluation);
  const dims = useMemo(
    () =>
      RUBRIC.map((r) => ({
        ...r,
        avg: scored.length ? scored.reduce((n, t) => n + (t.evaluation!.scores[r.id] ?? 0), 0) / scored.length : 0,
      })),
    [scored],
  );
  const overall = session.summary?.overall ?? 0;
  return (
    <div className="space-y-5">
      <div className="bg-card flex flex-col items-center gap-3 rounded-xl border p-6 text-center">
        <Trophy className="text-brand size-6" />
        <p className="text-lg font-semibold tracking-tight">Interview complete — {session.title}</p>
        <ScoreRing value={overall / 10} size={96} label="/ 10" display={overall.toFixed(1)} />
        <p className="text-muted-foreground text-sm">
          Strongest: {session.summary?.strengths.join(", ")} · Work on: {session.summary?.focusAreas.join(", ")}
        </p>
      </div>
      <div className="bg-card grid gap-3 rounded-xl border p-5 sm:grid-cols-2">
        {dims.map((d) => (
          <div key={d.id} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{d.label}</span>
              <span className="font-medium tabular-nums">{d.avg.toFixed(1)}/5</span>
            </div>
            <ScoreBar value={d.avg / 5} tone="auto" />
          </div>
        ))}
      </div>
      <div className="bg-card divide-y rounded-xl border">
        {session.turns.map((t, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <span className="text-muted-foreground text-xs tabular-nums">Q{i + 1}</span>
            <p className="flex-1 text-sm">{t.question}</p>
            <Badge variant="outline" className="capitalize">
              {t.difficulty}
            </Badge>
            <span className="w-10 text-right text-sm font-semibold tabular-nums">{t.evaluation?.overall.toFixed(1) ?? "–"}</span>
          </div>
        ))}
      </div>
      <Button onClick={onNew}>
        <RotateCcw /> New interview
      </Button>
    </div>
  );
}
