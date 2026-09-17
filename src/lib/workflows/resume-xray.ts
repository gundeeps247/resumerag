"use client";

/**
 * Resume X-ray: what is on the resume, what an interviewer will challenge, and how well
 * each claim is backed up by the candidate's other documents.
 */
import { z } from "zod";
import { getRag } from "@/lib/client/rag-client";
import type { AppSettings } from "@/lib/client/settings";
import { extractClaims, flagConflicts, type ResumeClaim } from "@/lib/rag/analysis/claims";
import { findInconsistencies } from "@/lib/rag/analysis/consistency";
import { detectProjects, type DetectedProject } from "@/lib/rag/analysis/projects";
import { extractSkills, type SkillCategory } from "@/lib/rag/analysis/skills";
import type { BuiltContext } from "@/lib/rag/generation/context";
import { GROUNDING_RULES } from "@/lib/rag/generation/prompts";
import { EMPLOYER_DOC_TYPES } from "@/lib/rag/types";
import { CANDIDATE_FILTER, gatherEvidence, loadDocTitles, runLlmJson, validSources } from "./common";

export interface SkillEvidence {
  name: string;
  category: SkillCategory;
  mentions: number;
  docs: string[];
  /** Mentioned on the resume but nowhere else — harder to back up with a story. */
  resumeOnly: boolean;
}

export interface ResumeXray {
  resumeDocs: string[];
  claims: ResumeClaim[];
  skills: SkillEvidence[];
  projects: DetectedProject[];
  stats: { claims: number; flagged: number; high: number; withMetrics: number };
}

export async function analyzeResume(): Promise<ResumeXray | null> {
  const chunks = await getRag().listChunks();
  const candidate = chunks.filter((c) => !EMPLOYER_DOC_TYPES.includes(c.docType));
  const resume = candidate.filter((c) => c.docType === "resume");
  if (!resume.length) return null;

  // Rule-based claim analysis, plus conflicts with the candidate's other documents.
  const conflicts = findInconsistencies(candidate.map((c) => ({ chunkId: c.id, docId: c.docId, docName: c.docName, text: c.text })));
  const claims = flagConflicts(
    extractClaims(resume.map((c) => ({ chunkId: c.id, docId: c.docId, docName: c.docName, headingPath: c.headingPath, text: c.text }))),
    conflicts,
  );

  const skillMap = new Map<string, SkillEvidence>();
  for (const chunk of candidate) {
    for (const hit of extractSkills(chunk.text)) {
      const entry = skillMap.get(hit.name) ?? { name: hit.name, category: hit.category, mentions: 0, docs: [], resumeOnly: true };
      entry.mentions += hit.count;
      if (!entry.docs.includes(chunk.docName)) entry.docs.push(chunk.docName);
      if (chunk.docType !== "resume") entry.resumeOnly = false;
      skillMap.set(hit.name, entry);
    }
  }

  const projects = detectProjects(
    candidate.map((c) => ({ id: c.id, docId: c.docId, docName: c.docName, docType: c.docType, headingPath: c.headingPath, text: c.text })),
    await loadDocTitles(candidate.map((c) => c.docId)),
  );

  return {
    resumeDocs: [...new Set(resume.map((c) => c.docName))],
    claims,
    skills: [...skillMap.values()].sort((a, b) => b.docs.length - a.docs.length || b.mentions - a.mentions),
    projects,
    stats: {
      claims: claims.length,
      flagged: claims.filter((c) => c.flags.length).length,
      high: claims.filter((c) => c.flags.some((f) => f.severity === "high")).length,
      withMetrics: claims.filter((c) => c.metrics.length).length,
    },
  };
}

/**
 * "What evidence supports this claim?" — searches the candidate's *other* documents
 * (not the resume itself, not employer documents) for passages backing a resume claim.
 */
export async function findSupport(claim: ResumeClaim, settings: AppSettings) {
  const result = await getRag().search(claim.text, {
    ...settings.retrieval,
    topK: 3,
    filter: { excludeDocTypes: [...EMPLOYER_DOC_TYPES, "resume"] },
  });
  return { results: result.confidence.level === "none" ? [] : result.results, confidence: result.confidence };
}

const challengeSchema = z.object({
  challenges: z
    .array(
      z.object({
        claim: z.number().int(),
        question: z.string(),
        followUp: z.string(),
        whatTheyTest: z.string(),
        strongAnswer: z.array(z.string()).max(4),
        sources: z.array(z.number().int()).max(3),
      }),
    )
    .max(8),
});

