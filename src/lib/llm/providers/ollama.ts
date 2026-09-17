/**
 * Ollama provider — runs open-source LLMs (Qwen, Llama, Gemma, Mistral…) on your own
 * machine. This is the default generation backend: free, private and offline-capable.
 * API reference: https://github.com/ollama/ollama/blob/main/docs/api.md
 */
import { readNdjson } from "../stream";
import { ProviderError, type ChatMessage, type GenerateOptions, type LLMProvider, type ProviderStatus, type StreamEvent } from "../types";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  /** Context window. Ollama's small default silently truncates long RAG prompts. */
  numCtx?: number;
}

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  model?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export class OllamaProvider implements LLMProvider {
  readonly id = "ollama" as const;
  readonly label = "Ollama (local)";

  constructor(private readonly config: OllamaConfig) {}

  get model(): string {
    return this.config.model;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  async *streamChat(messages: ChatMessage[], options: GenerateOptions = {}): AsyncGenerator<StreamEvent> {
    const started = Date.now();
    const model = options.model || this.config.model;
    const format = options.json ? (typeof options.json === "object" ? options.json.schema : "json") : undefined;

    let response: Response;
    try {
      response = await fetch(this.url("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          format,
          keep_alive: "15m",
          options: {
            temperature: options.temperature ?? 0.2,
            num_predict: options.maxTokens ?? 800,
            num_ctx: this.config.numCtx ?? 8192,
          },
        }),
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new ProviderError(`Cannot reach Ollama at ${this.config.baseUrl}. Is it running? (ollama serve)`);
    }

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new ProviderError(parseOllamaError(detail) || `Ollama returned HTTP ${response.status}`, response.status);
    }

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    for await (const chunk of readNdjson<OllamaChunk>(response.body)) {
      if (chunk.error) throw new ProviderError(chunk.error);
      const text = chunk.message?.content;
      if (text) yield { type: "delta", text };
      if (chunk.done) {
        promptTokens = chunk.prompt_eval_count;
        completionTokens = chunk.eval_count;
      }
    }
    yield { type: "done", model, promptTokens, completionTokens, durationMs: Date.now() - started };
  }

  async status(): Promise<ProviderStatus> {
    const base = { provider: this.id, label: this.label, model: this.config.model };
    try {
      const response = await fetch(this.url("/api/tags"), { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { models?: { name: string }[] };
      const models = (data.models ?? []).map((m) => m.name);
      const hasModel = models.some((m) => m === this.config.model || m === `${this.config.model}:latest`);
      return {
        ...base,
        available: hasModel,
        models,
        error: hasModel ? undefined : `Model "${this.config.model}" is not pulled. Run: ollama pull ${this.config.model}`,
      };
    } catch {
      return { ...base, available: false, models: [], error: `Ollama is not reachable at ${this.config.baseUrl}.` };
    }
  }
}

function parseOllamaError(body: string): string {
  try {
    return (JSON.parse(body) as { error?: string }).error ?? body;
  } catch {
    return body.slice(0, 300);
  }
}
