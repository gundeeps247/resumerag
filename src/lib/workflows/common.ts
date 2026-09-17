"use client";

/**
 * Shared building blocks for the interview-prep workflows.
 *
 * Every workflow follows the same recipe:
 *   1. deterministic analysis and multi-query retrieval (fast, grounded, no LLM needed)
 *   2. a compact LLM call that returns JSON validated with zod
 *   3. a deterministic fallback when no LLM is reachable
 */
import type { z } from "zod";
import { getRag } from "@/lib/client/rag-client";
import type { AppSettings } from "@/lib/client/settings";
import { getDb } from "@/lib/db/schema";
import { completeJson } from "@/lib/llm/client";
import type { ChatMessage } from "@/lib/llm/types";
import { buildContext, type BuiltContext } from "@/lib/rag/generation/context";
import { EMPLOYER_DOC_TYPES, type RetrievalFilter, type RetrievalResult, type RetrievedChunk } from "@/lib/rag/types";

/** Evidence about the candidate must never come from job descriptions or company notes. */
export const CANDIDATE_FILTER: RetrievalFilter = { excludeDocTypes: EMPLOYER_DOC_TYPES };

export interface Evidence {
  context: BuiltContext;
  retrievals: RetrievalResult[];
}

/**
 * Multi-query retrieval: runs several searches and merges their results round-robin
 * (best result of each query first), removing duplicates.
 */
export async function gatherEvidence(
  queries: string[],
  settings: AppSettings,
  options: {
    filter?: RetrievalFilter;
    perQuery?: number;
    maxSources?: number;
    maxTokens?: number;
    /** Drop lower-ranked results of searches whose confidence is "none" (default true). */
    skipUnconfident?: boolean;
  } = {},
): Promise<Evidence> {
  const retrievals = await getRag().searchMany(queries, { ...settings.retrieval, topK: options.perQuery ?? 3, filter: options.filter });
  const merged: RetrievedChunk[] = [];
  const seen = new Set<string>();
  const max = options.maxSources ?? 8;
  for (let rank = 0; merged.length < max; rank++) {
    let any = false;
    for (const r of retrievals) {
      const item = r.results[rank];
      if (!item) continue;
      any = true;
      // Skip passages the pipeline judged irrelevant.
      if (options.skipUnconfident !== false && r.confidence.level === "none" && rank > 0) continue;
      if (!seen.has(item.chunk.id)) {
        seen.add(item.chunk.id);
        merged.push(item);
        if (merged.length >= max) break;
      }
    }
    if (!any) break;
  }
  return { context: buildContext(merged, options.maxTokens ?? 2600), retrievals };
}

export interface LlmOutcome<T> {
  data?: T;
  error?: string;
  model?: string;
  durationMs?: number;
}

/** Runs a JSON-producing LLM call and converts failures into a value instead of an exception. */
export async function runLlmJson<T extends z.ZodType>(
  settings: AppSettings,
  messages: ChatMessage[],
  schema: T,
  options: { maxTokens: number; temperature?: number; signal?: AbortSignal },
  onProgress?: (generatedChars: number) => void,
): Promise<LlmOutcome<z.infer<T>>> {
  try {
    const { data, result } = await completeJson(
      settings.llm,
      messages,
      schema,
      { maxTokens: options.maxTokens, temperature: options.temperature ?? 0.3, signal: options.signal },
      (_delta, total) => onProgress?.(total.length),
    );
    return { data, model: result.model, durationMs: result.durationMs };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return { error: (error as Error).message };
  }
}

/** Each document's title: its first top-level heading, or its parsed title. */
export async function loadDocTitles(docIds: string[]): Promise<Record<string, string>> {
  const contents = await getDb().contents.bulkGet([...new Set(docIds)]);
  const titles: Record<string, string> = {};
  for (const content of contents) {
    if (!content) continue;
    const heading =
      content.blocks.find((b) => b.kind === "heading" && (b.level ?? 1) === 1) ?? content.blocks.find((b) => b.kind === "heading");
    titles[content.docId] = heading?.text ?? content.title;
  }
  return titles;
}

/** Keeps only citation numbers that point at a real source. */
export function validSources(nums: number[] | undefined, context: BuiltContext): number[] {
  return [...new Set((nums ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= context.sources.length))];
}

export function sourceResults(context: BuiltContext): RetrievedChunk[] {
  return context.sources.map((s) => s.result);
}
