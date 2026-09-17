import type { ChunkingOptions } from "../types";
import type { EvalRunResult } from "./runner";

/** Shape of public/eval/reference-results.json, produced by `npm run eval`. */
export interface EvalReport {
  generatedAt: string;
  embeddingModel: string;
  rerankerModel: string;
  chunking: ChunkingOptions;
  documents: number;
  chunks: number;
  questions: number;
  k: number;
  runs: EvalRunResult[];
  grid: { chunkSize: number; overlap: number; runs: Omit<EvalRunResult, "questions">[] }[];
}
