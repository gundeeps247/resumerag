"use client";

/**
 * JD match: compares a job description with the candidate's documents requirement by
 * requirement.
 *
 *   JD → requirements → one retrieval per requirement (candidate documents only)
 *      → deterministic status (strong / partial / missing) from reranker scores,
 *        skill mentions and explicit "I have not used X" statements
 *      → optional LLM summary, prep plan and likely questions
 *
 * A skill is only counted as matched when there is a cited passage from the candidate's
 * own documents — the JD itself is excluded from the evidence by a metadata filter.
 */
import { z } from "zod";
import { getRag } from "@/lib/client/rag-client";
import type { AppSettings } from "@/lib/client/settings";
import { getDb } from "@/lib/db/schema";
import { extractRequirements } from "@/lib/rag/analysis/jd";
import { scoreRequirement, type MatchStatus, type RequirementMatch } from "@/lib/rag/analysis/jd-scoring";
import { hasSkill } from "@/lib/rag/analysis/skills";
import { GROUNDING_RULES } from "@/lib/rag/generation/prompts";
import { EMPLOYER_DOC_TYPES, type RetrievedChunk } from "@/lib/rag/types";
import { CANDIDATE_FILTER, runLlmJson } from "./common";

export type { MatchStatus, RequirementMatch };

export interface JdMatchResult {
  jdDocId: string;
  jdName: string;
  matches: RequirementMatch[];
  coverage: number;
  counts: Record<MatchStatus, number>;
}

const IMPORTANCE_WEIGHT = { required: 1, responsibility: 0.75, preferred: 0.5 } as const;

export async function matchJobDescription(
  jdDocId: string,
  settings: AppSettings,
  onProgress?: (done: number, total: number) => void,
): Promise<JdMatchResult> {
  const db = getDb();
  const [doc, content] = await Promise.all([db.documents.get(jdDocId), db.contents.get(jdDocId)]);
  if (!doc || !content) throw new Error("Job description not found. Is it still being indexed?");
  const requirements = extractRequirements(content.blocks);
  if (!requirements.length) throw new Error("No requirements found. Make sure the JD has bullet lists or sections like “Requirements”.");

  const rag = getRag();
  onProgress?.(0, requirements.length);
  const [retrievals, allChunks] = await Promise.all([
    rag.searchMany(
      requirements.map((r) => r.text),
      { ...settings.retrieval, rerank: true, topK: 3, filter: CANDIDATE_FILTER },
    ),
    rag.listChunks(),
  ]);
  onProgress?.(requirements.length, requirements.length);

  // Exact skill lookup across all candidate chunks complements retrieval.
  const candidateChunks = allChunks.filter((c) => !EMPLOYER_DOC_TYPES.includes(c.docType));
  const lookup = (skills: string[]): RetrievedChunk[] =>
    candidateChunks
      .filter((c) => skills.some((s) => hasSkill(c.embedText, s)))
      .slice(0, 4)
      .map((c) => ({
        chunk: c,
        document: { id: c.docId, name: c.docName, docType: c.docType, format: c.docFormat },
        score: 0,
        candidate: { chunkId: c.id, docId: c.docId, fusedScore: 0, fusedRank: 0, selected: false },
        via: "skill-lookup" as const,
      }));

  const matches = requirements.map((requirement, i) => scoreRequirement(requirement, retrievals[i].results, lookup(requirement.skills)));
  const counts = { strong: 0, partial: 0, missing: 0 } as Record<MatchStatus, number>;
  let weighted = 0;
  let total = 0;
  for (const m of matches) {
    counts[m.status]++;
    const w = IMPORTANCE_WEIGHT[m.requirement.importance];
    total += w;
    weighted += w * (m.status === "strong" ? 1 : m.status === "partial" ? 0.5 : 0);
  }
  return { jdDocId, jdName: doc.name, matches, coverage: total ? weighted / total : 0, counts };
}

const summarySchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()).max(5),
  gaps: z.array(z.string()).max(5),
  interviewFocus: z.array(z.string()).max(5),
  prepPlan: z.array(z.object({ topic: z.string(), action: z.string() })).max(6),
  likelyQuestions: z.array(z.object({ question: z.string(), why: z.string() })).max(6),
});

export type JdSummary = z.infer<typeof summarySchema>;

export async function summarizeMatch(
  result: JdMatchResult,
  settings: AppSettings,
  onProgress?: (chars: number) => void,
): Promise<{ summary: JdSummary; error?: string; fromLlm: boolean }> {
  const table = result.matches
    .map((m, i) => {
      const quote = m.evidence[0] ? ` | evidence: "${m.evidence[0].chunk.text.replace(/\s+/g, " ").slice(0, 140)}"` : "";
      return `${i + 1}. [${m.requirement.importance}] ${m.requirement.text} → ${m.status.toUpperCase()} (${m.reason})${quote}`;
    })
    .join("\n");

  const outcome = await runLlmJson(
    settings,
    [
      {
        role: "system",
        content: `You are a career coach comparing a candidate with a job description.\n\n${GROUNDING_RULES}\n- Base every statement about the candidate on the requirement table and its evidence. Never claim a skill marked MISSING.`,
      },
      {
        role: "user",
        content: `Job: ${result.jdName}\nRequirement-by-requirement match (from retrieval over the candidate's documents):\n${table}

Write: a 2-3 sentence overall assessment, the candidate's strongest selling points, the most important gaps, the areas the interviewer is most likely to dig into, a practical preparation plan (topic + concrete action), and 5 questions this employer is likely to ask this candidate (with why).

Return JSON: {"summary":"...","strengths":["..."],"gaps":["..."],"interviewFocus":["..."],"prepPlan":[{"topic":"...","action":"..."}],"likelyQuestions":[{"question":"...","why":"..."}]}`,
      },
    ],
    summarySchema,
    { maxTokens: 1100, temperature: 0.3 },
    onProgress,
  );
  if (outcome.data) return { summary: outcome.data, fromLlm: true };
  return { summary: fallbackSummary(result), error: outcome.error, fromLlm: false };
}

function fallbackSummary(result: JdMatchResult): JdSummary {
  const by = (s: MatchStatus) => result.matches.filter((m) => m.status === s);
  const label = (m: RequirementMatch) => m.requirement.skills.join(", ") || m.requirement.text.slice(0, 70);
  return {
    summary: `You match ${by("strong").length} of ${result.matches.length} requirements strongly and ${by("partial").length} partially (weighted coverage ${Math.round(result.coverage * 100)}%).`,
    strengths: by("strong").slice(0, 5).map(label),
    gaps: [...by("missing"), ...by("partial")]
      .filter((m) => m.requirement.importance !== "responsibility")
      .slice(0, 5)
      .map(label),
    interviewFocus: by("partial")
      .slice(0, 4)
      .map((m) => `Depth of experience with ${label(m)}`),
    prepPlan: by("missing")
      .slice(0, 5)
      .map((m) => ({
        topic: label(m),
        action: "Prepare an honest answer about your exposure and a concrete plan to learn it; build a small demo if time allows.",
      })),
    likelyQuestions: [
      ...by("partial")
        .slice(0, 3)
        .map((m) => ({ question: `Tell me about your experience with ${label(m)}.`, why: "Your documents show only partial evidence." })),
      ...by("missing")
        .slice(0, 2)
        .map((m) => ({
          question: `Have you worked with ${label(m)}? How would you get up to speed?`,
          why: "Listed in the JD but not found in your documents.",
        })),
    ],
  };
}
