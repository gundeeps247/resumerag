"use client";

/**
 * Mock interview: the AI asks a question grounded in your documents, you answer, and the
 * answer is scored against a rubric and against your own documents (unsupported claims
 * are flagged). Difficulty adapts to how well you did.
 */
import { z } from "zod";
import { getRag } from "@/lib/client/rag-client";
import type { AppSettings } from "@/lib/client/settings";
import type { Difficulty, MockTurn, QuestionCategory } from "@/lib/db/records";
import { judgeSupport, lexicalSupport, splitAnswerSentences } from "@/lib/rag/generation/citations";
import type { BuiltContext } from "@/lib/rag/generation/context";
import { GROUNDING_RULES } from "@/lib/rag/generation/prompts";
import { CANDIDATE_FILTER, gatherEvidence, runLlmJson, validSources } from "./common";

export type MockFocus = "profile" | "technical" | "behavioral" | "project";

export interface MockConfig {
  focus: MockFocus;
  /** Project name or JD title to centre the interview on (optional). */
  topic?: string;
  length: number;
  startDifficulty: Difficulty;
}

export const RUBRIC = [
  { id: "relevance", label: "Relevance", description: "Answers the question that was asked" },
  { id: "correctness", label: "Technical correctness", description: "Statements are accurate" },
  { id: "evidence", label: "Evidence", description: "Backed by specifics from your real experience" },
  { id: "depth", label: "Depth", description: "Explains the why, trade-offs and details" },
  { id: "structure", label: "Structure", description: "Clear, logical order (e.g. STAR)" },
  { id: "clarity", label: "Clarity", description: "Concise and easy to follow" },
] as const;

const FOCUS_QUERIES: Record<MockFocus, string[]> = {
  profile: ["experience projects achievements", "technical skills", "internship work"],
  technical: ["technical implementation architecture", "machine learning model evaluation", "tools technologies"],
  behavioral: ["team disagreement conflict", "mistake lesson learned pressure", "leadership ownership"],
  project: ["project architecture design decisions", "project results metrics", "project challenges"],
};

const CATEGORY_BY_FOCUS: Record<MockFocus, QuestionCategory> = {
  profile: "project",
  technical: "technical",
  behavioral: "behavioral",
  project: "project",
};

const questionSchema = z.object({
  question: z.string(),
  category: z.enum(["recruiter", "technical", "project", "behavioral", "ai_ml", "system_design", "follow_up", "challenge"]),
  whyAsked: z.string(),
  sources: z.array(z.number().int()).max(3),
});

export interface NextQuestion {
  turn: MockTurn;
  whyAsked: string;
  context: BuiltContext;
  error?: string;
}

export async function nextQuestion(
  config: MockConfig,
  previous: MockTurn[],
  difficulty: Difficulty,
  settings: AppSettings,
): Promise<NextQuestion> {
  const queries = config.topic
    ? [config.topic, ...FOCUS_QUERIES[config.focus].map((q) => `${config.topic} ${q}`)]
    : FOCUS_QUERIES[config.focus];
  const { context } = await gatherEvidence(queries, settings, { filter: CANDIDATE_FILTER, perQuery: 3, maxSources: 6 });
  const asked = previous.map((t, i) => `${i + 1}. ${t.question}`).join("\n") || "(none yet)";
  const last = previous.at(-1);
  const followUpHint =
    last?.answer && last.evaluation && last.evaluation.overall >= 6
      ? `The candidate's last answer was: "${last.answer.slice(0, 400)}". You may ask a deeper follow-up on it.`
      : "";

  const outcome = await runLlmJson(
    settings,
    [
      { role: "system", content: `You are conducting a realistic job interview. Ask ONE question at a time.\n\n${GROUNDING_RULES}` },
      {
        role: "user",
        content: `<sources>\n${context.text}\n</sources>\n\nInterview focus: ${config.focus}${config.topic ? ` — ${config.topic}` : ""}. Difficulty: ${difficulty}.
Questions already asked:\n${asked}\n${followUpHint}

Ask the next interview question. It must be specific to the candidate's documents (mention a real project, tool or claim), must not repeat earlier questions, and should match the difficulty. Return JSON: {"question":"...","category":"technical","whyAsked":"...","sources":[1]}`,
      },
    ],
    questionSchema,
    { maxTokens: 250, temperature: 0.7 },
  );

  const base = { difficulty, answer: undefined, evaluation: undefined };
  if (outcome.data) {
    const sources = validSources(outcome.data.sources, context);
    return {
      turn: {
        ...base,
        question: outcome.data.question,
        category: outcome.data.category,
        evidenceChunkIds: sources.map((n) => context.sources[n - 1].result.chunk.id),
      },
      whyAsked: outcome.data.whyAsked,
      context,
    };
  }
  const source = context.sources[previous.length % Math.max(1, context.sources.length)];
  const heading = source?.result.chunk.headingPath.at(-1) ?? "your most recent project";
  return {
    turn: {
      ...base,
      question: `Tell me about ${heading}. What was your role and what was the outcome?`,
      category: CATEGORY_BY_FOCUS[config.focus],
      evidenceChunkIds: source ? [source.result.chunk.id] : [],
    },
    whyAsked: "Template question (no language model connected).",
    context,
    error: outcome.error,
  };
}

