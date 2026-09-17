"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, BookmarkPlus, Flame, Lightbulb, Loader2, MessageSquareQuote, RefreshCw, Search } from "lucide-react";
import { SourceCard } from "@/components/chat/source-card";
import { EvidenceDisclosure, SourceChips } from "@/components/common/cited-text";
import { GeneratingNote, LlmFallbackNotice, RequireDocuments } from "@/components/common/feature-states";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { SeverityBadge, StatTile } from "@/components/common/severity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useKbStats } from "@/hooks/use-kb";
import { saveQuestion } from "@/lib/client/question-bank";
import { useSettings } from "@/lib/client/settings";
import { getDb, getKbVersion } from "@/lib/db/schema";
import { newId } from "@/lib/format";
import type { ResumeClaim } from "@/lib/rag/analysis/claims";
import type { RetrievedChunk } from "@/lib/rag/types";
import { cn } from "@/lib/utils";
import { analyzeResume, findSupport, generateChallenges, type ChallengeResult, type ResumeXray } from "@/lib/workflows/resume-xray";

/** Stores a small summary of the analysis so the dashboard can show readiness. */
async function saveXray(result: ResumeXray | null) {
  if (!result) return;
  await getDb().analyses.put({
    id: "resume-xray",
    kind: "resume-xray",
    title: "Resume X-ray",
    createdAt: Date.now(),
    kbVersion: await getKbVersion(),
    result: {
      stats: result.stats,
      topClaims: result.claims.slice(0, 5).map((c) => ({ text: c.text, flags: c.flags.map((f) => f.label) })),
    },
  });
}

export default function ResumeXrayPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Prep studio"
        title="Resume X-ray"
        description="Each bullet on your resume is a claim an interviewer can challenge. The rules below are deterministic and explainable; the interviewer questions are generated from your documents."
      />
      <RequireDocuments what="the Resume X-ray">
        <XrayContent />
      </RequireDocuments>
    </PageContainer>
  );
}

