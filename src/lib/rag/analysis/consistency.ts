/**
 * Consistency checker: finds numbers that disagree across documents.
 *
 * Step 1 (deterministic): extract "numeric facts" — a number tied to what it measures.
 *   - metrics take the number that follows the metric word ("AUC of 0.91", "latency by 40%")
 *   - counts take the number directly in front of the noun ("120,000 customers")
 *   - team size uses "team of N" (number words like "four" are understood)
 * Step 2: pair facts from *different* documents that measure the same thing but give
 * different values. "40+" is treated as a lower bound, so "43" does not contradict it.
 * Step 3 (optional LLM): confirm or dismiss each candidate and explain it.
 *
 * Interviewers compare your resume with what you say and with your other materials,
 * so catching "AUC 0.91 on the resume, 0.89 in the report" before they do matters.
 */

export interface NumericFact {
  key: string;
  value: number;
  unit: string;
  raw: string;
  sentence: string;
  chunkId: string;
  docId: string;
  docName: string;
}

export interface FactSource {
  chunkId: string;
  docId: string;
  docName: string;
  text: string;
}

export interface ConsistencyCandidate {
  id: string;
  key: string;
  a: NumericFact;
  b: NumericFact;
  /** 0–1 heuristic: how likely this is a real contradiction worth reviewing. */
  score: number;
}

const NUM = "\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve";
const NUMBER_AFTER = new RegExp(`(?<![\\w@.])(${NUM})\\s*(%|x\\b|ms\\b|\\+)?`, "i");
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};

type KeyDef =
  { key: string; kind: "metric"; pattern: RegExp; searchFrom?: "start" | "end" } | { key: string; kind: "count" | "team"; pattern: RegExp };

/** A number directly before the noun, with at most one word in between ("40+ behavioural features"). */
function countPattern(noun: string): RegExp {
  return new RegExp(`(?<![\\w.@])(${NUM})\\s*(\\+)?\\s+(?:[a-z-]+\\s+)?(?:${noun})\\b`, "i");
}

const KEYS: KeyDef[] = [
  { key: "AUC", kind: "metric", pattern: /\b(?:roc[- ])?auc\b/i },
  { key: "accuracy", kind: "metric", pattern: /\baccuracy\b/i },
  { key: "precision", kind: "metric", pattern: /\bprecision\b/i },
  { key: "recall", kind: "metric", pattern: /\brecall\b/i },
  { key: "F1", kind: "metric", pattern: /\bf1\b/i },
  { key: "MRR", kind: "metric", pattern: /\bmrr(?:@\d+)?/i },
  { key: "latency", kind: "metric", pattern: /\blatency\b/i },
  { key: "test coverage", kind: "metric", pattern: /\bcoverage\b/i },
  { key: "GPA", kind: "metric", pattern: /\bc?gpa\b/i },
  {
    key: "churn reduction",
    kind: "metric",
    searchFrom: "start",
    pattern: /\bchurn\b.{0,40}\b(?:reduc|lower|decreas|drop)\w*|\b(?:reduc|lower|decreas|drop)\w*\b.{0,30}\bchurn\b/i,
  },
  { key: "team size", kind: "team", pattern: new RegExp(`\\bteam of\\s+(${NUM})\\b`, "i") },
  { key: "customers", kind: "count", pattern: countPattern("customers?") },
  { key: "users", kind: "count", pattern: countPattern("users|students") },
  { key: "requests", kind: "count", pattern: countPattern("requests") },
  { key: "features", kind: "count", pattern: countPattern("features") },
  { key: "events", kind: "count", pattern: countPattern("events") },
];

