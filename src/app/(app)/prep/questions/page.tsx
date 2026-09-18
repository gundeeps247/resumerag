"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { BookmarkPlus, Sparkle, Trash2 } from "lucide-react";
import { EvidenceDisclosure, SourceChips } from "@/components/common/cited-text";
import { GeneratingNote, LlmFallbackNotice, RequireDocuments } from "@/components/common/feature-states";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { saveQuestion } from "@/lib/client/question-bank";
import { useSettings } from "@/lib/client/settings";
import type { Difficulty, QuestionCategory, SavedQuestion } from "@/lib/db/records";
import { getDb } from "@/lib/db/schema";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CATEGORY_INFO, generateQuestions, type QuestionSet } from "@/lib/workflows/questions";

const CATEGORIES = Object.keys(CATEGORY_INFO) as QuestionCategory[];

export default function QuestionsPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Prep tools"
        title="Question generator"
        description="Questions tailored to your documents — every question points at the passage that prompted it."
      />
      <RequireDocuments what="the question generator">
        <Generator />
      </RequireDocuments>
      <QuestionBank />
    </PageContainer>
  );
}

function Generator() {
  const settings = useSettings();
  const [category, setCategory] = useState<QuestionCategory>("technical");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [count, setCount] = useState(5);
  const [focus, setFocus] = useState("");
  const [result, setResult] = useState<QuestionSet | null>(null);
  const [chars, setChars] = useState<number | null>(null);

  async function generate() {
    setChars(0);
    setResult(null);
    try {
      const r = await generateQuestions({ category, difficulty, count, focus: focus.trim() || undefined }, settings, setChars);
      setResult(r);
      if (r.error) toast.warning("Used template questions", { description: r.error });
    } finally {
      setChars(null);
    }
  }

  const sources = result?.context.sources.map((s) => s.result) ?? [];

  return (
    <div className="space-y-4">
      <LlmFallbackNotice feature="The question generator" />
      <div className="bg-card grid gap-5 rounded-xl border p-5">
        <div className="grid gap-2">
          <Label>Question type</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  category === c ? "border-brand bg-brand/5 ring-brand/15 ring-2" : "hover:bg-muted/50",
                )}
              >
                <p className="text-sm font-medium">{CATEGORY_INFO[c].label}</p>
                <p className="text-muted-foreground text-[11px]">{CATEGORY_INFO[c].description}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label>Difficulty</Label>
            <ToggleGroup type="single" variant="outline" value={difficulty} onValueChange={(v) => v && setDifficulty(v as Difficulty)}>
              <ToggleGroupItem value="easy">Easy</ToggleGroupItem>
              <ToggleGroupItem value="medium">Medium</ToggleGroupItem>
              <ToggleGroupItem value="hard">Hard</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid gap-2">
            <Label>
              Number of questions <span className="text-muted-foreground tabular-nums">· {count}</span>
            </Label>
            <Slider min={3} max={8} step={1} value={[count]} onValueChange={([v]) => setCount(v)} className="mt-2" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="focus">Focus (optional)</Label>
            <Input id="focus" placeholder="e.g. LexiSearch, SQL, leadership" value={focus} onChange={(e) => setFocus(e.target.value)} />
          </div>
        </div>
        <div>
          <Button onClick={() => void generate()} disabled={chars !== null}>
            <Sparkle /> Generate questions
          </Button>
        </div>
      </div>

      {chars !== null && <GeneratingNote label="Reading your documents and writing questions…" chars={chars} />}

      {result && (
        <div className="space-y-3">
          {result.questions.map((q, i) => (
            <div key={i} className="bg-card rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">
                  {q.question} <SourceChips nums={q.sources} sources={sources} />
                </p>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={async () => {
                    const added = await saveQuestion({
                      question: q.question,
                      category: q.category,
                      difficulty: q.difficulty,
                      whyAsked: q.whyAsked,
                      sourceChunkIds: q.sources.map((n) => sources[n - 1]?.chunk.id).filter(Boolean),
                      origin: "Question generator",
                    });
                    toast[added ? "success" : "info"](added ? "Saved to question bank" : "Already saved");
                  }}
                >
                  <BookmarkPlus /> Save
                </Button>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">{q.whyAsked}</p>
            </div>
          ))}
          <EvidenceDisclosure context={result.context} />
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<SavedQuestion["status"], string> = { new: "New", practicing: "Practising", confident: "Confident" };

function QuestionBank() {
  const [filter, setFilter] = useState<QuestionCategory | "all">("all");
  const questions = useLiveQuery(() => getDb().questions.orderBy("createdAt").reverse().toArray(), []);
  const visible = questions?.filter((q) => filter === "all" || q.category === filter) ?? [];

  return (
    <section id="bank" className="space-y-3 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Question bank</h2>
          <p className="text-muted-foreground text-sm">Track which questions you can already answer confidently.</p>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as QuestionCategory | "all")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_INFO[c].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!visible.length ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">No saved questions yet.</p>
      ) : (
        <div className="bg-card divide-y rounded-xl border">
          {visible.map((q) => (
            <div key={q.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{q.question}</p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  {CATEGORY_INFO[q.category]?.label ?? q.category} · {q.difficulty} · {q.origin} · {formatRelative(q.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={q.status}
                  onValueChange={(v) => void getDb().questions.update(q.id, { status: v as SavedQuestion["status"] })}
                >
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABEL) as SavedQuestion["status"][]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Badge variant={q.status === "confident" ? "default" : "secondary"} className="hidden sm:inline-flex">
                  {STATUS_LABEL[q.status]}
                </Badge>
                <Button variant="ghost" size="icon-sm" aria-label="Delete question" onClick={() => void getDb().questions.delete(q.id)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
