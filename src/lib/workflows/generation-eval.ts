"use client";

/**
 * Lightweight generation evaluation — no paid "LLM judge" required.
 *
 * For a sample of demo questions we run the full Ask pipeline and measure:
 *  - Faithfulness     share of answer sentences supported by the passages they cite
 *                     (embedding similarity, the same check shown under every answer)
 *  - Answer relevance cosine similarity between the question and the answer
 *  - Context precision share of passages in the prompt that contain a labelled fact
 *  - Correct refusal  unanswerable questions must be refused, answerable ones answered
 *
 * These are proxies, not perfect judges, and are documented as such.
 */
import { getRag } from "@/lib/client/rag-client";
import type { AppSettings } from "@/lib/client/settings";
import { EVAL_QUESTIONS } from "@/lib/rag/evaluation/dataset";
import { isRelevant } from "@/lib/rag/evaluation/metrics";
import { REFUSAL_TEXT } from "@/lib/rag/generation/citations";
import { askQuestion } from "./ask";

export interface GenerationEvalRow {
  question: string;
  answerable: boolean;
  mode: string;
  answer: string;
  faithfulness: number | null;
  answerRelevance: number | null;
  contextPrecision: number | null;
  refusedCorrectly: boolean;
  seconds: number;
}

export const GENERATION_SAMPLE = ["q01", "q04", "q08", "q15", "q23", "q27", "q28"];

export async function runGenerationEval(
  settings: AppSettings,
  onRow: (row: GenerationEvalRow, done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<GenerationEvalRow[]> {
  const rag = getRag();
  const questions = EVAL_QUESTIONS.filter((q) => GENERATION_SAMPLE.includes(q.id));
  const rows: GenerationEvalRow[] = [];
  for (const q of questions) {
    if (signal?.aborted) break;
    const started = performance.now();
    const { content, trace } = await askQuestion(q.question, [], settings, {}, signal);
    const answerable = q.facts.length > 0;
    const refused = trace.mode === "refused" || content.startsWith(REFUSAL_TEXT);
    const inContext = trace.retrieval.results.slice(0, trace.prompt?.sourceCount ?? trace.retrieval.results.length);
    const row: GenerationEvalRow = {
      question: q.question,
      answerable,
      mode: trace.mode,
      answer: content,
      faithfulness: trace.verification ? trace.verification.supportedRatio : null,
      answerRelevance: refused ? null : await rag.similarity(q.question, content.replace(/\[\d+\]/g, "")),
      contextPrecision:
        answerable && inContext.length
          ? inContext.filter((r) => isRelevant(q.facts, { docName: r.document.name, text: r.chunk.text })).length / inContext.length
          : null,
      refusedCorrectly: answerable ? !refused : refused,
      seconds: (performance.now() - started) / 1000,
    };
    rows.push(row);
    onRow(row, rows.length, questions.length);
  }
  return rows;
}
