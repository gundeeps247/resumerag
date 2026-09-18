/**
 * Grades the in-browser model benchmark with the app's own checks.
 *
 *   npx tsx scripts/llm-bench/score.ts [results/webgpu-q4]
 *
 * Per model:
 *  - facts      grounded answers: share of required facts present (6 questions)
 *  - cited      grounded answers that carry at least one valid [n] citation
 *  - badCites   citations that point to no source ("[n]", "[7]" with 5 sources)
 *  - invented   numbers stated in an answer that appear nowhere in its sources
 *  - refusals   unanswerable questions handled correctly (refusal, or an explicit grounded "no")
 *  - json       workflow replies that parse and satisfy the app's zod schema (2 tasks)
 *  - speed      mean time to first token and decode speed on the benchmark GPU
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseWithSchema } from "../../src/lib/llm/json";
import { invalidCitations, numbersIn, parseCitations, REFUSAL_TEXT } from "../../src/lib/rag/generation/citations";
import type { BenchTask } from "./build-fixtures";

/** Download size of the q4 weights (MB), from the Hugging Face file listing. */
export const DOWNLOAD_MB: Record<string, number> = {
  "onnx-community/Qwen2.5-0.5B-Instruct": 786,
  "onnx-community/LFM2-700M-ONNX": 559,
  "onnx-community/Qwen3-0.6B-ONNX": 919,
  "onnx-community/LFM2-1.2B-ONNX": 850,
  "onnx-community/gemma-3-1b-it-ONNX": 859,
  "onnx-community/Qwen2.5-1.5B-Instruct": 1788,
};

/** Mirrors the schemas in src/lib/workflows (kept in step with their defaults for missing fields). */
const SCHEMAS = {
  questions: z.object({
    questions: z
      .array(z.object({ question: z.string(), whyAsked: z.string(), sources: z.array(z.number().int()).max(3).default([]) }))
      .max(10),
  }),
  evaluation: z.object({
    scores: z.object({
      relevance: z.number().int().min(1).max(5),
      correctness: z.number().int().min(1).max(5),
      evidence: z.number().int().min(1).max(5),
      depth: z.number().int().min(1).max(5),
      structure: z.number().int().min(1).max(5),
      clarity: z.number().int().min(1).max(5),
    }),
    strengths: z.array(z.string()).max(3).default([]),
    improvements: z.array(z.string()).max(3).default([]),
    betterAnswerOutline: z.string().default(""),
  }),
};

interface BenchResult {
  id: string;
  text?: string;
  error?: string;
  promptTokens?: number;
  newTokens?: number;
  firstTokenMs?: number;
  decodeTokPerS?: number | null;
}

const REFUSAL = REFUSAL_TEXT.slice(0, 40).toLowerCase();

function inventedNumbers(text: string, context: string): string[] {
  const allowed = new Set(numbersIn(context));
  // Citation markers and list numbering are not claims.
  const claims = text.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, " ").replace(/^\s*\d+[.)]\s/gm, " ");
  return numbersIn(claims).filter((n) => !allowed.has(n));
}

