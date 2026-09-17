import type { ChunkingOptions, RetrievalOptions } from "./types";

/**
 * Default chunking settings.
 *
 * ~220 tokens is roughly one resume role, one project block or two report paragraphs:
 * small enough that a retrieved chunk is "about one thing", large enough to keep the
 * surrounding context (what project, which company). The overlap repeats roughly the
 * last sentence so a fact that straddles a boundary is still retrievable.
 * These values were picked with the evaluation harness (see docs/DESIGN_DECISIONS.md).
 */
export const DEFAULT_CHUNKING: ChunkingOptions = {
  chunkSize: 220,
  chunkOverlap: 40,
  minChunkSize: 30,
};

/**
 * Default retrieval settings: hybrid search (BM25 + embeddings fused with RRF),
 * 20 candidates reranked by a cross-encoder, top 5 kept for the LLM.
 */
export const DEFAULT_RETRIEVAL: RetrievalOptions = {
  mode: "hybrid",
  topK: 5,
  candidateK: 20,
  rerank: true,
  minSimilarity: 0,
  rrfK: 60,
  queryExpansion: true,
};

/** Upload guard-rails. Enforced before any parsing happens. */
export const FILE_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxFilesPerUpload: 20,
  maxPdfPages: 200,
  /** Text beyond this many characters is truncated (protects the browser tab). */
  maxChars: 1_500_000,
  /** Pasted text (e.g. a job description) limit. */
  maxPasteChars: 60_000,
} as const;

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".md", ".markdown", ".txt"] as const;

export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  // Some browsers/OSes report an empty or generic type for .md/.docx files.
  "",
  "application/octet-stream",
] as const;
