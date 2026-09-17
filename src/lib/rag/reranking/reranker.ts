/**
 * Cross-encoder reranking.
 *
 * The embedding model encodes the question and each chunk *separately* (a "bi-encoder"),
 * which is fast enough to compare against every chunk but can miss nuance.
 * A cross-encoder reads the question and one chunk *together* and outputs a relevance
 * score. It is much more accurate but too slow to run over every chunk, so we only use
 * it on the ~20 candidates the first-stage retrievers found.
 */
import type { ModelRuntimeOptions } from "../embeddings/embedder";
import type { RerankerModelInfo } from "../embeddings/models";

export interface Reranker {
  readonly model: RerankerModelInfo;
  /** Returns one relevance probability (0–1) per passage, in input order. */
  score(query: string, passages: string[]): Promise<number[]>;
}

interface Tokenizer {
  (texts: string[], options: { text_pair: string[]; padding: boolean; truncation: boolean; max_length: number }): unknown;
}
interface SequenceClassifier {
  (inputs: unknown): Promise<{ logits: { data: Float32Array | number[] } }>;
}

const BATCH_SIZE = 10;

export class CrossEncoderReranker implements Reranker {
  private constructor(
    readonly model: RerankerModelInfo,
    private readonly tokenizer: Tokenizer,
    private readonly classifier: SequenceClassifier,
  ) {}

  static async create(model: RerankerModelInfo, options: ModelRuntimeOptions = {}): Promise<CrossEncoderReranker> {
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@huggingface/transformers");
    const progress_callback = (p: Record<string, unknown>) =>
      options.onProgress?.({
        model: model.id,
        status: String(p.status ?? ""),
        file: typeof p.file === "string" ? p.file : undefined,
        progress: typeof p.progress === "number" ? p.progress : undefined,
        loaded: typeof p.loaded === "number" ? p.loaded : undefined,
        total: typeof p.total === "number" ? p.total : undefined,
      });
    const tokenizer = await AutoTokenizer.from_pretrained(model.id, { progress_callback });
    const classifier = await AutoModelForSequenceClassification.from_pretrained(model.id, {
      dtype: options.dtype ?? "q8",
      ...(options.device && options.device !== "wasm" ? { device: options.device } : {}),
      progress_callback,
    });
    return new CrossEncoderReranker(model, tokenizer as unknown as Tokenizer, classifier as unknown as SequenceClassifier);
  }

  async score(query: string, passages: string[]): Promise<number[]> {
    const scores: number[] = [];
    for (let i = 0; i < passages.length; i += BATCH_SIZE) {
      const batch = passages.slice(i, i + BATCH_SIZE);
      const inputs = this.tokenizer(new Array(batch.length).fill(query), {
        text_pair: batch,
        padding: true,
        truncation: true,
        max_length: 512,
      });
      const { logits } = await this.classifier(inputs);
      // One logit per pair; the sigmoid squashes it into a 0–1 relevance probability.
      for (const logit of Array.from(logits.data)) scores.push(1 / (1 + Math.exp(-logit)));
    }
    return scores;
  }
}
