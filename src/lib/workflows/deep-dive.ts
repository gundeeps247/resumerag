"use client";

/**
 * Project deep dive: pick a project, see what your documents say about it, get it
 * explained at five levels of depth, and practise a ladder of increasingly hard questions.
 */
import { z } from "zod";
import { getRag } from "@/lib/client/rag-client";
import type { AppSettings } from "@/lib/client/settings";
import { streamChat } from "@/lib/llm/client";
import { detectProjects, type DetectedProject } from "@/lib/rag/analysis/projects";
import type { BuiltContext } from "@/lib/rag/generation/context";
import { GROUNDING_RULES } from "@/lib/rag/generation/prompts";
import { EMPLOYER_DOC_TYPES } from "@/lib/rag/types";
import { CANDIDATE_FILTER, gatherEvidence, loadDocTitles, runLlmJson, validSources } from "./common";

export async function listProjects(): Promise<DetectedProject[]> {
  const chunks = (await getRag().listChunks()).filter((c) => !EMPLOYER_DOC_TYPES.includes(c.docType));
  const titles = await loadDocTitles(chunks.map((c) => c.docId));
  return detectProjects(
    chunks.map((c) => ({ id: c.id, docId: c.docId, docName: c.docName, docType: c.docType, headingPath: c.headingPath, text: c.text })),
    titles,
  );
}

/** Aspects every project story should cover; checked deterministically against the evidence. */
export const PREP_ASPECTS = [
  { id: "problem", label: "Problem and motivation", pattern: /\b(problem|goal|wanted to|needed|motivation|because|so that|pain)\b/i },
  {
    id: "architecture",
    label: "Architecture / approach",
    pattern: /\b(architecture|pipeline|built|designed|model|index|api|component|approach)\b/i,
  },
  {
    id: "alternatives",
    label: "Alternatives considered",
    pattern: /\b(instead of|compared|alternative|tried|rejected|chose|over a|versus|vs\.?|baseline)\b/i,
  },
  {
    id: "evaluation",
    label: "Evaluation and metrics",
    pattern: /\b(auc|accuracy|precision|recall|mrr|f1|evaluat|metric|benchmark|annotated)\b/i,
  },
  {
    id: "scale",
    label: "Scale and performance",
    pattern: /\b(users|requests|per second|latency|throughput|scale|customers|students|\d{2,}[,\d]*\s*(ms|k|m))\b/i,
  },
  {
    id: "contribution",
    label: "Your personal contribution",
    pattern: /\bI (built|owned|wrote|designed|implemented|led|trained|engineered|proposed|removed|switched)\b/i,
  },
  {
    id: "challenges",
    label: "Challenges and failures",
    pattern: /\b(challenge|problem|issue|bug|leak|failed|mistake|struggled|too good to be true)\b/i,
  },
  {
    id: "improvements",
    label: "What you would improve",
    pattern: /\b(future work|improve|differently|next step|would add|roadmap|hindsight)\b/i,
  },
] as const;

export interface PrepCheck {
  id: string;
  label: string;
  covered: boolean;
  source?: number;
}

export interface ProjectBrief {
  project: DetectedProject;
  context: BuiltContext;
  checklist: PrepCheck[];
}

export async function prepareProject(project: DetectedProject, settings: AppSettings): Promise<ProjectBrief> {
  // Full name keeps distinctive words ("… - Finlytics"); searching only the documents where
  // the project was detected keeps other projects out of the evidence.
  const name = project.name;
  const { context } = await gatherEvidence(
    [
      name,
      `${name} architecture and design decisions`,
      `${name} results evaluation metrics`,
      `${name} challenges problems lessons learned`,
      `${name} my contribution what I built`,
    ],
    settings,
    { filter: { ...CANDIDATE_FILTER, docIds: project.docIds }, perQuery: 3, maxSources: 8, maxTokens: 2800, skipUnconfident: false },
  );
  // Keep only sources that are actually about this project when possible.
  const checklist = PREP_ASPECTS.map((aspect) => {
    const hit = context.sources.find((s) => aspect.pattern.test(s.result.chunk.text));
    return { id: aspect.id, label: aspect.label, covered: Boolean(hit), source: hit?.n };
  });
  return { project, context, checklist };
}

export const EXPLANATION_LEVELS = [
  {
    id: "pitch",
    label: "30-second pitch",
    instruction: "A 30-second spoken pitch: 2-3 sentences covering what it is, your role and one concrete result.",
  },
  {
    id: "recruiter",
    label: "Recruiter",
    instruction:
      "For a non-technical recruiter: plain language, the business problem, what you did and the impact. About 80 words, no jargon.",
  },
  {
    id: "technical",
    label: "Technical interviewer",
    instruction: "For a technical interviewer: problem, approach, key technical decisions and results with numbers. About 150 words.",
  },
  {
    id: "architecture",
    label: "Architecture",
    instruction: "An architecture walkthrough: the components and the data flow, step by step, as a numbered list.",
  },
  {
    id: "deep",
    label: "Deep dive",
    instruction:
      "A deep technical dive as bullet points: trade-offs, alternatives considered, failure modes, how it was evaluated, and what you would improve.",
  },
] as const;