export function scoreModel(tasks: BenchTask[], results: BenchResult[]) {
  const byId = new Map(results.map((r) => [r.id, r]));
  let facts = 0;
  let cited = 0;
  let badCites = 0;
  const invented: string[] = [];
  let refusals = 0;
  let json = 0;
  const notes: string[] = [];

  for (const task of tasks) {
    const text = byId.get(task.id)?.text ?? "";
    const lower = text.toLowerCase();
    if (task.kind === "answer") {
      const groups = task.factGroups ?? [];
      const hit = groups.filter((g) => g.some((p) => lower.includes(p))).length;
      facts += groups.length ? hit / groups.length : 0;
      if (lower.includes(REFUSAL)) notes.push(`${task.id}: refused an answerable question`);
      if (parseCitations(text).some((n) => n >= 1 && n <= task.sourceCount)) cited++;
      badCites += invalidCitations(text, task.sourceCount).length + (text.match(/\[n\]/gi)?.length ?? 0);
      invented.push(...inventedNumbers(text, task.contextText).map((n) => `${task.id}:${n}`));
    } else if (task.kind === "refuse") {
      const numbers = inventedNumbers(text, task.contextText);
      // The app asks for one exact refusal sentence, but any explicit "not in your documents" counts.
      const refused =
        lower.includes(REFUSAL) ||
        /(does not|doesn't|do not|don't) (\w+ )?(specify|mention|contain|include|provide|state)|not (specified|mentioned|provided|available|stated|included)|no (\w+ ){0,2}(information|mention|evidence|detail|record|data)/.test(
          lower,
        );
      const groundedNo =
        task.id === "kubernetes" && /tutorial|never (deployed|used)|not (deployed|managed|used)|no (production|experience)/.test(lower);
      const misused =
        task.id === "kubernetes" ? /\b256\b|\bclusters? on (aws|gcp|azure)/.test(lower) : /\$|salary of|\b\d{2,3},?\d{3}\b/.test(text);
      const ok = (refused || groundedNo) && !misused && numbers.length === 0;
      if (ok) refusals++;
      else notes.push(`${task.id}: ${JSON.stringify(text.slice(0, 90))}`);
    } else if (task.kind === "json" && task.schema) {
      try {
        const data = parseWithSchema(text, SCHEMAS[task.schema]);
        const sources =
          task.schema === "questions"
            ? (data as z.infer<typeof SCHEMAS.questions>).questions.flatMap((q) => q.sources)
            : parseCitations((data as z.infer<typeof SCHEMAS.evaluation>).betterAnswerOutline);
        if (task.schema === "questions" && (data as z.infer<typeof SCHEMAS.questions>).questions.length < 3)
          throw new Error("fewer than 3 questions");
        if (sources.some((n) => n < 1 || n > task.sourceCount)) throw new Error("invalid source numbers");
        json++;
        if (task.schema === "evaluation") {
          const e = data as z.infer<typeof SCHEMAS.evaluation>;
          // The candidate's answer contradicts the documents (SMOTE was dropped); a good grader notices.
          const caught = e.scores.correctness <= 3 && /smote|scale_pos_weight/i.test([...e.improvements, e.betterAnswerOutline].join(" "));
          notes.push(
            `evaluation: correctness=${e.scores.correctness}${caught ? " (caught the SMOTE error)" : " (missed the SMOTE error)"}`,
          );
        }
      } catch (error) {
        notes.push(`${task.id}: invalid JSON (${(error as Error).message.slice(0, 60)})`);
      }
    }
  }

  const answerTasks = tasks.filter((t) => t.kind === "answer").length;
  const timed = results.filter((r) => r.firstTokenMs !== undefined && r.decodeTokPerS);
  return {
    facts: facts / answerTasks,
    cited: cited / answerTasks,
    badCites,
    invented,
    refusals,
    refusalTasks: tasks.filter((t) => t.kind === "refuse").length,
    json,
    jsonTasks: tasks.filter((t) => t.kind === "json").length,
    firstTokenMs: timed.reduce((n, r) => n + (r.firstTokenMs ?? 0), 0) / Math.max(1, timed.length),
    decodeTokPerS: timed.reduce((n, r) => n + (r.decodeTokPerS ?? 0), 0) / Math.max(1, timed.length),
    notes,
  };
}

async function main() {
  const dir = path.resolve(__dirname, process.argv[2] ?? "results/webgpu-q4");
  const tasks = JSON.parse(await readFile(path.join(__dirname, "fixtures.json"), "utf8")) as BenchTask[];
  const rows = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const run = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    if (run.error) {
      console.log(`${run.modelId}: failed (${String(run.error).slice(0, 80)})`);
      continue;
    }
    rows.push({ run, score: scoreModel(tasks, run.results) });
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.log("\n| Model | Download | Facts | Cited | Bad cites | Invented numbers | Refusals | Valid JSON | First token | Decode |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const { run, score: s } of rows) {
    console.log(
      `| ${run.modelId.split("/")[1]} | ${DOWNLOAD_MB[run.modelId] ?? "?"} MB | ${pct(s.facts)} | ${pct(s.cited)} | ${s.badCites} | ${s.invented.length} | ${s.refusals}/${s.refusalTasks} | ${s.json}/${s.jsonTasks} | ${(s.firstTokenMs / 1000).toFixed(1)} s | ${s.decodeTokPerS.toFixed(1)} tok/s |`,
    );
  }
  for (const { run, score: s } of rows) {
    console.log(`\n${run.modelId}  (load from cache ${(run.loadMs / 1000).toFixed(1)} s)`);
    if (s.invented.length) console.log(`  invented numbers: ${s.invented.join(", ")}`);
    for (const note of s.notes) console.log(`  - ${note}`);
  }
}

if (process.argv[1]?.endsWith("score.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