function XrayContent() {
  const settings = useSettings();
  const stats = useKbStats();
  const [xray, setXray] = useState<ResumeXray | null | undefined>(undefined);
  const [challenges, setChallenges] = useState<ChallengeResult | null>(null);
  const [generating, setGenerating] = useState<{ mode: "standard" | "grill"; chars: number } | null>(null);

  // Re-analyse whenever the set of indexed documents changes.
  useEffect(() => {
    let cancelled = false;
    void analyzeResume().then((result) => {
      if (cancelled) return;
      setXray(result);
      void saveXray(result);
    });
    return () => {
      cancelled = true;
    };
  }, [stats?.ready]);

  async function challenge(mode: "standard" | "grill") {
    if (!xray) return;
    setGenerating({ mode, chars: 0 });
    try {
      const result = await generateChallenges(xray.claims, settings, mode, (chars) => setGenerating({ mode, chars }));
      setChallenges(result);
      if (result.error) toast.warning("Used template questions", { description: result.error });
    } finally {
      setGenerating(null);
    }
  }

  if (xray === undefined) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" /> Analysing your resume…
      </div>
    );
  }
  if (xray === null) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <p className="font-medium">No resume found in your knowledge base</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload your resume, or change a document&apos;s type to “Resume” in the Knowledge base.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/documents">Open knowledge base</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Claims analysed" value={xray.stats.claims} hint={xray.resumeDocs.join(", ")} />
        <StatTile label="Likely to be challenged" value={xray.stats.flagged} hint="At least one flag" />
        <StatTile label="High risk" value={xray.stats.high} hint="Ownership or expert claims" />
        <StatTile label="Quantified" value={`${xray.stats.withMetrics}/${xray.stats.claims}`} hint="Claims with a number" />
      </div>

      <Tabs defaultValue="claims" className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="claims">Claims</TabsTrigger>
            <TabsTrigger value="questions">Interviewer questions</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="projects">Projects</TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setXray(undefined);
              void analyzeResume().then((result) => {
                setXray(result);
                void saveXray(result);
              });
            }}
          >
            <RefreshCw /> Re-analyse
          </Button>
        </div>

        <TabsContent value="claims" className="space-y-3">
          {xray.claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </TabsContent>

        <TabsContent value="questions" className="space-y-4">
          <LlmFallbackNotice feature="Question generation" />
          <div className="bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Predict what the interviewer will ask</p>
              <p className="text-muted-foreground text-sm">Uses your riskiest claims plus supporting passages from your other documents.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void challenge("standard")} disabled={Boolean(generating)}>
                <MessageSquareQuote /> Likely questions
              </Button>
              <Button onClick={() => void challenge("grill")} disabled={Boolean(generating)}>
                <Flame /> Grill my resume
              </Button>
            </div>
          </div>
          {generating && (
            <GeneratingNote
              label={generating.mode === "grill" ? "Preparing the hardest legitimate questions…" : "Predicting likely questions…"}
              chars={generating.chars}
            />
          )}
          {challenges && <ChallengeList result={challenges} />}
        </TabsContent>

        <TabsContent value="skills">
          <SkillsView xray={xray} />
        </TabsContent>

        <TabsContent value="projects" className="grid gap-3 md:grid-cols-2">
          {xray.projects.map((p) => (
            <Link
              key={p.id}
              href={`/prep/project?name=${encodeURIComponent(p.name)}`}
              className="group bg-card hover:border-foreground/20 rounded-xl border p-4 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{p.name}</p>
                <ArrowRight className="text-muted-foreground size-4 shrink-0" />
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {p.kind === "experience" ? "Role" : "Project"} · mentioned in {p.docNames.join(", ")}
              </p>
              <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{p.preview}</p>
            </Link>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClaimCard({ claim }: { claim: ResumeClaim }) {
  const settings = useSettings();
  const [support, setSupport] = useState<RetrievedChunk[] | null>(null);
  const [loading, setLoading] = useState(false);
  const worst = claim.flags.find((f) => f.severity === "high") ?? claim.flags.find((f) => f.severity === "medium") ?? claim.flags[0];

  async function loadSupport() {
    setLoading(true);
    try {
      setSupport((await findSupport(claim, settings)).results);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("bg-card rounded-xl border p-4", worst?.severity === "high" && "border-destructive/30")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[0.925rem] leading-relaxed">{claim.text}</p>
          <p className="text-muted-foreground text-xs">{claim.section}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1 sm:justify-end">
          {claim.flags.length === 0 && <SeverityBadge severity="low">Looks solid</SeverityBadge>}
          {claim.flags.map((f) => (
            <SeverityBadge key={f.type} severity={f.severity}>
              {f.label}
            </SeverityBadge>
          ))}
        </div>
      </div>
      {claim.flags.length > 0 && (
        <div className="bg-muted/50 mt-3 space-y-2 rounded-lg p-3 text-sm">
          {claim.flags.map((f) => (
            <div key={f.type} className="grid gap-0.5">
              <p>
                <span className="font-medium">{f.label}:</span> <span className="text-muted-foreground">{f.why}</span>
              </p>
              <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                <Lightbulb className="text-brand mt-0.5 size-3 shrink-0" /> {f.suggestion}
              </p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {claim.metrics.map((m) => (
          <Badge key={m} variant="outline" className="font-mono">
            {m}
          </Badge>
        ))}
        {claim.skills.slice(0, 5).map((s) => (
          <Badge key={s} variant="secondary">
            {s}
          </Badge>
        ))}
        <Button variant="ghost" size="xs" className="ml-auto" onClick={() => void loadSupport()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <Search />} What supports this?
        </Button>
      </div>
      {support && (
        <div className="mt-3 space-y-2">
          {support.length === 0 ? (
            <p className="border-warning/30 bg-warning/5 rounded-lg border px-3 py-2 text-xs">
              No supporting passage found in your other documents — this claim rests on the resume alone. Prepare a concrete story for it.
            </p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {support.map((s, i) => (
                <SourceCard key={s.chunk.id} n={i + 1} source={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChallengeList({ result }: { result: ChallengeResult }) {
  const sources = result.context.sources.map((s) => s.result);
  return (
    <div className="space-y-3">
      {result.challenges.map((c, i) => (
        <div key={i} className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs">
            About: <span className="text-foreground/80">“{c.claim.text}”</span>
          </p>
          <p className="mt-2 font-medium">
            {c.question} <SourceChips nums={c.sources} sources={sources} />
          </p>
          <p className="text-muted-foreground mt-1 text-sm">Follow-up: {c.followUp}</p>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-xs font-medium uppercase">What they are testing</p>
              <p className="mt-1">{c.whatTheyTest}</p>
            </div>
            <div className="bg-brand/5 rounded-lg p-3">
              <p className="text-muted-foreground text-xs font-medium uppercase">A strong answer includes</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {c.strongAnswer.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="ghost"
              size="xs"
              onClick={async () => {
                const added = await saveQuestion({
                  question: c.question,
                  category: "challenge",
                  difficulty: result.mode === "grill" ? "hard" : "medium",
                  whyAsked: c.whatTheyTest,
                  origin: "Resume X-ray",
                });
                toast[added ? "success" : "info"](added ? "Saved to question bank" : "Already in your question bank");
              }}
            >
              <BookmarkPlus /> Save question
            </Button>
          </div>
        </div>
      ))}
      <EvidenceDisclosure context={result.context} />
      <p className="text-muted-foreground text-[11px]" key={newId()}>
        {result.model ? `Generated with ${result.model}.` : "Template questions (no language model)."}
      </p>
    </div>
  );
}

function SkillsView({ xray }: { xray: ResumeXray }) {
  const grouped = useMemo(() => {
    const map = new Map<string, ResumeXray["skills"]>();
    for (const s of xray.skills) map.set(s.category, [...(map.get(s.category) ?? []), s]);
    return [...map.entries()];
  }, [xray.skills]);
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Skills found in your documents. <span className="text-foreground font-medium">Resume-only</span> skills are not mentioned in any
        other document — have a concrete example ready.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {grouped.map(([category, skills]) => (
          <div key={category} className="bg-card rounded-xl border p-4">
            <p className="mb-3 text-sm font-medium">{category}</p>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <span
                  key={s.name}
                  title={`Mentioned ${s.mentions}× in ${s.docs.join(", ")}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                    s.resumeOnly ? "border-warning/40 bg-warning/5" : "bg-background",
                  )}
                >
                  {s.name}
                  <span className="flex gap-0.5">
                    {Array.from({ length: Math.min(3, s.docs.length) }, (_, i) => (
                      <span key={i} className="bg-brand size-1.5 rounded-full" />
                    ))}
                  </span>
                  {s.resumeOnly && <span className="text-warning text-[10px]">resume only</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
