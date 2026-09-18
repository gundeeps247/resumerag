"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { BookmarkPlus, Check, Loader2, Sparkle, Square, X } from "lucide-react";
import { CitedText, EvidenceDisclosure, SourceChips } from "@/components/common/cited-text";
import { GeneratingNote, LlmFallbackNotice, RequireDocuments } from "@/components/common/feature-states";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveQuestion } from "@/lib/client/question-bank";
import { useSettings } from "@/lib/client/settings";
import type { DetectedProject } from "@/lib/rag/analysis/projects";
import { cn } from "@/lib/utils";
import {
  EXPLANATION_LEVELS,
  generateQuestionLadder,
  listProjects,
  prepareProject,
  streamExplanation,
  type ExplanationLevel,
  type LadderQuestion,
  type ProjectBrief,
} from "@/lib/workflows/deep-dive";

export default function ProjectDeepDivePage() {
  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Prep tools"
        title="Project deep dive"
        description="Pick a project or role. See what your documents actually say about it, explain it at five levels of depth, and practise progressively harder follow-ups."
      />
      <RequireDocuments what="project deep dives">
        <Suspense>
          <DeepDive />
        </Suspense>
      </RequireDocuments>
    </PageContainer>
  );
}

function DeepDive() {
  const params = useSearchParams();
  const settings = useSettings();
  const [projects, setProjects] = useState<DetectedProject[] | null>(null);
  const [selected, setSelected] = useState<DetectedProject | null>(null);
  const [brief, setBrief] = useState<ProjectBrief | null>(null);

  useEffect(() => {
    void listProjects().then((list) => {
      setProjects(list);
      const wanted = params.get("name");
      setSelected(list.find((p) => p.name === wanted) ?? list[0] ?? null);
    });
  }, [params]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void prepareProject(selected, settings).then((b) => {
      if (!cancelled) setBrief(b);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!projects) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Finding projects in your documents…
      </p>
    );
  }
  if (!projects.length) {
    return (
      <p className="text-muted-foreground text-sm">
        No projects detected. Projects are found under “Projects” or “Experience” headings and in project reports.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium uppercase">Detected in your documents</p>
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelected(p)}
            className={cn(
              "bg-card hover:border-foreground/20 w-full rounded-lg border p-3 text-left transition-colors",
              selected?.id === p.id && "border-brand ring-brand/15 ring-2",
            )}
          >
            <p className="text-sm font-medium">{p.name}</p>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {p.kind === "experience" ? "Role" : "Project"} · {p.docNames.length} document{p.docNames.length > 1 ? "s" : ""}
            </p>
          </button>
        ))}
      </div>

      <div className="min-w-0 space-y-5">
        {!brief || brief.project.id !== selected?.id ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Gathering evidence about {selected?.name}…
          </p>
        ) : (
          <>
            <div className="bg-card rounded-xl border p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <p className="font-medium">Preparation checklist</p>
                <p className="text-muted-foreground text-xs">
                  {brief.checklist.filter((c) => c.covered).length}/{brief.checklist.length} covered by your documents
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {brief.checklist.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    {c.covered ? (
                      <span className="bg-success/15 text-success grid size-5 place-items-center rounded-full">
                        <Check className="size-3" />
                      </span>
                    ) : (
                      <span className="bg-warning/15 text-warning grid size-5 place-items-center rounded-full">
                        <X className="size-3" />
                      </span>
                    )}
                    <span className={c.covered ? "" : "text-muted-foreground"}>{c.label}</span>
                    {c.covered && c.source ? (
                      <SourceChips nums={[c.source]} sources={brief.context.sources.map((s) => s.result)} />
                    ) : (
                      <span className="text-warning text-[11px]">prepare this</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <LlmFallbackNotice feature="Project explanations" />

            <Tabs defaultValue="explain" className="gap-4">
              <TabsList>
                <TabsTrigger value="explain">Explain my project</TabsTrigger>
                <TabsTrigger value="ladder">Question ladder</TabsTrigger>
              </TabsList>
              <TabsContent value="explain">
                <Explainer key={brief.project.id} brief={brief} />
              </TabsContent>
              <TabsContent value="ladder">
                <Ladder key={brief.project.id} brief={brief} />
              </TabsContent>
            </Tabs>

            <EvidenceDisclosure context={brief.context} title="What your documents say about this project" />
          </>
        )}
      </div>
    </div>
  );
}

