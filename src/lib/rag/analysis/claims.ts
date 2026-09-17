/**
 * Resume claim analysis ("Weakness Detector").
 *
 * Every resume bullet is a claim an interviewer may challenge. These transparent rules
 * flag the patterns interviewers are trained to probe: vague ownership ("helped"),
 * unquantified impact, expert-level claims, architecture buzzwords without numbers and
 * weak skill claims ("familiar with"). The LLM later turns flagged claims into concrete
 * challenge questions — but the detection itself is deterministic and explainable.
 */
import type { ConsistencyCandidate } from "./consistency";
import { extractSkills } from "./skills";

export type Severity = "high" | "medium" | "low";

export type FlagType = "ownership" | "vague" | "overclaim" | "buzzword" | "weak_skill" | "no_metric" | "big_metric" | "inconsistent";

export interface ClaimFlag {
  type: FlagType;
  severity: Severity;
  label: string;
  why: string;
  suggestion: string;
  match?: string;
}

export interface ClaimSource {
  chunkId: string;
  docId: string;
  docName: string;
  headingPath: string[];
  text: string;
}

export interface ResumeClaim {
  id: string;
  text: string;
  section: string;
  chunkId: string;
  docId: string;
  docName: string;
  metrics: string[];
  skills: string[];
  flags: ClaimFlag[];
  /** Higher = more likely to be challenged in an interview. */
  challengeScore: number;
}

interface Rule {
  type: FlagType;
  severity: Severity;
  pattern: RegExp;
  label: string;
  why: string;
  suggestion: string;
  /** Only flag when the claim has no number in it. */
  requiresNoMetric?: boolean;
}

const RULES: Rule[] = [
  {
    type: "ownership",
    severity: "high",
    pattern: /\b(helped|assisted|contributed to|involved in|participated in|supported|was part of|collaborated on)\b/i,
    label: "Unclear ownership",
    why: "Interviewers will ask what you personally did versus the team — especially when the claim includes a big result.",
    suggestion: 'State the part you owned: "I built …, which the team used to …".',
  },
  {
    type: "overclaim",
    severity: "high",
    pattern:
      /\b(expert|mastery|master of|guru|ninja|rockstar|world[- ]class|best[- ]in[- ]class|extensive experience|highly proficient)\b/i,
    label: "Expert-level claim",
    why: '"Expert" invites the hardest questions in that area; one gap undermines the whole resume.',
    suggestion: "Replace the adjective with evidence: what you built, at what scale, with what result.",
  },
  {
    type: "vague",
    severity: "medium",
    pattern: /\b(worked on|responsible for|handled|dealt with|various|several|multiple|numerous|many|etc\.?|and more|some)\b/i,
    label: "Vague wording",
    why: 'Vague phrasing leads straight to "Can you give a concrete example?"',
    suggestion: "Name one specific thing you did and its outcome.",
  },
  {
    type: "buzzword",
    severity: "medium",
    pattern:
      /\b(scalable|fault[- ]tolerant|robust|high[- ]performance|production[- ]grade|cutting[- ]edge|state[- ]of[- ]the[- ]art|seamless|highly available|optimi[sz]ed|efficient)\b/i,
    label: "Buzzword without numbers",
    why: 'Architecture adjectives prompt "How many users or requests? How did you test that?"',
    suggestion: "Back it with a number (throughput, latency, users) or describe the mechanism.",
    requiresNoMetric: true,
  },
  {
    type: "weak_skill",
    severity: "low",
    pattern: /\b(familiar with|exposure to|basic knowledge|beginner|some experience)\b/i,
    label: "Weak skill claim",
    why: "Interviewers may probe to find where your knowledge ends. Be ready to say honestly what you have and have not done.",
    suggestion: "Prepare one concrete thing you did with it, or remove it.",
  },
];

// Money, numbers with units (40%, 5x, 120 ms, 2M+), decimals (0.91), thousands (120,000)
// and counts of things (40 features). Alternatives are tried left to right.
const METRIC =
  /\$\s?\d[\d,.]*\s?[kmb]?\b|\d[\d,]*(?:\.\d+)?\s?(?:%|x\b|ms\b|k\b\+?|m\b\+?|\+)|\b\d+\.\d+\b|\b\d{1,3}(?:,\d{3})+\b\+?|\b\d+(?=\s*(?:\/\d+|percent|users|customers|students|requests|events|features|people|members|queries|documents|judgments|hours|days|weeks|months|trials)\b)/gi;
const ACTION_START =
  /^(built|developed|designed|implemented|created|led|engineered|deployed|trained|improved|reduced|increased|optimi[sz]ed|launched|automated|introduced|wrote|migrated|architected|analy[sz]ed|achieved|processed|used|worked|helped|managed)\b/i;