const evaluationSchema = z.object({
  scores: z.object({
    relevance: z.number().int().min(1).max(5),
    correctness: z.number().int().min(1).max(5),
    evidence: z.number().int().min(1).max(5),
    depth: z.number().int().min(1).max(5),
    structure: z.number().int().min(1).max(5),
    clarity: z.number().int().min(1).max(5),
  }),
  strengths: z.array(z.string()).max(3),
  improvements: z.array(z.string()).max(3),
  betterAnswerOutline: z.string(),
});

/**
 * Sentences of the candidate's answer that nothing in their documents supports. Uses the
 * same check as Ask's citation verification (sentence similarity, shared wording, and every
 * number must appear in a source), so the result is reproducible and works without an LLM —
 * small models asked to list "unsupported claims" tend to list off-topic remarks instead.
 */
export async function unbackedSentences(answer: string, settings: AppSettings): Promise<string[]> {
  const sentences = splitAnswerSentences(answer)
    .map((s) => s.text)
    .filter((s) => s.split(/\s+/).length >= 5)
    .slice(0, 10);
  if (!sentences.length) return [];
  const { context } = await gatherEvidence(sentences, settings, {
    filter: CANDIDATE_FILTER,
    perQuery: 2,
    maxSources: 10,
    maxTokens: 4000,
    skipUnconfident: false,
  });
  if (!context.sources.length) return sentences;
  const ids = context.sources.map((s) => s.result.chunk.id);
  const passages = context.sources.map((s) => s.result.chunk.text);
  const scores = await getRag().supportScores(
    sentences,
    sentences.map(() => ids),
  );
  return sentences.filter((s, i) => !judgeSupport(scores[i]?.best ?? 0, lexicalSupport(s, passages)));
}

export interface DeliveryStats {
  words: number;
  speakingSeconds: number;
  numbers: number;
  fillers: number;
  firstPersonRatio: number;
  starSignals: number;
}

/** Deterministic delivery statistics — no LLM involved. */
export function deliveryStats(answer: string): DeliveryStats {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  const lower = answer.toLowerCase();
  const i = (lower.match(/\b(i|i'm|i've|my|me)\b/g) ?? []).length;
  const we = (lower.match(/\b(we|we're|we've|our|us)\b/g) ?? []).length;
  const signals = [
    /\b(situation|context|at the time|when i was)\b/,
    /\b(task|goal|needed to|responsible)\b/,
    /\b(i (built|decided|wrote|led|proposed|analy[sz]ed|designed|implemented))\b/,
    /\b(result|outcome|so that|which led|reduced|improved|increased|learned)\b/,
  ];
  return {
    words: words.length,
    speakingSeconds: Math.round((words.length / 140) * 60),
    numbers: (answer.match(/\d/g) ? answer.match(/\b\d[\d.,%]*\b/g)?.length : 0) ?? 0,
    fillers: (lower.match(/\b(um|uh|like|basically|actually|you know|sort of|kind of)\b/g) ?? []).length,
    firstPersonRatio: i + we ? i / (i + we) : 0,
    starSignals: signals.filter((s) => s.test(lower)).length,
  };
}

