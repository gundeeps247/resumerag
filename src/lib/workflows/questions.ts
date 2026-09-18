"use client";

/** Interview question generator, grounded in the candidate's documents. */
import { z } from "zod";
import type { AppSettings } from "@/lib/client/settings";
import type { Difficulty, QuestionCategory } from "@/lib/db/records";
import type { BuiltContext } from "@/lib/rag/generation/context";
import { GROUNDING_RULES } from "@/lib/rag/generation/prompts";
import { CANDIDATE_FILTER, fallbackReason, gatherEvidence, runLlmJson, validSources } from "./common";

export const CATEGORY_INFO: Record<QuestionCategory, { label: string; description: string; queries: string[] }> = {
  recruiter: {
    label: "Recruiter screen",
    description: "Motivation, background and fit",
    queries: ["summary background education", "work experience internships", "achievements awards"],
  },
  technical: {
    label: "Technical",
    description: "Tools, languages and fundamentals you list",
    queries: [
      "technical skills programming languages frameworks",
      "tools and technologies used in projects",
      "machine learning models trained",
    ],
  },
  project: {
    label: "Project",
    description: "Design, decisions and results of your projects",
    queries: ["projects built architecture", "project results evaluation metrics", "design decisions trade-offs"],
  },
  behavioral: {
    label: "Behavioural",
    description: "Teamwork, conflict, ownership, pressure",
    queries: ["disagreement conflict with a teammate", "led a team leadership", "deadline pressure mistake lesson learned"],
  },
  ai_ml: {
    label: "AI / ML",
    description: "Modelling, evaluation, data and MLOps",
    queries: [
      "machine learning model training evaluation",
      "data features imbalance leakage",
      "embeddings search retrieval models deployment",
    ],
  },
  system_design: {
    label: "System design",
    description: "Scaling and architecture of what you built",
    queries: ["architecture deployment pipeline api", "latency throughput scale requests", "monitoring data drift production"],
  },
  follow_up: {
    label: "Follow-ups",
    description: "Probing questions behind your resume bullets",
    queries: ["results metrics improvements percent", "my contribution owned built", "challenges problems"],
  },
  challenge: {
    label: "Tough challenges",
    description: "Hard questions on ambitious claims",
    queries: ["reduced improved increased by percent", "expert scalable fault-tolerant", "helped contributed team"],
  },
};

const DIFFICULTY_TEXT: Record<Difficulty, string> = {
  easy: "easy warm-up questions a recruiter or junior interviewer would ask",
  medium: "medium questions that require specific examples and explanations",
  hard: "hard, probing questions a senior interviewer would use to test depth, trade-offs and ownership",
};

const schema = z.object({
  questions: z
    .array(
      z.object({ question: z.string().min(1), whyAsked: z.string().default(""), sources: z.array(z.number().int()).max(3).default([]) }),
    )
    .max(10),
});

export interface GeneratedQuestion {
  question: string;
  whyAsked: string;
  sources: number[];
  category: QuestionCategory;
  difficulty: Difficulty;
}

export interface QuestionSet {
  questions: GeneratedQuestion[];
  context: BuiltContext;
  error?: string;
}

export async function generateQuestions(
  input: { category: QuestionCategory; difficulty: Difficulty; count: number; focus?: string },
  settings: AppSettings,
  onProgress?: (chars: number) => void,
): Promise<QuestionSet> {
  const info = CATEGORY_INFO[input.category];
  const queries = input.focus ? [input.focus, ...info.queries.slice(0, 2).map((q) => `${input.focus} ${q}`)] : info.queries;
  const { context } = await gatherEvidence(queries, settings, { filter: CANDIDATE_FILTER, perQuery: 3, maxSources: 7 });

  const outcome = await runLlmJson(
    settings,
    [
      { role: "system", content: `You are an interviewer preparing questions tailored to this specific candidate.\n\n${GROUNDING_RULES}` },
      {
        role: "user",
        content: `<sources>\n${context.text}\n</sources>\n\nWrite ${input.count} ${info.label.toLowerCase()} interview questions (${info.description.toLowerCase()}). They should be ${DIFFICULTY_TEXT[input.difficulty]}.${input.focus ? ` Focus on: ${input.focus}.` : ""}
Every question must refer to something specific in the sources (a project, tool, number or story). For each, explain in one sentence why an interviewer would ask it and cite the source it is based on.

Return JSON: {"questions":[{"question":"...","whyAsked":"...","sources":[1]}]}`,
      },
    ],
    schema,
    { maxTokens: 900, temperature: 0.6 },
    onProgress,
  );

  if (!outcome.data) {
    return { questions: fallbackQuestions(input, context, fallbackReason(outcome.error)), context, error: outcome.error };
  }
  return {
    context,
    questions: outcome.data.questions.slice(0, input.count).map((q) => ({
      ...q,
      sources: validSources(q.sources, context),
      category: input.category,
      difficulty: input.difficulty,
    })),
  };
}

/** Template-based questions built from the retrieved passages (no LLM). */
function fallbackQuestions(
  input: { category: QuestionCategory; difficulty: Difficulty; count: number },
  context: BuiltContext,
  reason: string,
): GeneratedQuestion[] {
  const templates = [
    (h: string) => `Tell me about "${h}". What was your role?`,
    (h: string) => `What was the hardest technical decision in "${h}"?`,
    (h: string) => `How did you measure success for "${h}"?`,
    (h: string) => `What would you do differently in "${h}"?`,
  ];
  return context.sources.slice(0, input.count).map((s, i) => {
    const heading = s.result.chunk.headingPath.at(-1) ?? s.result.document.name;
    return {
      question: templates[i % templates.length](heading),
      whyAsked: `Generated from a template — ${reason}.`,
      sources: [s.n],
      category: input.category,
      difficulty: input.difficulty,
    };
  });
}
