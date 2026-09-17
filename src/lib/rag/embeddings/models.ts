/**
 * Registry of supported open-source models.
 *
 * All models run locally through Transformers.js (ONNX Runtime): in the browser via
 * WebAssembly, and in Node for the evaluation script. Nothing here calls a paid API.
 * Swapping the embedding model is a one-line change, but existing vectors must be
 * re-computed because vectors from different models live in different "spaces".
 */

export interface ConfidenceCalibration {
  /** Score at or above which retrieval confidence is "high". */
  high: number;
  medium: number;
  /** Below this, we consider the documents to contain no relevant evidence. */
  low: number;
  /**
   * Embedding models only: if the reranker finds nothing relevant but cosine similarity is
   * at least this high, report "low" instead of "none" (the cross-encoder is poorly
   * calibrated for some question styles, e.g. behavioural "tell me about a time…").
   */
  semanticRescue?: number;
}

export interface EmbeddingModelInfo {
  id: string;
  label: string;
  dims: number;
  /** How token vectors are combined into one sentence vector (from the model card). */
  pooling: "cls" | "mean";
  /** Some models expect an instruction in front of search queries. */
  queryPrefix?: string;
  documentPrefix?: string;
  /** Approximate download size of the 8-bit quantized ONNX weights. */
  sizeMb: number;
  maxTokens: number;
  multilingual: boolean;
  description: string;
  /** Cosine-similarity thresholds used for confidence when the reranker is off. */
  calibration: ConfidenceCalibration;
}

export const EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  {
    id: "Xenova/bge-small-en-v1.5",
    label: "BGE small en v1.5",
    dims: 384,
    pooling: "cls",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    sizeMb: 34,
    maxTokens: 512,
    multilingual: false,
    description: "Default. Best retrieval quality per megabyte among small English models (BAAI, MIT licence).",
    calibration: { high: 0.72, medium: 0.64, low: 0.56, semanticRescue: 0.66 },
  },
  {
    id: "Xenova/all-MiniLM-L6-v2",
    label: "all-MiniLM-L6-v2",
    dims: 384,
    pooling: "mean",
    sizeMb: 23,
    maxTokens: 256,
    multilingual: false,
    description: "The classic sentence-transformers model. Smallest and fastest; slightly weaker retrieval.",
    calibration: { high: 0.55, medium: 0.42, low: 0.3 },
  },
  {
    id: "Xenova/bge-base-en-v1.5",
    label: "BGE base en v1.5",
    dims: 768,
    pooling: "cls",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    sizeMb: 110,
    maxTokens: 512,
    multilingual: false,
    description: "Higher quality, 3x larger download and slower indexing.",
    calibration: { high: 0.72, medium: 0.64, low: 0.56 },
  },
  {
    id: "Xenova/multilingual-e5-small",
    label: "multilingual-e5-small",
    dims: 384,
    pooling: "mean",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    sizeMb: 118,
    maxTokens: 512,
    multilingual: true,
    description: "Supports ~100 languages. Use when documents are not in English.",
    calibration: { high: 0.86, medium: 0.82, low: 0.78 },
  },
];

export const DEFAULT_EMBEDDING_MODEL_ID = EMBEDDING_MODELS[0].id;

export function getEmbeddingModel(id: string): EmbeddingModelInfo {
  return EMBEDDING_MODELS.find((m) => m.id === id) ?? EMBEDDING_MODELS[0];
}

export interface RerankerModelInfo {
  id: string;
  label: string;
  sizeMb: number;
  description: string;
  /** Thresholds on the reranker's relevance probability (sigmoid of its logit). */
  calibration: ConfidenceCalibration;
}

export const RERANKER_MODELS: RerankerModelInfo[] = [
  {
    id: "Xenova/ms-marco-MiniLM-L-6-v2",
    label: "MS MARCO MiniLM-L6 cross-encoder",
    sizeMb: 23,
    description: "Small cross-encoder trained on 500k real search queries. Reads query and passage together.",
    calibration: { high: 0.5, medium: 0.1, low: 0.01 },
  },
];

export const DEFAULT_RERANKER_ID = RERANKER_MODELS[0].id;

export function getRerankerModel(id: string): RerankerModelInfo {
  return RERANKER_MODELS.find((m) => m.id === id) ?? RERANKER_MODELS[0];
}