export interface AnswerEvaluation {
  evaluation: NonNullable<MockTurn["evaluation"]>;
  context: BuiltContext;
  stats: DeliveryStats;
  error?: string;
}

export async function evaluateAnswer(
  turn: MockTurn,
  answer: string,
  settings: AppSettings,
  onProgress?: (chars: number) => void,
): Promise<AnswerEvaluation> {
  const stats = deliveryStats(answer);
  const { context } = await gatherEvidence([turn.question, answer.slice(0, 500)], settings, {
    filter: CANDIDATE_FILTER,
    perQuery: 3,
    maxSources: 5,
  });

  // The claim check is deterministic and runs while the model writes its feedback.
  const claimCheck = unbackedSentences(answer, settings).catch(() => [] as string[]);
  const outcome = await runLlmJson(
    settings,
    [
      {
        role: "system",
        content: `You are an experienced interviewer giving honest, constructive feedback on a candidate's answer.

${GROUNDING_RULES}
- The sources are the candidate's own documents. Use them to judge technical correctness and evidence.
- Score each rubric item from 1 (poor) to 5 (excellent). Be calibrated: 3 means acceptable, 5 is rare.
- If the answer does not address the question that was asked, relevance must be 1 or 2, and say so in "improvements".
- "betterAnswerOutline" is a short outline of a stronger answer using facts from the sources, with [n] citations.`,
      },
      {
        role: "user",
        content: `<sources>\n${context.text}\n</sources>\n\nQuestion (${turn.difficulty}): ${turn.question}\n\nCandidate's answer:\n"""${answer.slice(0, 4000)}"""

Rubric: relevance, correctness, evidence (specific, real examples), depth, structure, clarity.
Return JSON: {"scores":{"relevance":3,"correctness":3,"evidence":3,"depth":3,"structure":3,"clarity":3},"strengths":["..."],"improvements":["..."],"betterAnswerOutline":"..."}`,
      },
    ],
    evaluationSchema,
    { maxTokens: 700, temperature: 0.2 },
    onProgress,
  );

  const unsupportedClaims = await claimCheck;
  if (outcome.data) {
    const s = outcome.data.scores;
    const overall = Math.round((Object.values(s).reduce((a, b) => a + b, 0) / 6) * 2 * 10) / 10;
    return { evaluation: { ...outcome.data, unsupportedClaims, overall }, context, stats };
  }

  // Heuristic scoring without an LLM: length, structure and specificity only.
  const scoreFrom = (v: number) => Math.max(1, Math.min(5, Math.round(v)));
  const scores = {
    relevance: 3,
    correctness: 3,
    evidence: scoreFrom(1 + stats.numbers),
    depth: scoreFrom(stats.words / 50),
    structure: scoreFrom(1 + stats.starSignals),
    clarity: scoreFrom(5 - stats.fillers / 2 - (stats.words > 350 ? 1 : 0)),
  };
  return {
    evaluation: {
      overall: Math.round((Object.values(scores).reduce((a, b) => a + b, 0) / 6) * 2 * 10) / 10,
      scores,
      strengths: stats.numbers ? ["You used concrete numbers."] : [],
      improvements: ["Connect a language model for detailed feedback — this score is based only on length, structure and specificity."],
      unsupportedClaims,
      betterAnswerOutline: "",
    },
    context,
    stats,
    error: outcome.error,
  };
}

export function adaptDifficulty(current: Difficulty, overall: number): Difficulty {
  const order: Difficulty[] = ["easy", "medium", "hard"];
  const i = order.indexOf(current);
  if (overall >= 7.5) return order[Math.min(2, i + 1)];
  if (overall < 5) return order[Math.max(0, i - 1)];
  return current;
}