export interface Challenge {
  claim: ResumeClaim;
  question: string;
  followUp: string;
  whatTheyTest: string;
  strongAnswer: string[];
  sources: number[];
}

export interface ChallengeResult {
  challenges: Challenge[];
  context: BuiltContext;
  mode: "standard" | "grill";
  error?: string;
  model?: string;
}

export async function generateChallenges(
  claims: ResumeClaim[],
  settings: AppSettings,
  mode: "standard" | "grill",
  onProgress?: (chars: number) => void,
): Promise<ChallengeResult> {
  const top = claims.filter((c) => c.flags.length || c.metrics.length).slice(0, mode === "grill" ? 6 : 5);
  const { context } = await gatherEvidence(
    top.map((c) => c.text),
    settings,
    { filter: CANDIDATE_FILTER, perQuery: 2, maxSources: 8 },
  );

  const tone =
    mode === "grill"
      ? "Write the HARDEST legitimate question a senior interviewer would ask about each claim: probe vague ownership, big numbers, missing baselines and technical depth. Be tough but never unfair or insulting."
      : "Write the question an interviewer is MOST LIKELY to ask about each claim.";

  const claimList = top
    .map((c, i) => `${i + 1}. "${c.text}"${c.flags.length ? ` (flags: ${c.flags.map((f) => f.label).join(", ")})` : ""}`)
    .join("\n");

  const outcome = await runLlmJson(
    settings,
    [
      {
        role: "system",
        content: `You are an experienced technical interviewer preparing to interview this candidate.\n\n${GROUNDING_RULES}`,
      },
      {
        role: "user",
        content: `<sources>\n${context.text}\n</sources>\n\nResume claims:\n${claimList}\n\n${tone}
For each claim give: the question, one follow-up, what the interviewer is really testing, and in "strongAnswer" 2-4 short points the candidate must cover (guidance such as "state the baseline churn rate" — do not write the answer and do not state facts that are not in the sources). Use the sources to make questions specific (real numbers, tools, projects). If the sources contradict a claim or give a different number, build the question around that discrepancy. Cite supporting sources by number. Return one item per claim.

Return JSON: {"challenges":[{"claim":1,"question":"...","followUp":"...","whatTheyTest":"...","strongAnswer":["..."],"sources":[1]}]}`,
      },
    ],
    challengeSchema,
    { maxTokens: 1400, temperature: 0.4 },
    onProgress,
  );

  if (!outcome.data) return { challenges: fallbackChallenges(top), context, mode, error: outcome.error };

  // Small models sometimes leak JSON fragments into strings or skip claims: clean up and fill gaps.
  const clean = (items: string[]) => items.filter((s) => s.trim().length > 3 && !/[{}[\]]|\b\w+['"]?\s*:\s*\[/.test(s));
  const seen = new Set<string>();
  const fromModel = outcome.data.challenges
    .filter((c) => top[c.claim - 1] && !seen.has(top[c.claim - 1].id) && seen.add(top[c.claim - 1].id))
    .map((c) => ({ ...c, claim: top[c.claim - 1], strongAnswer: clean(c.strongAnswer), sources: validSources(c.sources, context) }));
  const challenges = [...fromModel, ...fallbackChallenges(top.filter((c) => !seen.has(c.id)))];
  return { challenges, context, mode, model: outcome.model };
}

/** Template questions used when no LLM is available. */
function fallbackChallenges(claims: ResumeClaim[]): Challenge[] {
  return claims.map((claim) => {
    const flag = claim.flags[0];
    const question =
      flag?.type === "ownership"
        ? `You wrote "${claim.text}" — what exactly did you do yourself, and what did the rest of the team do?`
        : flag?.type === "overclaim"
          ? `You describe yourself as an expert. What is the most technically difficult problem you solved in that area?`
          : flag?.type === "buzzword"
            ? `What makes it ${flag.match}? What numbers or tests show that?`
            : claim.metrics.length
              ? `How did you measure "${claim.metrics[0]}"? What was the baseline?`
              : `Walk me through "${claim.text}". What was the result?`;
    return {
      claim,
      question,
      followUp: "What would you do differently if you did it again?",
      whatTheyTest: flag?.why ?? "Depth and ownership of the work.",
      strongAnswer: [flag?.suggestion ?? "Give specifics: your role, the approach and a measurable result."],
      sources: [],
    };
  });
}
