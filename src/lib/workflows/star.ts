"use client";

/**
 * STAR answer builder. Structures a behavioural answer (Situation, Task, Action, Result)
 * from experiences found in the candidate's documents, keeping a strict separation:
 *   - facts:    things the documents actually say (with citations)
 *   - phrasing: suggested wording that adds no new facts
 *   - missing:  details only the candidate can supply — never invented
 */
import { z } from "zod";
import type { AppSettings } from "@/lib/client/settings";
import type { BuiltContext } from "@/lib/rag/generation/context";
import { GROUNDING_RULES } from "@/lib/rag/generation/prompts";
import { expandQuery } from "@/lib/rag/retrieval/query-expansion";
import { CANDIDATE_FILTER, gatherEvidence, runLlmJson, validSources } from "./common";

export const BEHAVIORAL_PROMPTS = [
  "Tell me about a time you disagreed with a teammate or manager.",
  "Tell me about a time you made a mistake and how you handled it.",
  "Tell me about a time you worked under a tight deadline.",
  "Tell me about a time you led a team.",
  "Tell me about a time you had to explain something technical to a non-technical person.",
  "Tell me about the project you are most proud of.",
];

const part = z.object({
  facts: z.array(z.object({ text: z.string(), sources: z.array(z.number().int()).max(3) })).max(4),
  phrasing: z.string(),
});

const schema = z.object({
  experience: z.string(),
  situation: part,
  task: part,
  action: part,
  result: part,
  missing: z.array(z.string()).max(5),
  answer: z.string(),
});

export type StarAnswer = z.infer<typeof schema>;

export interface StarResult {
  star?: StarAnswer;
  context: BuiltContext;
  error?: string;
  noEvidence?: boolean;
}

export async function buildStarAnswer(prompt: string, settings: AppSettings, onProgress?: (chars: number) => void): Promise<StarResult> {
  // Behavioural prompts are abstract; add concrete vocabulary ("disagreed", "proposed instead")
  // and let the model judge relevance — the reranker under-scores this question style.
  const expansion = expandQuery(prompt);
  const { context } = await gatherEvidence(
    [prompt, expansion ? `${prompt} ${expansion}` : prompt.replace(/^tell me about a time (you|when you)?/i, "")],
    settings,
    {
      filter: CANDIDATE_FILTER,
      perQuery: 4,
      maxSources: 5,
      skipUnconfident: false,
    },
  );
  if (!context.sources.length) return { context, noEvidence: true };

  const outcome = await runLlmJson(
    settings,
    [
      {
        role: "system",
        content: `You are an interview coach helping a candidate structure a behavioural answer using the STAR method.

${GROUNDING_RULES}
- "facts" may only contain information stated in the sources, each with its source numbers.
- "phrasing" is suggested wording for that part. It must not add any new facts, names, numbers or events.
- "missing" lists details the candidate should add from memory (for example how they felt, exact dates, what the other person said).
- In "answer", write a natural first-person spoken answer (120-170 words) using only facts from the sources. Where a specific detail is missing, insert a placeholder like [ADD: what the manager said].`,
      },
      {
        role: "user",
        content: `<sources>\n${context.text}\n</sources>\n\nInterview question: "${prompt}"

Pick the single experience from the sources that best answers this question and structure it as STAR. If no source describes a relevant real experience, return "experience": "NONE" with empty facts.
Return JSON: {"experience":"short title of the experience","situation":{"facts":[{"text":"...","sources":[1]}],"phrasing":"..."},"task":{...},"action":{...},"result":{...},"missing":["..."],"answer":"..."}`,
      },
    ],
    schema,
    { maxTokens: 1200, temperature: 0.3 },
    onProgress,
  );

  if (!outcome.data) return { context, error: outcome.error };
  if (outcome.data.experience.trim().toUpperCase() === "NONE") return { context, noEvidence: true };
  const clean = (p: StarAnswer["situation"]) => ({
    ...p,
    facts: p.facts.map((f) => ({ ...f, sources: validSources(f.sources, context) })),
  });
  const star = outcome.data;
  return {
    context,
    star: { ...star, situation: clean(star.situation), task: clean(star.task), action: clean(star.action), result: clean(star.result) },
  };
}
