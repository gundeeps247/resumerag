/**
 * OpenAI-compatible provider.
 *
 * Many servers implement the same `/v1/chat/completions` API: self-hosted vLLM,
 * LM Studio, llama.cpp's server, Ollama's /v1 endpoint, and hosted services with free
 * tiers for open-weight models (Groq, OpenRouter). OpenAI itself works too, but it is
 * strictly optional — the app never requires a paid API.
 */
import { readSse } from "../stream";
import {
  ProviderError,
  type ChatMessage,
  type GenerateOptions,
  type LLMProvider,
  type ProviderId,
  type ProviderStatus,
  type StreamEvent,
} from "../types";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  label?: string;
}

interface CompletionChunk {
  model?: string;
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: ProviderId = "openai-compatible";
  readonly label: string;

  constructor(protected readonly config: OpenAICompatibleConfig) {
    this.label = config.label ?? "OpenAI-compatible API";
  }

  get model(): string {
    return this.config.model;
  }

  protected headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
    };
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  async *streamChat(messages: ChatMessage[], options: GenerateOptions = {}): AsyncGenerator<StreamEvent> {
    const started = Date.now();
    const model = options.model || this.config.model;
    let response: Response;
    try {
      response = await fetch(this.url("/chat/completions"), {
        method: "POST",
        headers: this.headers(),
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 800,
          // json_object is the most widely supported JSON mode; the schema is described in the prompt.
          ...(options.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new ProviderError(`Cannot reach ${this.label} at ${this.config.baseUrl}.`);
    }

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new ProviderError(extractError(detail) || `${this.label} returned HTTP ${response.status}`, response.status);
    }

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    for await (const chunk of readSse<CompletionChunk>(response.body)) {
      if (chunk.error?.message) throw new ProviderError(chunk.error.message);
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { type: "delta", text };
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
      }
    }
    yield { type: "done", model, promptTokens, completionTokens, durationMs: Date.now() - started };
  }

  async status(): Promise<ProviderStatus> {
    const base = { provider: this.id, label: this.label, model: this.config.model };
    if (!this.config.baseUrl) return { ...base, available: false, models: [], error: "No base URL configured." };
    try {
      const response = await fetch(this.url("/models"), { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { data?: { id: string }[] };
      const models = (data.data ?? []).map((m) => m.id).slice(0, 200);
      return { ...base, available: true, models };
    } catch (error) {
      return { ...base, available: false, models: [], error: `${this.label} is not reachable (${(error as Error).message}).` };
    }
  }
}

function extractError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    return typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? body.slice(0, 300));
  } catch {
    return body.slice(0, 300);
  }
}