function Explainer({ brief }: { brief: ProjectBrief }) {
  const settings = useSettings();
  const [level, setLevel] = useState<ExplanationLevel>("pitch");
  const [texts, setTexts] = useState<Partial<Record<ExplanationLevel, string>>>({});
  const [running, setRunning] = useState<ExplanationLevel | null>(null);
  const abort = useRef<AbortController | null>(null);
  const sources = brief.context.sources.map((s) => s.result);

  async function generate(target: ExplanationLevel) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(target);
    try {
      for await (const text of streamExplanation(brief, target, settings, controller.signal)) {
        setTexts((t) => ({ ...t, [target]: text }));
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error("Could not generate", { description: (error as Error).message });
    } finally {
      setRunning(null);
    }
  }

  const spec = EXPLANATION_LEVELS.find((l) => l.id === level)!;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {EXPLANATION_LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLevel(l.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              level === l.id ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
            )}
          >
            {l.label}
            {texts[l.id] && level !== l.id ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div className="bg-card min-h-40 rounded-xl border p-5">
        <p className="text-muted-foreground mb-3 text-xs">{spec.instruction}</p>
        {texts[level] ? (
          <CitedText text={texts[level]!} sources={sources} />
        ) : (
          !running && <p className="text-muted-foreground text-sm">Not generated yet.</p>
        )}
        {running === level && !texts[level] && <GeneratingNote label="Writing…" />}
        <div className="mt-4 flex gap-2">
          {running === level ? (
            <Button variant="secondary" size="sm" onClick={() => abort.current?.abort()}>
              <Square className="fill-current" /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => void generate(level)} disabled={Boolean(running)}>
              <Sparkle /> {texts[level] ? "Regenerate" : "Generate"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Ladder({ brief }: { brief: ProjectBrief }) {
  const settings = useSettings();
  const [questions, setQuestions] = useState<LadderQuestion[] | null>(null);
  const [chars, setChars] = useState<number | null>(null);
  const sources = brief.context.sources.map((s) => s.result);

  async function generate() {
    setChars(0);
    const result = await generateQuestionLadder(brief, settings, setChars);
    setQuestions(result.questions);
    setChars(null);
    if (result.error) toast.warning("Used template questions", { description: result.error });
  }

  return (
    <div className="space-y-3">
      {!questions && chars === null && (
        <div className="bg-card flex flex-col items-start gap-3 rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">
            Eight questions from warm-up (level 1) to very hard follow-ups (level 5), each with a hint grounded in your documents.
          </p>
          <Button onClick={() => void generate()}>
            <Sparkle /> Generate question ladder
          </Button>
        </div>
      )}
      {chars !== null && <GeneratingNote label="Building the question ladder…" chars={chars} />}
      {questions?.map((q, i) => (
        <div key={i} className="bg-card flex gap-4 rounded-xl border p-4">
          <div className="flex flex-col items-center gap-1">
            <span className="text-muted-foreground text-[10px] font-medium uppercase">Level</span>
            <span
              className={cn(
                "grid size-8 place-items-center rounded-lg text-sm font-semibold",
                q.level >= 4
                  ? "bg-destructive/10 text-destructive"
                  : q.level >= 3
                    ? "bg-warning/15 text-warning"
                    : "bg-brand/10 text-brand",
              )}
            >
              {q.level}
            </span>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="font-medium">
              {q.question} <SourceChips nums={q.sources} sources={sources} />
            </p>
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground/80 font-medium">Hint:</span> {q.hint}
            </p>
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="capitalize">
                {q.category}
              </Badge>
              <Button
                variant="ghost"
                size="xs"
                onClick={async () => {
                  const added = await saveQuestion({
                    question: q.question,
                    category: "project",
                    difficulty: q.level >= 4 ? "hard" : q.level >= 2 ? "medium" : "easy",
                    whyAsked: q.hint,
                    origin: `Deep dive: ${brief.project.name}`,
                  });
                  toast[added ? "success" : "info"](added ? "Saved to question bank" : "Already saved");
                }}
              >
                <BookmarkPlus /> Save
              </Button>
            </div>
          </div>
        </div>
      ))}
      {questions && (
        <Button variant="outline" size="sm" onClick={() => void generate()} disabled={chars !== null}>
          Regenerate
        </Button>
      )}
    </div>
  );
}
