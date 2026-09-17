/**
 * LLM provider abstraction.
 *
 * The rest of the app only talks to `LLMProvider`. Concrete providers:
 *   - OllamaProvider           — local open-source models (default, free, private)
 *   - OpenAICompatibleProvider — any server speaking the OpenAI chat API
 *                                (vLLM, LM Studio, llama.cpp, Groq, OpenRouter, OpenAI…)
 *   - HuggingFaceProvider      — Hugging Face Inference Providers (optional, token required)
 *
 * All providers use plain `fetch`, so they run on the server (API route) and, for
 * Ollama, directly in the browser ("private mode").
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  /** Request JSON output. Pass a JSON Schema to enable constrained decoding where supported. */
  json?: boolean | { schema: Record<string, unknown> };
  model?: string;
  signal?: AbortSignal;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      model: string;
      promptTokens?: number;
      completionTokens?: number;
      durationMs: number;
    }
  | { type: "error"; message: string };

export type ProviderId = "ollama" | "openai-compatible" | "huggingface" | "none";

export interface ProviderStatus {
  provider: ProviderId;
  label: string;
  model: string;
  available: boolean;
  models: string[];
  error?: string;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  streamChat(messages: ChatMessage[], options?: GenerateOptions): AsyncGenerator<StreamEvent>;
  status(): Promise<ProviderStatus>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
