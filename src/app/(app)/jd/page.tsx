"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BookmarkPlus, Check, ChevronDown, CircleDashed, ClipboardPaste, Loader2, Minus, Sparkle, Target, X } from "lucide-react";
import { SourceCard } from "@/components/chat/source-card";
import { GeneratingNote, LlmFallbackNotice, RequireDocuments } from "@/components/common/feature-states";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { ScoreRing } from "@/components/common/score-bar";
import { PasteDialog } from "@/components/documents/paste-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocuments } from "@/hooks/use-kb";
import { saveQuestion } from "@/lib/client/question-bank";
import { useSettings } from "@/lib/client/settings";
import { getDb, getKbVersion } from "@/lib/db/schema";
import type { Importance } from "@/lib/rag/analysis/jd";
import { cn } from "@/lib/utils";
import {
  matchJobDescription,
  summarizeMatch,
  type JdMatchResult,
  type JdSummary,
  type MatchStatus,
  type RequirementMatch,
} from "@/lib/workflows/jd-match";

export default function JdMatchPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Interview prep"
        title="JD match"
        description="Each requirement in the job description is searched against your own documents — never against the JD itself — so a skill only counts as matched when you can point to evidence."
      />
      <RequireDocuments what="JD matching">
        <JdMatch />
      </RequireDocuments>
    </PageContainer>
  );
}