const NOT_A_CLAIM =
  /^(?:[\w\s.]+:\s)?(?:[A-Z][\w+#.-]*(?:,\s*|\s*\|\s*|$)){3,}$|@|\+\d[\d\s-]{6,}|^\w{3} \d{4}\s*[-–]|^\d{4}\s*[-–]\s*\d{4}/;

export function extractMetrics(text: string): string[] {
  return [...new Set(text.match(METRIC)?.map((m) => m.trim()) ?? [])];
}

export function analyzeClaim(text: string): { flags: ClaimFlag[]; metrics: string[]; skills: string[] } {
  const metrics = extractMetrics(text);
  const flags: ClaimFlag[] = [];
  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (!match || (rule.requiresNoMetric && metrics.length)) continue;
    const severity = rule.type === "ownership" && !metrics.length ? "medium" : rule.severity;
    flags.push({ type: rule.type, severity, label: rule.label, why: rule.why, suggestion: rule.suggestion, match: match[0] });
  }
  if (!metrics.length && ACTION_START.test(text) && !flags.some((f) => f.type === "vague")) {
    flags.push({
      type: "no_metric",
      severity: "low",
      label: "No measurable impact",
      why: 'Without a number, expect "What was the result, and how did you measure it?"',
      suggestion: "Add scale or impact: users, latency, accuracy, time saved.",
    });
  }
  const bigPercent = metrics.find((m) => /%/.test(m) && parseFloat(m) >= 15);
  // "from 52% to 81%" or "0.72 versus 0.51" already states the baseline.
  const hasBaseline = /\bfrom\s+\$?\d[\d.,]*%?\s+to\s+\$?\d|\b(versus|vs\.?|compared (with|to)|baseline)\b/i.test(text);
  if (!hasBaseline && (bigPercent || metrics.some((m) => /\d\s?x\b/i.test(m)))) {
    flags.push({
      type: "big_metric",
      severity: "medium",
      label: "Big number to defend",
      why: "Large improvements get questioned: what was the baseline, how was it measured, and how much was your contribution?",
      suggestion: "Prepare the baseline, measurement method and your share of the result.",
      match: bigPercent,
    });
  }
  return { flags, metrics, skills: extractSkills(text).map((s) => s.name) };
}

const WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

/** Comma-separated lists ("Python, SQL, Docker, AWS") are skill inventories, not claims. */
function isList(text: string): boolean {
  const commas = (text.match(/,/g) ?? []).length;
  const words = text.split(/\s+/).length;
  return commas >= 3 && words / (commas + 1) <= 3;
}

/**
 * Adds a "Conflicts with another document" flag to claims whose numbers disagree with the
 * candidate's other documents (from the consistency checker).
 */
export function flagConflicts(claims: ResumeClaim[], candidates: ConsistencyCandidate[]): ResumeClaim[] {
  const out = claims.map((claim) => {
    const hits = candidates
      .map((c) => {
        const own = [c.a, c.b].find((f) => f.docId === claim.docId && (claim.text.includes(f.sentence) || f.sentence.includes(claim.text)));
        const other = own === c.a ? c.b : c.a;
        return own ? { own, other, score: c.score } : null;
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .sort((x, y) => y.score - x.score);
    const best = hits[0];
    if (!best) return claim;
    const flag: ClaimFlag = {
      type: "inconsistent",
      severity: "high",
      label: "Conflicts with another document",
      why: `${best.other.docName} says “${best.other.sentence}” (${best.own.key}: ${best.other.raw} vs ${best.own.raw} here). An interviewer who reads both will ask.`,
      suggestion: "Make the numbers match, or prepare a one-line explanation of why they differ.",
      match: best.own.raw,
    };
    return { ...claim, flags: [flag, ...claim.flags], challengeScore: claim.challengeScore + WEIGHT.high + 1 };
  });
  return out.sort((a, b) => b.challengeScore - a.challengeScore);
}

/** Splits resume chunks into individual claims (bullets and summary sentences) and analyses each. */
export function extractClaims(chunks: ClaimSource[]): ResumeClaim[] {
  const claims: ResumeClaim[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const section = chunk.headingPath.slice(-2).join(" > ") || "General";
    const lines = chunk.text.split("\n").flatMap((line) => {
      const trimmed = line.replace(/^-\s+/, "").trim();
      return line.startsWith("- ") ? [trimmed] : trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/);
    });
    for (const raw of lines) {
      const text = raw.trim();
      const key = text.toLowerCase();
      if (text.split(/\s+/).length < 4 || seen.has(key)) continue;
      const weakSkillLine = /familiar with|exposure to|basic knowledge/i.test(text);
      if ((NOT_A_CLAIM.test(text) || isList(text)) && !weakSkillLine) continue;
      seen.add(key);
      const { flags, metrics, skills } = analyzeClaim(text);
      claims.push({
        id: `${chunk.chunkId}#${claims.length}`,
        text,
        section,
        chunkId: chunk.chunkId,
        docId: chunk.docId,
        docName: chunk.docName,
        metrics,
        skills,
        flags,
        challengeScore:
          flags.reduce((n, f) => n + WEIGHT[f.severity], 0) + Math.min(2, metrics.length) * 0.5 + Math.min(3, skills.length) * 0.3,
      });
    }
  }
  return claims.sort((a, b) => b.challengeScore - a.challengeScore);
}
