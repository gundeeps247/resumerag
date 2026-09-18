/// <reference lib="webworker" />
/**
 * The in-browser language model, running in its own Web Worker.
 *
 * Generation is slow, heavy work (hundreds of MB of weights, a GPU or CPU busy for seconds),
 * so it lives apart from the RAG worker: retrieval and citation checks stay responsive while
 * a model is writing. The main thread talks to it through Comlink (src/lib/llm/in-browser.ts).
 *
 *  - WebGPU when the browser exposes a GPU adapter, otherwise multi-threaded WebAssembly.
 *  - One request at a time: a queue keeps workflows that fire several prompts from fighting
 *    over the same model.
 *  - Requests can be cancelled while queued or interrupted mid-generation.
 */
import { AutoModelForCausalLM, AutoTokenizer, InterruptableStoppingCriteria, TextStreamer, env } from "@huggingface/transformers";
import * as Comlink from "comlink";
import { getBrowserModel } from "@/lib/llm/browser-models";
import type { ChatMessage } from "@/lib/llm/types";
import type { ModelLoadProgress } from "@/lib/rag/embeddings/embedder";

env.allowLocalModels = false;

export type BrowserBackend = "webgpu" | "wasm";

export interface BrowserGenerateRequest {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
}

export interface BrowserGenerateStats {
  model: string;
  backend: BrowserBackend;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

interface Tensor {
  dims: number[];
}

interface Tokenizer {
  apply_chat_template(messages: ChatMessage[], options: Record<string, unknown>): { input_ids: Tensor } & Record<string, unknown>;
}

interface CausalLM {
  generate(options: Record<string, unknown>): Promise<Tensor>;
  dispose(): Promise<unknown>;
}

interface LoadedModel {
  id: string;
  backend: BrowserBackend;
  tokenizer: Tokenizer;
  model: CausalLM;
}

async function detectBackend(): Promise<BrowserBackend> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return "webgpu";
  } catch {
    // no usable GPU: fall back to WebAssembly
  }
  return "wasm";
}

export class BrowserLlmEngine {
  private loaded: LoadedModel | null = null;
  private loading: { id: string; promise: Promise<LoadedModel> } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly stopping = new InterruptableStoppingCriteria();
  private current: string | null = null;
  private readonly cancelled = new Set<string>();
  private progressListener: ((p: ModelLoadProgress) => void) | null = null;

  onProgress(listener: (p: ModelLoadProgress) => void) {
    this.progressListener = listener;
  }

  /** Which model is in memory and on which backend (null when none is loaded yet). */
  loadedModel(): { id: string; backend: BrowserBackend } | null {
    return this.loaded ? { id: this.loaded.id, backend: this.loaded.backend } : null;
  }

  async load(id: string): Promise<{ id: string; backend: BrowserBackend }> {
    const loaded = await this.ensureLoaded(id);
    return { id: loaded.id, backend: loaded.backend };
  }

  private ensureLoaded(id: string): Promise<LoadedModel> {
    if (this.loaded?.id === id) return Promise.resolve(this.loaded);
    if (this.loading?.id === id) return this.loading.promise;

    const promise = (async () => {
      const previous = this.loaded;
      this.loaded = null;
      await previous?.model.dispose().catch(() => undefined);

      const progress_callback = (p: Record<string, unknown>) =>
        this.progressListener?.({
          model: id,
          status: String(p.status ?? ""),
          file: typeof p.file === "string" ? p.file : undefined,
          progress: typeof p.progress === "number" ? p.progress : undefined,
          loaded: typeof p.loaded === "number" ? p.loaded : undefined,
          total: typeof p.total === "number" ? p.total : undefined,
        });

      const tokenizer = (await AutoTokenizer.from_pretrained(id, { progress_callback })) as unknown as Tokenizer;
      let backend = await detectBackend();
      let model: CausalLM;
      try {
        model = (await AutoModelForCausalLM.from_pretrained(id, {
          dtype: "q4",
          device: backend,
          progress_callback,
        })) as unknown as CausalLM;
      } catch (error) {
        if (backend !== "webgpu") throw error;
        // Some GPUs expose WebGPU but cannot run every operator: retry on the CPU.
        backend = "wasm";
        model = (await AutoModelForCausalLM.from_pretrained(id, {
          dtype: "q4",
          device: backend,
          progress_callback,
        })) as unknown as CausalLM;
      }
      this.progressListener?.({ model: id, status: "ready" });
      this.loaded = { id, backend, tokenizer, model };
      return this.loaded;
    })();

    this.loading = { id, promise };
    promise.then(
      () => {
        if (this.loading?.promise === promise) this.loading = null;
      },
      () => {
        if (this.loading?.promise === promise) this.loading = null;
      },
    );
    return promise;
  }

  /** Streams generated text through `onText`; resolves with token counts once finished. */
  generate(requestId: string, id: string, request: BrowserGenerateRequest, onText: (text: string) => void): Promise<BrowserGenerateStats> {
    const run = async (): Promise<BrowserGenerateStats> => {
      if (this.cancelled.delete(requestId)) throw new DOMException("Generation cancelled", "AbortError");
      const { tokenizer, model, backend } = await this.ensureLoaded(id);
      if (this.cancelled.delete(requestId)) throw new DOMException("Generation cancelled", "AbortError");

      // enable_thinking is ignored by models without a reasoning mode.
      const inputs = tokenizer.apply_chat_template(request.messages, {
        add_generation_prompt: true,
        return_dict: true,
        enable_thinking: false,
      });
      const promptTokens = inputs.input_ids.dims[1];
      const streamer = new TextStreamer(tokenizer as never, { skip_prompt: true, skip_special_tokens: true, callback_function: onText });
      // Small models follow instructions best greedily; sample only when variety is requested.
      const sample = request.temperature >= 0.4;

      this.current = requestId;
      this.stopping.reset();
      const started = performance.now();
      try {
        const output = await model.generate({
          ...inputs,
          max_new_tokens: request.maxTokens,
          do_sample: sample,
          ...(sample ? { temperature: request.temperature, top_p: 0.9 } : {}),
          repetition_penalty: 1.05,
          streamer,
          stopping_criteria: this.stopping,
        });
        return {
          model: getBrowserModel(id).label,
          backend,
          promptTokens,
          completionTokens: output.dims[1] - promptTokens,
          durationMs: performance.now() - started,
        };
      } finally {
        this.current = null;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Stops a running request, or drops it if it is still waiting in the queue. */
  cancel(requestId: string) {
    if (this.current === requestId) this.stopping.interrupt();
    else this.cancelled.add(requestId);
  }
}

Comlink.expose(new BrowserLlmEngine());
