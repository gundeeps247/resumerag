"use client";

/**
 * Browser-side access to the language model. Connection modes:
 *
 *  - "auto" (default): the server's provider when it has a working one, otherwise the
 *                      in-browser model — so a deployment with no model configured still generates.
 *  - "server":         POST /api/llm/chat → the provider configured on the server.
 *  - "in-browser":     a small open-weight model running in this tab (WebGPU or WebAssembly),
 *                      downloaded once and cached. Free, private, no server involved.
 *  - "browser-ollama": the browser talks directly to Ollama on the user's machine
 *                      (http://localhost:11434). Useful on a deployed site: the UI comes from
 *                      Vercel, but prompts and documents never leave your computer.
 *                      Requires OLLAMA_ORIGINS to allow the site's origin.
 */
import { z } from "zod";
import { getBrowserModel } from "./browser-models";
import { browserModelStatus, loadBrowserModel, streamInBrowser, type BrowserModelStatus } from "./in-browser";
import { parseWithSchema } from "./json";
import { OllamaProvider } from "./providers/ollama";
import { readNdjson, withStallTimeout } from "./stream";
import type { ChatMessage, GenerateOptions, ProviderStatus, StreamEvent } from "./types";

export type LlmMode = "auto" | "server" | "in-browser" | "browser-ollama";

export interface LlmConnection {
  mode: LlmMode;
  /** Optional model override for the server or Ollama (must exist on the provider). */
  model?: string;
  /** Which in-browser model to use (see browser-models.ts). */
  browserModel?: string;
  ollamaUrl?: string;
  accessCode?: string;
}

export interface LlmStatus extends ProviderStatus {
  requiresAccessCode?: boolean;
  maxOutputTokens?: number;
  inBrowser?: BrowserModelStatus["inBrowser"];
}

/**
 * A CPU-only machine can take minutes to load a 7B model and read a long prompt, so the
 * first-output limit is generous; after that, tokens arrive every fraction of a second.
 */
const STALL_LIMITS = { firstMs: 240_000, idleMs: 90_000 };
/** In the browser a request may also wait for another prompt to finish (one model, one queue). */
const BROWSER_STALL_LIMITS = { firstMs: 300_000, idleMs: 90_000 };

/**
 * The last /api/llm/status response (polled by the UI). When the server reports that no provider
 * is configured, "server" mode fails fast instead of sending a request that can only return 503,
 * and "auto" mode switches to the in-browser model.
 */
let serverStatus: { value: LlmStatus; at: number } | null = null;
const SERVER_STATUS_MAX_AGE_MS = 30_000;

export const NO_SERVER_PROVIDER_MESSAGE = "No LLM provider is configured on the server (LLM_PROVIDER=none).";

/**
 * Records what the server's status endpoint reported. The UI polls the status every 30 s
 * (use-llm-status.ts) through fetchLlmStatus, which lands here, so "auto" usually decides
 * without a request of its own. Pass null to forget it and force a fresh check.
 */
export function rememberServerStatus(status: LlmStatus | null) {
  serverStatus = status ? { value: status, at: Date.now() } : null;
}

async function fetchServerStatus(): Promise<LlmStatus> {
  const response = await fetch("/api/llm/status", { cache: "no-store" });
  if (!response.ok) throw new Error(`Status check failed (HTTP ${response.status}).`);
  const value = (await response.json()) as LlmStatus;
  rememberServerStatus(value);
  return value;
}

/** "auto" uses the server only when it has a reachable model this user is allowed to call. */
export function serverIsUsable(status: LlmStatus | null, connection: Pick<LlmConnection, "accessCode">): boolean {
  return Boolean(status?.available && (!status.requiresAccessCode || connection.accessCode));
}

export async function resolveMode(connection: LlmConnection): Promise<Exclude<LlmMode, "auto">> {
  if (connection.mode !== "auto") return connection.mode;
  const fresh = serverStatus && Date.now() - serverStatus.at < SERVER_STATUS_MAX_AGE_MS;
  const status = fresh ? serverStatus!.value : await fetchServerStatus().catch(() => null);
  return serverIsUsable(status, connection) ? "server" : "in-browser";
}

export function streamChat(connection: LlmConnection, messages: ChatMessage[], options: GenerateOptions = {}): AsyncGenerator<StreamEvent> {
  return (async function* () {
    const mode = await resolveMode(connection);
    if (mode === "in-browser") {
      const id = getBrowserModel(connection.browserModel).id;
      // The first download can take minutes on a slow connection; that is not a stall.
      await loadBrowserModel(id, options.signal);
      yield* withStallTimeout((signal) => streamInBrowser(id, messages, { ...options, signal }), {
        signal: options.signal,
        ...BROWSER_STALL_LIMITS,
      });
      return;
    }
    yield* withStallTimeout((signal) => openStream({ ...connection, mode }, messages, { ...options, signal }), {
      signal: options.signal,
      ...STALL_LIMITS,
    });
  })();
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

  if (serverStatus?.value.provider === "none") throw new Error(NO_SERVER_PROVIDER_MESSAGE);

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
  switch (connection.mode) {
    case "browser-ollama":
      return new OllamaProvider({
        baseUrl: connection.ollamaUrl || "http://localhost:11434",
        model: connection.model || "qwen2.5:7b-instruct",
      }).status();
    case "in-browser":
      return browserModelStatus(getBrowserModel(connection.browserModel).id);
    case "server":
      return fetchServerStatus();
    case "auto": {
      const server = await fetchServerStatus().catch(() => null);
      if (server && serverIsUsable(server, connection)) return server;
      return browserModelStatus(getBrowserModel(connection.browserModel).id);
    }
  }
}
