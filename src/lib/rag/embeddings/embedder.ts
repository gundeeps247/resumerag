/**
 * Embedding generation with Transformers.js.
 *
 * An embedding model turns a piece of text into a list of numbers (a vector) such that
 * texts with similar meaning get similar vectors. The same class runs in the browser
 * (inside the RAG Web Worker) and in Node (evaluation script) — Transformers.js picks
 * the right ONNX runtime for each environment.
 */
import type { EmbeddingModelInfo } from "./models";

export interface ModelLoadProgress {
  model: string;
  status: string;
  file?: string;
  /** 0–100 for file downloads. */
  progress?: number;
  loaded?: number;
  total?: number;
}

export type ProgressCallback = (progress: ModelLoadProgress) => void;

export interface Embedder {
  readonly model: EmbeddingModelInfo;
  embedDocuments(texts: string[], onBatch?: (done: number, total: number) => void): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

export interface ModelRuntimeOptions {
  /** "webgpu" uses the GPU in supporting browsers; default is WASM (browser) / CPU (Node). */
  device?: "webgpu" | "wasm" | "cpu";
  dtype?: "q8" | "fp32" | "fp16";
  onProgress?: ProgressCallback;
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

const BATCH_SIZE = 16;

export class TransformersEmbedder implements Embedder {
  private constructor(
    readonly model: EmbeddingModelInfo,
    private readonly extractor: FeatureExtractor,
  ) {}

  static async create(model: EmbeddingModelInfo, options: ModelRuntimeOptions = {}): Promise<TransformersEmbedder> {
    const { pipeline } = await import("@huggingface/transformers");
    const extractor = await pipeline("feature-extraction", model.id, {
      dtype: options.dtype ?? (options.device === "webgpu" ? "fp32" : "q8"),
      ...(options.device && options.device !== "wasm" ? { device: options.device } : {}),
      progress_callback: (p: Record<string, unknown>) =>
        options.onProgress?.({
          model: model.id,
          status: String(p.status ?? ""),
          file: typeof p.file === "string" ? p.file : undefined,
          progress: typeof p.progress === "number" ? p.progress : undefined,
          loaded: typeof p.loaded === "number" ? p.loaded : undefined,
          total: typeof p.total === "number" ? p.total : undefined,
        }),
    });
    return new TransformersEmbedder(model, extractor as unknown as FeatureExtractor);
  }

  async embedDocuments(texts: string[], onBatch?: (done: number, total: number) => void): Promise<Float32Array[]> {
    const prefix = this.model.documentPrefix ?? "";
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE).map((t) => prefix + t);
      out.push(...(await this.run(batch)));
      onBatch?.(Math.min(i + BATCH_SIZE, texts.length), texts.length);
    }
    return out;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vector] = await this.run([(this.model.queryPrefix ?? "") + text]);
    return vector;
  }

  private async run(texts: string[]): Promise<Float32Array[]> {
    // normalize: true → every vector has length 1, so cosine similarity == dot product.
    const output = await this.extractor(texts, { pooling: this.model.pooling, normalize: true });
    const dims = output.dims[output.dims.length - 1];
    return texts.map((_, i) => new Float32Array(output.data.subarray(i * dims, (i + 1) * dims)));
  }
}
