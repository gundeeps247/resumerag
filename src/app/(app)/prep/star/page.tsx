"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCopy, FileWarning, Quote, Sparkle } from "lucide-react";
import { CitedText, EvidenceDisclosure, SourceChips } from "@/components/common/cited-text";
import { GeneratingNote, LlmFallbackNotice, RequireDocuments } from "@/components/common/feature-states";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/lib/client/settings";
import type { RetrievedChunk } from "@/lib/rag/types";
import { cn } from "@/lib/utils";
import { BEHAVIORAL_PROMPTS, buildStarAnswer, type StarAnswer, type StarResult } from "@/lib/workflows/star";

export default function StarPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Prep tools"
        title="STAR answer builder"
        description="Structures a behavioural answer from experiences in your documents. Facts from your documents and suggested wording are kept visibly separate — nothing is invented."
      />
      <RequireDocuments what="the STAR builder">
        <Builder />
      </RequireDocuments>
    </PageContainer>
  );
}

function Builder() {
  const settings = useSettings();
  const [prompt, setPrompt] = useState(BEHAVIORAL_PROMPTS[0]);
  const [result, setResult] = useState<StarResult | null>(null);
  const [chars, setChars] = useState<number | null>(null);

  async function build() {
    setChars(0);
    setResult(null);
    try {
      const r = await buildStarAnswer(prompt, settings, setChars);
      setResult(r);
      if (r.error) toast.error("Could not build the answer", { description: r.error });
    } finally {
      setChars(null);
    }
  }

  const sources = result?.context.sources.map((s) => s.result) ?? [];

  return (
    <div className="space-y-5">
      <LlmFallbackNotice feature="The STAR builder" />
      <div className="bg-card space-y-3 rounded-xl border p-5">
        <div className="flex flex-wrap gap-1.5">
          {BEHAVIORAL_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPrompt(p)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                prompt === p ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              {p.replace(/^Tell me about (a time )?/i, "").replace(/\.$/, "")}
            </button>
          ))}
        </div>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-16" aria-label="Behavioural question" />
        <Button onClick={() => void build()} disabled={chars !== null || prompt.trim().length < 10}>
          <Sparkle /> Build STAR answer
        </Button>
      </div>

      {chars !== null && <GeneratingNote label="Finding the best experience in your documents…" chars={chars} />}

      {result?.noEvidence && (
        <div className="border-warning/30 bg-warning/5 rounded-xl border p-5 text-sm">
          <p className="font-medium">No matching experience found in your documents.</p>
          <p className="text-muted-foreground mt-1">
            ResumeRAG will not invent a story. Add a note describing a real experience (for example in a “behavioural notes” document) and
            try again.
          </p>
        </div>
      )}

      {result?.star && <StarView star={result.star} sources={sources} />}
      {result && <EvidenceDisclosure context={result.context} />}
    </div>
  );
}

const PARTS = [
  { key: "situation", letter: "S", label: "Situation" },
  { key: "task", letter: "T", label: "Task" },
  { key: "action", letter: "A", label: "Action" },
  { key: "result", letter: "R", label: "Result" },
] as const;

function StarView({ star, sources }: { star: StarAnswer; sources: RetrievedChunk[] }) {
  const answer = star.answer.replace(/\[ADD:\s*([^\]]+)\]/gi, "**[Add: $1]**");
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Experience used: <span className="text-foreground font-medium">{star.experience}</span>
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {PARTS.map((part) => {
          const data = star[part.key];
          return (
            <div key={part.key} className="bg-card rounded-xl border p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="bg-brand text-brand-foreground grid size-7 place-items-center rounded-lg text-sm font-bold">
                  {part.letter}
                </span>
                <p className="font-medium">{part.label}</p>
              </div>
              <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">From your documents</p>
              {data.facts.length ? (
                <ul className="mt-1 space-y-1 text-sm">
                  {data.facts.map((f, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="bg-brand mt-2 size-1 shrink-0 rounded-full" />
                      <span>
                        {f.text} <SourceChips nums={f.sources} sources={sources} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-warning mt-1 text-sm">Nothing in your documents — add this from memory.</p>
              )}
              <p className="text-muted-foreground mt-3 text-[11px] font-medium tracking-wide uppercase">
                Suggested wording (adds no new facts)
              </p>
              <p className="text-muted-foreground mt-1 text-sm italic">{data.phrasing}</p>
            </div>
          );
        })}
      </div>

      {star.missing.length > 0 && (
        <div className="border-warning/30 bg-warning/5 rounded-xl border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <FileWarning className="text-warning size-4" /> Details only you can add
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
            {star.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-card rounded-xl border p-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-2 font-medium">
            <Quote className="text-brand size-4" /> Full answer (~{star.answer.split(/\s+/).length} words)
          </p>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              void navigator.clipboard.writeText(star.answer.replace(/\[\d+\]/g, ""));
              toast.success("Copied");
            }}
          >
            <ClipboardCopy /> Copy
          </Button>
        </div>
        <CitedText text={answer} sources={sources} />
      </div>
    </div>
  );
}