export type ExplanationLevel = (typeof EXPLANATION_LEVELS)[number]["id"];

export async function* streamExplanation(
  brief: ProjectBrief,
  level: ExplanationLevel,
  settings: AppSettings,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const spec = EXPLANATION_LEVELS.find((l) => l.id === level)!;
  const system = `You help a candidate explain their own project in interviews, speaking in the first person ("I built…").

${GROUNDING_RULES}
- Cite sources as [n] after the sentences they support.
- If an important detail is not in the sources (for example scale or alternatives), write "(not in your documents — prepare this)" instead of inventing it.`;
  const user = `<sources>\n${brief.context.text}\n</sources>\n\nProject: ${brief.project.name}\n\nWrite: ${spec.instruction}\nOutput only the explanation in markdown.`;
  let text = "";
  for await (const event of streamChat(
    settings.llm,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.3, maxTokens: level === "deep" || level === "architecture" ? 600 : 350, signal },
  )) {
    if (event.type === "delta") {
      text += event.text;
      yield text;
    }
  }
}

const ladderSchema = z.object({
  questions: z
    .array(
      z.object({
        level: z.number().int().min(1).max(5),
        question: z.string(),
        category: z.enum([
          "problem",
          "design",
          "alternatives",
          "implementation",
          "evaluation",
          "scale",
          "failure",
          "ownership",
          "improvement",
        ]),
        hint: z.string(),
        sources: z.array(z.number().int()).max(3),
      }),
    )
    .max(10),
});

export type LadderQuestion = z.infer<typeof ladderSchema>["questions"][number];

export async function generateQuestionLadder(
  brief: ProjectBrief,
  settings: AppSettings,
  onProgress?: (chars: number) => void,
): Promise<{ questions: LadderQuestion[]; error?: string }> {
  const outcome = await runLlmJson(
    settings,
    [
      { role: "system", content: `You are a senior engineer interviewing a candidate about one of their projects.\n\n${GROUNDING_RULES}` },
      {
        role: "user",
        content: `<sources>\n${brief.context.text}\n</sources>\n\nProject: ${brief.project.name}

Write 8 interview questions about this project that get progressively harder, from level 1 (warm-up) to level 5 (very hard follow-ups). Cover: the problem, design decisions, alternatives considered, what the candidate personally built, evaluation, scaling, failure cases and improvements. Make them specific to the details in the sources.
For each question add a one-sentence "hint" telling the candidate what to mention, based only on the sources (or "Not in your documents — prepare this." if unsupported), and cite the relevant sources.

Return JSON: {"questions":[{"level":1,"question":"...","category":"problem","hint":"...","sources":[1]}]}`,
      },
    ],
    ladderSchema,
    { maxTokens: 1300, temperature: 0.4 },
    onProgress,
  );
  if (!outcome.data) return { questions: fallbackLadder(brief), error: outcome.error };
  const fromModel = outcome.data.questions.map((q) => ({ ...q, sources: validSources(q.sources, brief.context) }));
  // Small models sometimes return only a few questions; top up with template questions
  // for the categories they skipped so the ladder always covers the full range.
  const covered = new Set(fromModel.map((q) => q.category));
  const extra =
    fromModel.length >= 6
      ? []
      : fallbackLadder(brief)
          .filter((q) => !covered.has(q.category))
          .slice(0, 8 - fromModel.length);
  return { questions: [...fromModel, ...extra].sort((a, b) => a.level - b.level) };
}

function fallbackLadder(brief: ProjectBrief): LadderQuestion[] {
  // Roles are detected as "Title - Company": ask about the work, not about the job title.
  const [head, org] = brief.project.name.split(/\s+[-–—|]\s+/);
  const role = brief.project.kind === "experience";
  const work = `your ${head} work${org ? ` at ${org}` : ""}`;
  const name = role ? work : head;
  const q = (level: number, category: LadderQuestion["category"], question: string): LadderQuestion => ({
    level,
    category,
    question,
    hint:
      brief.checklist.find((c) => c.id === category)?.covered === false
        ? "Not in your documents — prepare this."
        : "Template question — use the evidence below to prepare.",
    sources: [],
  });
  return [
    q(
      1,
      "problem",
      role ? `What problem were you solving in ${work}, and who was it for?` : `What problem does ${name} solve, and who is it for?`,
    ),
    q(
      2,
      "design",
      role ? `Walk me through the architecture of the main system you built in ${work}.` : `Walk me through the architecture of ${name}.`,
    ),
    q(2, "ownership", `Which parts of ${name} did you build yourself, and which did others build?`),
    q(3, "alternatives", `What alternatives did you consider, and why did you choose this approach?`),
    q(
      3,
      "evaluation",
      role ? `How did you measure whether ${work} succeeded? Why those metrics?` : `How did you evaluate ${name}? Why those metrics?`,
    ),
    q(4, "failure", `What went wrong during the project, and how did you find out?`),
    q(4, "scale", `What would break first if usage grew 100x?`),
    q(5, "improvement", `If you redid ${name} today, what would you change?`),
  ];
}