function JdMatch() {
  const settings = useSettings();
  const documents = useDocuments();
  const jds = useMemo(() => documents?.filter((d) => d.docType === "job_description") ?? [], [documents]);
  const [pickedJdId, setJdId] = useState<string | null>(null);
  const [result, setResult] = useState<JdMatchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{ data: JdSummary; fromLlm: boolean } | null>(null);
  const [chars, setChars] = useState<number | null>(null);

  // Default to the first job description until the user picks one.
  const jdId = pickedJdId ?? jds[0]?.id ?? null;
  const selected = jds.find((d) => d.id === jdId);

  async function analyze() {
    if (!jdId) return;
    setRunning(true);
    setResult(null);
    setSummary(null);
    try {
      const r = await matchJobDescription(jdId, settings);
      setResult(r);
      await getDb().analyses.put({
        id: `jd-match:${jdId}`,
        kind: "jd-match",
        title: r.jdName,
        createdAt: Date.now(),
        kbVersion: await getKbVersion(),
        result: {
          coverage: r.coverage,
          counts: r.counts,
          gaps: r.matches
            .filter((m) => m.status === "missing" && m.requirement.importance === "required")
            .map((m) => m.requirement.skills.join(", ") || m.requirement.text),
        },
      });
      void runSummary(r);
    } catch (error) {
      toast.error("Could not analyse the job description", { description: (error as Error).message });
    } finally {
      setRunning(false);
    }
  }

  async function runSummary(r: JdMatchResult) {
    setChars(0);
    try {
      const s = await summarizeMatch(r, settings, setChars);
      setSummary({ data: s.summary, fromLlm: s.fromLlm });
    } finally {
      setChars(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-1.5">
          <p className="text-muted-foreground text-xs font-medium">Job description</p>
          {jds.length ? (
            <Select value={jdId ?? undefined} onValueChange={(v) => setJdId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a job description" />
              </SelectTrigger>
              <SelectContent>
                {jds.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} {d.status !== "ready" ? "(indexing…)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-muted-foreground text-sm">No job description in your knowledge base yet — paste one to get started.</p>
          )}
        </div>
        <PasteDialog
          defaultType="job_description"
          onAdded={(id) => setJdId(id)}
          trigger={
            <Button variant="outline">
              <ClipboardPaste /> Paste a JD
            </Button>
          }
        />
        <Button onClick={() => void analyze()} disabled={!selected || selected.status !== "ready" || running}>
          {running ? <Loader2 className="animate-spin" /> : <Target />} Analyse match
        </Button>
      </div>

      {running && <GeneratingNote label="Searching your documents for each requirement…" />}
      {result && <MatchView result={result} summary={summary} chars={chars} onRetrySummary={() => void runSummary(result)} />}
    </div>
  );
}

const STATUS_STYLE: Record<MatchStatus, { label: string; icon: typeof Check; className: string }> = {
  strong: { label: "Strong", icon: Check, className: "bg-success/12 text-success ring-success/25" },
  partial: { label: "Partial", icon: Minus, className: "bg-warning/12 text-warning ring-warning/30" },
  missing: { label: "Missing", icon: X, className: "bg-destructive/10 text-destructive ring-destructive/25" },
};

const GROUPS: { importance: Importance; label: string }[] = [
  { importance: "required", label: "Requirements" },
  { importance: "responsibility", label: "Responsibilities" },
  { importance: "preferred", label: "Nice to have" },
];

function MatchView({
  result,
  summary,
  chars,
  onRetrySummary,
}: {
  result: JdMatchResult;
  summary: { data: JdSummary; fromLlm: boolean } | null;
  chars: number | null;
  onRetrySummary: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="bg-card flex flex-col gap-5 rounded-xl border p-5 sm:flex-row sm:items-center">
        <ScoreRing value={result.coverage} size={84} label="match" />
        <div className="flex-1 space-y-2">
          <p className="font-semibold tracking-tight">{result.jdName}</p>
          <p className="text-muted-foreground text-sm">
            Weighted coverage: required requirements count fully, responsibilities ¾, nice-to-haves ½. Partial matches count half.
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_STYLE) as MatchStatus[]).map((s) => (
              <StatusPill key={s} status={s} count={result.counts[s]} />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {GROUPS.map((g) => {
          const items = result.matches.filter((m) => m.requirement.importance === g.importance);
          if (!items.length) return null;
          return (
            <section key={g.importance} className="space-y-2">
              <h2 className="text-sm font-medium">{g.label}</h2>
              <div className="bg-card divide-y rounded-xl border">
                {items.map((m) => (
                  <RequirementRow key={m.requirement.id} match={m} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <LlmFallbackNotice feature="The match summary" />
      {chars !== null && <GeneratingNote label="Writing your preparation plan…" chars={chars} />}
      {summary && <SummaryView summary={summary.data} fromLlm={summary.fromLlm} onRetry={onRetrySummary} />}
    </div>
  );
}

function StatusPill({ status, count }: { status: MatchStatus; count?: number }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset", s.className)}>
      <s.icon className="size-3.5" /> {s.label}
      {count !== undefined && <span className="tabular-nums">· {count}</span>}
    </span>
  );
}

function RequirementRow({ match }: { match: RequirementMatch }) {
  return (
    <Collapsible>
      <div className="flex items-start gap-3 p-4">
        <StatusPill status={match.status} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm">{match.requirement.text}</p>
          <p className="text-muted-foreground text-xs">{match.reason}</p>
          {(match.skillsFound.length > 0 || match.skillsMissing.length > 0) && (
            <div className="flex flex-wrap gap-1 pt-1">
              {match.skillsFound.map((s) => (
                <Badge key={s} variant="secondary" className="gap-1">
                  <Check className="text-success size-3" /> {s}
                </Badge>
              ))}
              {match.skillsMissing.map((s) => (
                <Badge key={s} variant="outline" className="text-muted-foreground gap-1">
                  <CircleDashed className="size-3" /> {s}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {match.evidence.length > 0 && (
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className="group shrink-0">
              Evidence <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
        )}
      </div>
      <CollapsibleContent>
        <div className="grid gap-2 px-4 pb-4 md:grid-cols-3">
          {match.evidence.map((e, i) => (
            <SourceCard key={e.chunk.id} n={i + 1} source={e} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SummaryView({ summary, fromLlm, onRetry }: { summary: JdSummary; fromLlm: boolean; onRetry: () => void }) {
  return (
    <div className="bg-card space-y-4 rounded-xl border p-5">
      <div className="flex items-center justify-between">
        <p className="font-semibold tracking-tight">Preparation plan</p>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{fromLlm ? "AI summary" : "Rule-based summary"}</Badge>
          <Button variant="ghost" size="xs" onClick={onRetry}>
            <Sparkle /> Regenerate
          </Button>
        </div>
      </div>
      <p className="text-sm leading-relaxed">{summary.summary}</p>
      <div className="grid gap-4 md:grid-cols-3">
        <ListBlock title="Strongest selling points" items={summary.strengths} tone="success" />
        <ListBlock title="Gaps to address" items={summary.gaps} tone="destructive" />
        <ListBlock title="Where they will dig in" items={summary.interviewFocus} tone="warning" />
      </div>
      {summary.prepPlan.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">Preparation plan</p>
          <ol className="space-y-2">
            {summary.prepPlan.map((p, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="bg-brand/15 text-brand grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold">
                  {i + 1}
                </span>
                <span>
                  <span className="font-medium">{p.topic}:</span> <span className="text-muted-foreground">{p.action}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {summary.likelyQuestions.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">Questions this employer is likely to ask</p>
          <div className="space-y-2">
            {summary.likelyQuestions.map((q, i) => (
              <div key={i} className="bg-muted/50 flex items-start justify-between gap-3 rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">{q.question}</p>
                  <p className="text-muted-foreground text-xs">{q.why}</p>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={async () => {
                    const added = await saveQuestion({
                      question: q.question,
                      category: "technical",
                      difficulty: "medium",
                      whyAsked: q.why,
                      origin: "JD match",
                    });
                    toast[added ? "success" : "info"](added ? "Saved to question bank" : "Already saved");
                  }}
                >
                  <BookmarkPlus />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone: "success" | "destructive" | "warning" }) {
  const dot = { success: "bg-success", destructive: "bg-destructive", warning: "bg-warning" }[tone];
  return (
    <div className="rounded-lg border p-3">
      <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">{title}</p>
      {items.length ? (
        <ul className="space-y-1.5 text-sm">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", dot)} />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">None.</p>
      )}
    </div>
  );
}
