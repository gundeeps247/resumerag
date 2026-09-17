"use client";

/**
 * "Ask" — grounded question answering over the knowledge base.
 *
 *   question → (rewrite follow-up) → hybrid retrieval → confidence gate
 *            → numbered context → LLM (streamed) → citation verification
 *
 * Every step is recorded in the trace so the UI can show "How this answer was generated".
 */
import { getRag } from "@/lib/client/rag-client";
import type { AppSettings } from "@/lib/client/settings";
import type { AnswerRecordTrace } from "@/lib/db/records";
import { complete, streamChat } from "@/lib/llm/client";
import type { ChatMessage } from "@/lib/llm/types";
import { REFUSAL_TEXT, invalidCitations, judgeSupport, lexicalSupport, splitAnswerSentences } from "@/lib/rag/generation/citations";
import { buildContext } from "@/lib/rag/generation/context";
import { extractiveAnswer } from "@/lib/rag/generation/extractive";
import { askSystemPrompt, askUserPrompt, condenseQuestionMessages, looksLikeFollowUp } from "@/lib/rag/generation/prompts";
import { EMPLOYER_DOC_TYPES, type RetrievalFilter } from "@/lib/rag/types";

export type AskStage = "rewriting" | "retrieving" | "generating" | "verifying";

export interface AskCallbacks {
  onStage?: (stage: AskStage) => void;
  onDelta?: (fullText: string) => void;
}

export interface AskResult {
  content: string;
  trace: AnswerRecordTrace;
}

/**
 * Where to search. "candidate" excludes job descriptions and company notes, so questions
 * about *your* experience can never be answered from the employer's documents.
 */
export type AskScope = "all" | "candidate" | "employer";

export function scopeFilter(scope: AskScope): RetrievalFilter | undefined {
  if (scope === "candidate") return { excludeDocTypes: EMPLOYER_DOC_TYPES };
  if (scope === "employer") return { docTypes: EMPLOYER_DOC_TYPES };
  return undefined;
}

export async function askQuestion(
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  settings: AppSettings,
  callbacks: AskCallbacks = {},
  signal?: AbortSignal,
  scope: AskScope = "all",
): Promise<AskResult> {
  const rag = getRag();

  // 1. Follow-up questions are rewritten into standalone search queries.
  let searchQuery = question;
  if (history.length && looksLikeFollowUp(question)) {
    callbacks.onStage?.("rewriting");
    try {
      const rewritten = await complete(settings.llm, condenseQuestionMessages(history, question), {
        temperature: 0,
        maxTokens: 80,
        signal,
      });
      const cleaned = rewritten.text
        .trim()
        .replace(/^["']|["']$/g, "")
        .split("\n")[0];
      if (cleaned.length > 5 && cleaned.length < 400) searchQuery = cleaned;
    } catch {
      // No LLM available: fall back to prepending the previous question for context.
      const previous = [...history].reverse().find((m) => m.role === "user");
      if (previous) searchQuery = `${previous.content} ${question}`;
    }
  }

  // 2. Retrieval (runs in the Web Worker).
  callbacks.onStage?.("retrieving");
  const retrieval = await rag.search(searchQuery, { ...settings.retrieval, filter: scopeFilter(scope) });
  const trace: AnswerRecordTrace = { mode: "llm", originalQuery: question, searchQuery, retrieval };

  // 3. Confidence gate: refuse instead of guessing when nothing relevant was found.
  if (!retrieval.results.length || (settings.strictGrounding && retrieval.confidence.level === "none")) {
    trace.mode = "refused";
    return {
      content: `${REFUSAL_TEXT}\n\n${retrieval.results.length ? "The closest passages I found are listed under Sources, but none of them looks relevant enough to answer from." : "Your knowledge base has no passages related to this question. Try uploading a document that covers it."}`,
      trace,
    };
  }

  // 4. Context + prompt.
  const context = buildContext(retrieval.results);
  const system = askSystemPrompt();
  const user = askUserPrompt(question === searchQuery ? question : `${question}\n(Interpreted as: ${searchQuery})`, context.text);
  trace.prompt = { system, user, contextTokens: context.tokens, sourceCount: context.sources.length };

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.slice(-4).map((m) => ({ role: m.role, content: m.content.slice(0, 800) })),
    { role: "user", content: user },
  ];

  // 5. Generation (streamed).
  callbacks.onStage?.("generating");
  let content = "";
  const started = performance.now();
  let firstTokenMs: number | undefined;
  try {
    for await (const event of streamChat(settings.llm, messages, { temperature: settings.temperature, maxTokens: 700, signal })) {
      if (event.type === "delta") {
        firstTokenMs ??= performance.now() - started;
        content += event.text;
        callbacks.onDelta?.(content);
      } else if (event.type === "done") {
        trace.generation = {
          model: event.model,
          durationMs: event.durationMs,
          firstTokenMs,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
        };
      }
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    // LLM unreachable: degrade to an evidence-only answer rather than failing.
    trace.mode = "evidence-only";
    trace.error = (error as Error).message;
    return {
      content: extractiveAnswer(
        question,
        context.sources.map((s) => s.result),
      ),
      trace,
    };
  }

  // 6. Citation verification.
  callbacks.onStage?.("verifying");
  const sentences = splitAnswerSentences(content);
  const idsFor = (nums: number[]) =>
    (nums.length ? nums : context.sources.map((s) => s.n))
      .map((n) => context.sources[n - 1]?.result.chunk.id)
      .filter((id): id is string => Boolean(id));
  const scores = await rag.supportScores(
    sentences.map((s) => s.text),
    sentences.map((s) => idsFor(s.citations)),
  );
  const textById = new Map(context.sources.map((s) => [s.result.chunk.id, s.result.chunk.text]));
  const checks = sentences.map((s, i) => {
    const lexical = lexicalSupport(
      s.text,
      idsFor(s.citations).map((id) => textById.get(id) ?? ""),
    );
    const support = scores[i]?.best ?? 0;
    return {
      sentence: s.text,
      citedSources: s.citations,
      support,
      overlap: lexical.overlap,
      missingNumbers: lexical.missingNumbers,
      supported: judgeSupport(support, lexical),
    };
  });
  trace.verification = {
    checks,
    supportedRatio: checks.length ? checks.filter((c) => c.supported).length / checks.length : 1,
    invalidCitations: invalidCitations(content, context.sources.length),
  };

  return { content, trace };
}
