/**
 * Builds the prompts used to choose the in-browser language model.
 *
 * Every prompt is produced by the app's real pipeline over the demo workspace: parsing,
 * chunking, hybrid retrieval with reranking, context building and the exact system/user
 * prompts the Ask page and workflows send. The browser benchmark (run-bench.cjs) feeds
 * these to each candidate model; score.ts grades the answers.
 *
 *   npx tsx scripts/llm-bench/build-fixtures.ts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@huggingface/transformers";
import { DEMO_DOCUMENTS } from "../../src/lib/demo";
import type { ChatMessage } from "../../src/lib/llm/types";
import { DEFAULT_CHUNKING, DEFAULT_RETRIEVAL } from "../../src/lib/rag/config";
import { TransformersEmbedder } from "../../src/lib/rag/embeddings/embedder";
import { DEFAULT_EMBEDDING_MODEL_ID, getEmbeddingModel, getRerankerModel } from "../../src/lib/rag/embeddings/models";
import { buildContext } from "../../src/lib/rag/generation/context";
import { askSystemPrompt, askUserPrompt, GROUNDING_RULES } from "../../src/lib/rag/generation/prompts";
import { chunkDocument, embedChunks, parseSource } from "../../src/lib/rag/ingestion/pipeline";
import { CrossEncoderReranker } from "../../src/lib/rag/reranking/reranker";
import { retrieve } from "../../src/lib/rag/retrieval/retriever";
import { SearchIndex } from "../../src/lib/rag/retrieval/search-index";
import type { RetrievedChunk, StoredChunk } from "../../src/lib/rag/types";

env.cacheDir = path.join(process.cwd(), ".cache", "transformers");

export interface BenchTask {
  id: string;
  kind: "answer" | "refuse" | "json";
  messages: ChatMessage[];
  maxNewTokens: number;
  /** The context passed to the model, for checking invented numbers. */
  contextText: string;
  sourceCount: number;
  /** answer: each group needs at least one of its (lower-case) phrases in the reply. */
  factGroups?: string[][];
  /** json: which workflow schema the reply must satisfy. */
  schema?: "questions" | "evaluation";
}

const ANSWER_TASKS: { id: string; question: string; factGroups: string[][] }[] = [
  { id: "imbalance", question: "How did I handle class imbalance in the churn model?", factGroups: [["scale_pos_weight"], ["smote"]] },
  {
    id: "internship-project",
    question: "What machine learning project did I build during my internship?",
    factGroups: [["churn"], ["xgboost"]],
  },
  { id: "bm25", question: "Why did I add keyword search (BM25) to LexiSearch?", factGroups: [["citation", "exact", "section", "keyword"]] },
  {
    id: "leakage",
    question: "What data leakage problem did I run into?",
    factGroups: [["account_status_updated_at", "account status"], ["0.97"]],
  },
  {
    id: "disagreement",
    question: "Tell me about a time I disagreed with someone at work.",
    factGroups: [["product manager"], ["60"]],
  },
  { id: "final-auc", question: "What ROC-AUC did the final churn model achieve?", factGroups: [["0.89", "0.91"]] },
];

/** Answerable-looking questions whose answer is NOT in the documents; the gate is bypassed on purpose. */
const REFUSE_TASKS: { id: string; question: string }[] = [
  { id: "salary", question: "What salary did I negotiate for my Finlytics internship?" },
  { id: "kubernetes", question: "How many Kubernetes clusters did I manage in production, and on which cloud?" },
];

