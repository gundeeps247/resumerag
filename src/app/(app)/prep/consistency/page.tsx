"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleHelp, GitCompareArrows, Loader2, ShieldCheck, Sparkle } from "lucide-react";
import { GeneratingNote, LlmFallbackNotice, RequireDocuments } from "@/components/common/feature-states";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useKbStats } from "@/hooks/use-kb";
import { useSettings } from "@/lib/client/settings";
import type { ConsistencyCandidate, NumericFact } from "@/lib/rag/analysis/consistency";
import { cn } from "@/lib/utils";
import { findCandidates, verifyCandidates, type Verdict } from "@/lib/workflows/consistency";

export default function ConsistencyPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Prep tools"
        title="Consistency checker"
        description="Interviewers compare your resume with your reports and with what you say. This finds numbers that disagree across your documents so you can fix them — or explain them — first."
      />
      <RequireDocuments what="the consistency checker">
        <Checker />
      </RequireDocuments>
    </PageContainer>
  );
}

function Checker() {
  const settings = useSettings();
  const stats = useKbStats();
  const [candidates, setCandidates] = useState<ConsistencyCandidate[] | null>(null);
  const [verdicts, setVerdicts] = useState<Map<string, Verdict>>(new Map());
  const [chars, setChars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void findCandidates().then((found) => {
      if (!cancelled) setCandidates(found);
    });
    return () => {
      cancelled = true;
    };
  }, [stats?.ready]);

  async function verify() {
    if (!candidates?.length) return;
    setChars(0);
    try {
      const result = await verifyCandidates(candidates, settings, setChars);
      setVerdicts(result.verdicts);
      if (result.error) toast.error("Verification failed", { description: result.error });
    } finally {
      setChars(null);
    }
  }

  if (!candidates) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Comparing numbers across your documents…
      </p>
    );
  }

  if (!candidates.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
        <ShieldCheck className="text-success size-6" />
        <p className="font-medium">No conflicting numbers found</p>
        <p className="text-muted-foreground max-w-md text-sm">
          Metrics like accuracy, AUC, latency, team size and user counts agree across your documents.
        </p>
      </div>
    );
  }

  const confirmed = [...verdicts.values()].filter((v) => v.verdict === "contradiction").length;

  return (
    <div className="space-y-4">
      <LlmFallbackNotice feature="Verification" />
      <div className="bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">
            {candidates.length} possible inconsistenc{candidates.length === 1 ? "y" : "ies"}
            {verdicts.size > 0 && <span className="text-muted-foreground"> · {confirmed} confirmed by the model</span>}
          </p>
          <p className="text-muted-foreground text-sm">
            Found deterministically: same metric, different values, in different documents. Some may measure different things — verify to
            find out.
          </p>
        </div>
        <Button onClick={() => void verify()} disabled={chars !== null}>
          <Sparkle /> Verify with AI
        </Button>
      </div>
      {chars !== null && <GeneratingNote label="Checking each pair…" chars={chars} />}
      {candidates.map((c) => (
        <CandidateCard key={c.id} candidate={c} verdict={verdicts.get(c.id)} />
      ))}
    </div>
  );
}

const VERDICT_STYLE = {
  contradiction: { label: "Contradiction", icon: GitCompareArrows, className: "bg-destructive/10 text-destructive ring-destructive/25" },
  compatible: { label: "Compatible", icon: CheckCircle2, className: "bg-success/10 text-success ring-success/25" },
  unclear: { label: "Unclear", icon: CircleHelp, className: "bg-muted text-muted-foreground ring-border" },
};

function CandidateCard({ candidate, verdict }: { candidate: ConsistencyCandidate; verdict?: Verdict }) {
  const style = verdict ? VERDICT_STYLE[verdict.verdict] : null;
  return (
    <div className={cn("bg-card rounded-xl border p-4", verdict?.verdict === "compatible" && "opacity-70")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium capitalize">{candidate.key}</p>
        {style ? (
          <span className={cn("inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset", style.className)}>
            <style.icon className="size-3.5" /> {style.label}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">heuristic score {candidate.score.toFixed(2)}</span>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <FactBox fact={candidate.a} />
        <FactBox fact={candidate.b} />
      </div>
      {verdict && (
        <div className="bg-muted/50 mt-3 space-y-1 rounded-lg p-3 text-sm">
          <p>{verdict.explanation}</p>
          <p className="text-muted-foreground">
            <span className="text-foreground/80 font-medium">What to do:</span> {verdict.fix}
          </p>
        </div>
      )}
    </div>
  );
}

function FactBox({ fact }: { fact: NumericFact }) {
  const i = fact.sentence.indexOf(fact.raw);
  return (
    <div className="bg-background rounded-lg border p-3">
      <p className="text-muted-foreground mb-1 truncate text-[11px] font-medium">{fact.docName}</p>
      <p className="text-sm leading-relaxed">
        {i >= 0 ? (
          <>
            {fact.sentence.slice(0, i)}
            <mark className="bg-warning/25 text-foreground rounded px-0.5">{fact.raw}</mark>
            {fact.sentence.slice(i + fact.raw.length)}
          </>
        ) : (
          fact.sentence
        )}
      </p>
    </div>
  );
}
