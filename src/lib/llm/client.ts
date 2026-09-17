"use client";

/**
 * Browser-side access to the language model. Two connection modes:
 *
 *  - "server":         POST /api/llm/chat → the provider configured on the server.
 *  - "browser-ollama": the browser talks directly to Ollama on the user's machine
 *                      (http://localhost:11434). Useful on a deployed site: the UI comes from
 *                      Vercel, but prompts and documents never leave your computer.
 *                      Requires OLLAMA_ORIGINS to allow the site's origin.
 */
import { z } from "zod";
import { parseWithSchema } from "./json";
import { OllamaProvider } from "./providers/ollama";
import { readNdjson, withStallTimeout } from "./stream";
import type { ChatMessage, GenerateOptions, ProviderStatus, StreamEvent } from "./types";

export interface LlmConnection {
  mode: "server" | "browser-ollama";
  /** Optional model override (must exist on the provider). */
  model?: string;
  ollamaUrl?: string;
  accessCode?: string;
}

export interface LlmStatus extends ProviderStatus {
  requiresAccessCode?: boolean;
  maxOutputTokens?: number;
}

/**
 * A CPU-only machine can take minutes to load a 7B model and read a long prompt, so the
 * first-output limit is generous; after that, tokens arrive every fraction of a second.
 */
const STALL_LIMITS = { firstMs: 240_000, idleMs: 90_000 };

export function streamChat(connection: LlmConnection, messages: ChatMessage[], options: GenerateOptions = {}): AsyncGenerator<StreamEvent> {
  return withStallTimeout((signal) => openStream(connection, messages, { ...options, signal }), {
    signal: options.signal,
    ...STALL_LIMITS,
  });
}

async function* openStream(connection: LlmConnection, messages: ChatMessage[], options: GenerateOptions): AsyncGenerator<StreamEvent> {
  if (connection.mode === "browser-ollama") {
    const provider = new OllamaProvider({
      baseUrl: connection.ollamaUrl || "http://localhost:11434",
      model: connection.model || "qwen2.5:7b-instruct",
    });
    yield* provider.streamChat(messages, options);
    return;
  }

  const { signal, ...rest } = options;
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(connection.accessCode ? { "x-access-code": connection.accessCode } : {}),
    },
    body: JSON.stringify({ messages, ...rest, model: connection.model || undefined }),
    signal,
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Generation failed (HTTP ${response.status}).`);
  }
  for await (const event of readNdjson<StreamEvent>(response.body)) {
    if (event.type === "error") throw new Error(event.message);
    yield event;
  }
}

export interface CompletionResult {
  text: string;
  model: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

/** Runs a full (non-streaming from the caller's point of view) completion. */
export async function complete(
  connection: LlmConnection,
  messages: ChatMessage[],
  options: GenerateOptions = {},
  onDelta?: (text: string, total: string) => void,
): Promise<CompletionResult> {
  let text = "";
  let done: Extract<StreamEvent, { type: "done" }> | undefined;
  for await (const event of streamChat(connection, messages, options)) {
    if (event.type === "delta") {
      text += event.text;
      onDelta?.(event.text, text);
    } else if (event.type === "done") {
      done = event;
    }
  }
  return {
    text,
    model: done?.model ?? connection.model ?? "",
    durationMs: done?.durationMs ?? 0,
    promptTokens: done?.promptTokens,
    completionTokens: done?.completionTokens,
  };
}

/**
 * Asks for JSON matching a zod schema. Uses constrained decoding where the provider
 * supports it (Ollama), validates the result, and retries once with the error message.
 */
export async function completeJson<T extends z.ZodType>(
  connection: LlmConnection,
  messages: ChatMessage[],
  schema: T,
  options: Omit<GenerateOptions, "json"> = {},
  onDelta?: (text: string, total: string) => void,
): Promise<{ data: z.infer<T>; result: CompletionResult }> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const result = await complete(connection, messages, { ...options, json: { schema: jsonSchema } }, onDelta);
  try {
    return { data: parseWithSchema(result.text, schema), result };
  } catch (error) {
    const retry = await complete(
      connection,
      [
        ...messages,
        { role: "assistant", content: result.text.slice(0, 6000) },
        {
          role: "user",
          content: `Your previous reply was not valid: ${(error as Error).message} Reply again with ONLY valid JSON matching the requested format.`,
        },
      ],
      { ...options, json: { schema: jsonSchema } },
      onDelta,
    );
    return { data: parseWithSchema(retry.text, schema), result: retry };
  }
}

export async function fetchLlmStatus(connection: LlmConnection): Promise<LlmStatus> {
  if (connection.mode === "browser-ollama") {
    return new OllamaProvider({
      baseUrl: connection.ollamaUrl || "http://localhost:11434",
      model: connection.model || "qwen2.5:7b-instruct",
    }).status();
  }
  const response = await fetch("/api/llm/status", { cache: "no-store" });
  if (!response.ok) throw new Error(`Status check failed (HTTP ${response.status}).`);
  return (await response.json()) as LlmStatus;
}