async function main() {
  const model = getEmbeddingModel(DEFAULT_EMBEDDING_MODEL_ID);
  const embedder = await TransformersEmbedder.create(model, { device: "cpu" });
  const reranker = await CrossEncoderReranker.create(getRerankerModel(""), { device: "cpu" });

  const chunks: StoredChunk[] = [];
  const docs = [];
  for (const [i, demo] of DEMO_DOCUMENTS.entries()) {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "demo", demo.file)));
    const parsed = await parseSource({ kind: "file", fileName: demo.file, bytes });
    const doc = { id: `demo${i}`, name: demo.file, docType: demo.docType, format: parsed.format };
    docs.push(doc);
    chunks.push(...(await embedChunks(chunkDocument(doc.id, doc.name, parsed, DEFAULT_CHUNKING), embedder)));
  }
  const index = new SearchIndex(chunks, docs);
  const deps = {
    index,
    embedQuery: (q: string) => embedder.embedQuery(q),
    queryPrefix: model.queryPrefix,
    reranker,
    embeddingModelId: model.id,
    embeddingCalibration: model.calibration,
    rerankCalibration: reranker.model.calibration,
  };
  const search = async (q: string, filter?: { excludeDocTypes?: string[] }) =>
    (await retrieve(q, { ...DEFAULT_RETRIEVAL, filter: filter as never }, deps)).results;

  const tasks: BenchTask[] = [];
  const ask = (id: string, kind: "answer" | "refuse", question: string, results: RetrievedChunk[], factGroups?: string[][]) => {
    const context = buildContext(results);
    tasks.push({
      id,
      kind,
      messages: [
        { role: "system", content: askSystemPrompt() },
        { role: "user", content: askUserPrompt(question, context.text) },
      ],
      maxNewTokens: 350,
      contextText: context.text,
      sourceCount: context.sources.length,
      factGroups,
    });
  };

  for (const t of ANSWER_TASKS) ask(t.id, "answer", t.question, await search(t.question), t.factGroups);
  for (const t of REFUSE_TASKS) ask(t.id, "refuse", t.question, await search(t.question));

  // JSON workflow 1: question generator (technical, medium, 3 questions).
  const merged = new Map<string, RetrievedChunk>();
  for (const q of [
    "programming languages frameworks and tools I used",
    "technical skills databases cloud",
    "algorithms and data structures",
  ]) {
    for (const r of (await search(q, { excludeDocTypes: ["job_description", "company_info"] })).slice(0, 3)) merged.set(r.chunk.id, r);
  }
  const qContext = buildContext([...merged.values()].slice(0, 7));
  tasks.push({
    id: "json-questions",
    kind: "json",
    schema: "questions",
    maxNewTokens: 700,
    contextText: qContext.text,
    sourceCount: qContext.sources.length,
    messages: [
      { role: "system", content: `You are an interviewer preparing questions tailored to this specific candidate.\n\n${GROUNDING_RULES}` },
      {
        role: "user",
        content: `<sources>\n${qContext.text}\n</sources>\n\nWrite 3 technical interview questions (tools, languages and fundamentals the candidate lists). They should be moderately challenging.
Every question must refer to something specific in the sources (a project, tool, number or story). For each, explain in one sentence why an interviewer would ask it and cite the source it is based on.

Return JSON: {"questions":[{"question":"...","whyAsked":"...","sources":[1]}]}`,
      },
    ],
  });

  // JSON workflow 2: mock-interview answer evaluation.
  const question = "How did you deal with class imbalance in the churn model, and why?";
  const answer =
    "Only about 7% of customers churned, so I used SMOTE oversampling to balance the classes and it improved the F1 score a lot. I also tuned the model with Optuna.";
  const eContext = buildContext(
    (await search(`${question} ${answer}`, { excludeDocTypes: ["job_description", "company_info"] })).slice(0, 5),
  );
  tasks.push({
    id: "json-evaluation",
    kind: "json",
    schema: "evaluation",
    maxNewTokens: 600,
    contextText: eContext.text,
    sourceCount: eContext.sources.length,
    messages: [
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
        content: `<sources>\n${eContext.text}\n</sources>\n\nQuestion (medium): ${question}\n\nCandidate's answer:\n"""${answer}"""

Rubric: relevance, correctness, evidence (specific, real examples), depth, structure, clarity.
Return JSON: {"scores":{"relevance":3,"correctness":3,"evidence":3,"depth":3,"structure":3,"clarity":3},"strengths":["..."],"improvements":["..."],"betterAnswerOutline":"..."}`,
      },
    ],
  });

  const out = path.join(process.cwd(), "scripts", "llm-bench", "fixtures.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(tasks, null, 2));
  console.log(`Wrote ${tasks.length} tasks to ${path.relative(process.cwd(), out)}`);
  for (const t of tasks)
    console.log(
      `  ${t.id.padEnd(20)} ${t.kind.padEnd(7)} sources=${t.sourceCount} promptChars=${t.messages.reduce((n, m) => n + m.content.length, 0)}`,
    );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
