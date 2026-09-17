/**
 * Deterministic scoring of one job requirement against the candidate's evidence.
 *
 * Evidence comes from two places:
 *   1. semantic/keyword retrieval for the requirement text (reranked), and
 *   2. an exact lookup of every chunk that names a required skill — retrieval alone can
 *      miss a skill mentioned in a passage about something else.
 *
 * Each skill is then judged by *how* it is mentioned, looking only at the words right
 * around the skill: "familiar with Kubernetes" / "limited to EC2 and S3" → partial,
 * "I have not used MLflow" → missing (stated), a plain mention → strong. Requirements
 * phrased with "or" ("PyTorch or TensorFlow") need only one of their skills.
 */
import type { RetrievedChunk } from "../types";
import type { JdRequirement } from "./jd";
import { hasSkill } from "./skills";

export type MatchStatus = "strong" | "partial" | "missing";

export interface RequirementMatch {
  requirement: JdRequirement;
  status: MatchStatus;
  score: number;
  reason: string;
  evidence: RetrievedChunk[];
  skillsFound: string[];
  skillsMissing: string[];
}

type SkillVerdict = "strong" | "weak" | "absent" | "none";

const WEAK = /\b(familiar with|familiarity with|exposure to|basic knowledge of|limited to|some experience with|beginner)\b/gi;
const ABSENT =
  /\b(have not used|haven't used|never used|not used|no experience with|have never|only used|only tried|do not know|don't know)\b/gi;
const WINDOW = 60;

/** True when a qualifier phrase appears within a few words *before* the skill. */
function qualified(text: string, skill: string, pattern: RegExp): boolean {
  for (const m of text.matchAll(pattern)) {
    const after = text.slice(m.index, (m.index ?? 0) + m[0].length + WINDOW);
    if (hasSkill(after.split(/[.;\n]/)[0], skill)) return true;
  }
  return false;
}

// Plans ("Future work: track experiments in MLflow") are not experience.
const FUTURE_SECTION = /\b(future|roadmap|next steps?|would do differently|what i would improve)\b/i;

/** Text to search for skills: heading path + body ("EDUCATION > B.Tech in Computer Science" lives in the path). */
function searchable(c: RetrievedChunk): string {
  return c.chunk.embedText || c.chunk.text;
}

export function judgeSkill(skill: string, chunks: RetrievedChunk[]): SkillVerdict {
  let strong = false;
  let weak = false;
  let absent = false;
  for (const c of chunks) {
    if (FUTURE_SECTION.test(c.chunk.headingPath.join(" "))) continue;
    const text = searchable(c);
    if (!hasSkill(text, skill)) continue;
    if (qualified(text, skill, ABSENT)) absent = true;
    else if (qualified(text, skill, WEAK)) weak = true;
    else strong = true;
  }
  // The candidate's own statement of a gap outweighs a passing mention elsewhere.
  return absent ? "absent" : strong ? "strong" : weak ? "weak" : "none";
}

export function isAnyOf(requirement: JdRequirement): boolean {
  return /\bor\b/i.test(requirement.text);
}

export function scoreRequirement(
  requirement: JdRequirement,
  retrieved: RetrievedChunk[],
  skillMentions: RetrievedChunk[] = [],
): RequirementMatch {
  const best = retrieved[0]?.candidate.rerankScore ?? retrieved[0]?.score ?? 0;
  const pool = dedupe([...retrieved, ...skillMentions]);

  if (!requirement.skills.length) {
    const status: MatchStatus = best >= 0.5 ? "strong" : best >= 0.1 ? "partial" : "missing";
    const reason =
      status === "strong"
        ? "A closely matching passage was found."
        : status === "partial"
          ? "Related evidence found, but not a direct match."
          : "No relevant evidence found.";
    return {
      requirement,
      status,
      score: best,
      reason,
      evidence: status === "missing" ? [] : retrieved,
      skillsFound: [],
      skillsMissing: [],
    };
  }

  const verdicts = requirement.skills.map((skill) => ({ skill, verdict: judgeSkill(skill, pool) }));
  const strong = verdicts.filter((v) => v.verdict === "strong").map((v) => v.skill);
  const weak = verdicts.filter((v) => v.verdict === "weak").map((v) => v.skill);
  const absent = verdicts.filter((v) => v.verdict === "absent").map((v) => v.skill);
  const none = verdicts.filter((v) => v.verdict === "none").map((v) => v.skill);

  let status: MatchStatus;
  if (isAnyOf(requirement)) {
    status = strong.length ? "strong" : weak.length ? "partial" : "missing";
  } else if (strong.length === verdicts.length) {
    status = "strong";
  } else if (strong.length || weak.length) {
    status = "partial";
  } else {
    status = "missing";
  }
  // Retrieval found a closely matching passage even though no listed skill is named in it
  // ("data pipelines with the data engineering team" without the word "ETL").
  const relatedOnly = status === "missing" && !absent.length && best >= 0.5;
  if (relatedOnly) status = "partial";

  let reason: string;
  if (status === "strong") reason = `Evidence found for ${strong.join(", ")}.`;
  else if (relatedOnly) reason = `A closely related passage was found, but it does not name ${none.join(", ")}.`;
  else if (status === "partial" && !strong.length) reason = `Only limited experience with ${weak.join(", ")} is described.`;
  else if (status === "partial") {
    const gaps = [
      ...weak.map((s) => `only limited ${s}`),
      ...absent.map((s) => `your notes say you have not used ${s}`),
      ...(none.length ? [`no evidence of ${none.join(", ")}`] : []),
    ];
    reason = `Evidence for ${strong.join(", ")}, but ${gaps.join("; ")}.`;
  } else if (absent.length) reason = `Your own notes say you have not really used ${absent.join(", ")}.`;
  else reason = `No evidence of ${none.join(", ")} in your documents.`;

  // Show passages that mention the skills first, then the best retrieved passages.
  const mentioning = pool.filter((c) => requirement.skills.some((s) => hasSkill(searchable(c), s)));
  const evidence = dedupe([...mentioning, ...retrieved]).slice(0, 3);
  return {
    requirement,
    status,
    score: best,
    reason,
    evidence: status === "missing" && !absent.length ? [] : evidence,
    skillsFound: strong,
    skillsMissing: [...weak, ...absent, ...none],
  };
}

function dedupe(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  return chunks.filter((c) => (seen.has(c.chunk.id) ? false : (seen.add(c.chunk.id), true)));
}