function sentencesOf(text: string): string[] {
  return text
    .replace(/^- /gm, "")
    .split(/(?<=[.!?])\s+(?=[A-Z])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

function toValue(token: string): number {
  const lower = token.toLowerCase();
  return NUMBER_WORDS[lower] ?? Number(lower.replace(/,/g, ""));
}

function extractOne(def: KeyDef, sentence: string): { value: number; unit: string; raw: string } | null {
  const match = sentence.match(def.pattern);
  if (!match || match.index === undefined) return null;

  if (def.kind === "count" || def.kind === "team") {
    // "a team of four students" describes team size, not a user count.
    if (def.kind === "count" && /\bteam of\s*$/i.test(sentence.slice(0, match.index))) return null;
    const unit = def.kind === "count" ? (match[2] ?? "") : "";
    return { value: toValue(match[1]), unit, raw: `${match[1]}${unit}` };
  }

  // Metrics: the value follows the metric word (or, for churn, may sit inside the phrase).
  const from = "searchFrom" in def && def.searchFrom === "start" ? match.index : match.index + match[0].length;
  const window = sentence.slice(from, match.index + match[0].length + 50);
  const num = window.match(NUMBER_AFTER);
  if (!num) return null;
  return { value: toValue(num[1]), unit: (num[2] ?? "").toLowerCase(), raw: num[0].trim() };
}

export function extractNumericFacts(source: FactSource): NumericFact[] {
  const facts: NumericFact[] = [];
  for (const sentence of sentencesOf(source.text)) {
    for (const def of KEYS) {
      const found = extractOne(def, sentence);
      if (!found || !Number.isFinite(found.value)) continue;
      // Years are not metrics ("2021 - 2025").
      if (found.value >= 1900 && found.value <= 2100 && !found.unit) continue;
      facts.push({ key: def.key, ...found, sentence, chunkId: source.chunkId, docId: source.docId, docName: source.docName });
    }
  }
  return facts;
}

/** "40+" is a lower bound: any value at or above it is consistent. */
function compatible(a: NumericFact, b: NumericFact): boolean {
  if (a.value === b.value) return true;
  if (a.unit === "+" && b.value >= a.value) return true;
  if (b.unit === "+" && a.value >= b.value) return true;
  return false;
}

// "My first model reached 0.97" vs "the final model reached 0.89" are different stages.
const STAGE = /\b(first|initial|early|earlier|before|originally|baseline|prototype)\b/i;

export function findInconsistencies(sources: FactSource[]): ConsistencyCandidate[] {
  const facts = sources.flatMap(extractNumericFacts);
  const candidates: Omit<ConsistencyCandidate, "id">[] = [];
  const seenSentences = new Set<string>();

  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i];
      const b = facts[j];
      if (a.docId === b.docId || a.key !== b.key || compatible(a, b)) continue;
      // Compare like with like: percentages with percentages, plain numbers with plain numbers.
      if ((a.unit === "%") !== (b.unit === "%")) continue;
      const pairKey = [a.sentence, b.sentence].sort().join("|");
      if (seenSentences.has(pairKey)) continue;
      seenSentences.add(pairKey);

      const relDiff = Math.abs(a.value - b.value) / Math.max(Math.abs(a.value), Math.abs(b.value), 1e-9);
      let score = 0.35 + overlap(a.sentence, b.sentence) * 0.9 + (relDiff < 0.5 ? 0.15 : 0);
      if (STAGE.test(a.sentence) !== STAGE.test(b.sentence)) score -= 0.3;
      candidates.push({ key: a.key, a, b, score: Math.max(0, Math.min(1, score)) });
    }
  }

  // The same two values from the same two documents, phrased differently, count once.
  const seenValues = new Set<string>();
  return candidates
    .sort((x, y) => y.score - x.score)
    .filter((c) => {
      const valueKey = `${c.key}|${[`${c.a.docId}:${c.a.value}`, `${c.b.docId}:${c.b.value}`].sort().join("|")}`;
      if (seenValues.has(valueKey)) return false;
      seenValues.add(valueKey);
      return true;
    })
    .map((c, i) => ({ ...c, id: `c${i + 1}` }));
}

function overlap(x: string, y: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wx = words(x);
  const wy = words(y);
  const shared = [...wx].filter((w) => wy.has(w)).length;
  return shared / Math.max(1, Math.min(wx.size, wy.size));
}
