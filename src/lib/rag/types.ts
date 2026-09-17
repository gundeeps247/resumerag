/**
 * Core domain types shared by every stage of the RAG pipeline.
 *
 * These types are deliberately framework-free so the same code runs in the
 * browser (Web Worker), in Node (evaluation scripts) and in unit tests.
 */

/** What kind of document this is. Used for metadata filtering during retrieval. */
export const DOC_TYPES = [
  "resume",
  "project_report",
  "job_description",
  "company_info",
  "research_paper",
  "internship",
  "notes",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  resume: "Resume",
  project_report: "Project report",
  job_description: "Job description",
  company_info: "Company info",
  research_paper: "Research paper",
  internship: "Internship doc",
  notes: "Notes",
  other: "Other",
};

/**
 * Document types that describe the *employer*, not the candidate.
 * Evidence about the candidate must never come from these, otherwise a JD that
 * says "Kubernetes required" could be mistaken for proof that the candidate knows Kubernetes.
 */
export const EMPLOYER_DOC_TYPES: DocType[] = ["job_description", "company_info"];

export type SupportedFormat = "pdf" | "docx" | "md" | "txt";

/** A structural unit produced by a parser. Chunking works on blocks, not raw strings. */
export type BlockKind = "heading" | "paragraph" | "list_item" | "table_row";

export interface TextBlock {
  kind: BlockKind;
  text: string;
  /** Heading level (1 = top level). Only set for headings. */
  level?: number;
  /** 1-based page number. Only available for paginated formats (PDF). */
  page?: number;
}

export interface ParsedDocument {
  title: string;
  format: SupportedFormat;
  blocks: TextBlock[];
  pageCount?: number;
  /** Non-fatal problems worth showing the user (e.g. "looks like a scanned PDF"). */
  warnings: string[];
}

/** A chunk before it has been embedded or stored. */
export interface ChunkDraft {
  index: number;
  text: string;
  /** Breadcrumb of headings the chunk lives under, e.g. ["Projects", "LexiSearch"]. */
  headingPath: string[];
  pageStart?: number;
  pageEnd?: number;
  tokenCount: number;
  /** Number of leading characters repeated from the previous chunk (the overlap). */
  overlapChars?: number;
}

export interface Chunk extends ChunkDraft {
  id: string;
  docId: string;
  /** Text actually sent to the embedding model: title + heading path + chunk text. */
  embedText: string;
  /** Set when the chunk contains text that looks like a prompt-injection attempt. */
  suspicious?: boolean;
}

export interface StoredChunk extends Chunk {
  vector: Float32Array;
}

export type DocumentStatus = "queued" | "parsing" | "chunking" | "embedding" | "ready" | "error";

export interface KbDocument {
  id: string;
  name: string;
  format: SupportedFormat;
  docType: DocType;
  /** True when the user manually changed the auto-detected type. */
  docTypeLocked?: boolean;
  size: number;
  /** SHA-256 of the file bytes, used for duplicate detection. */
  hash: string;
  status: DocumentStatus;
  progress: number;
  error?: string;
  warnings: string[];
  pageCount?: number;
  charCount: number;
  chunkCount: number;
  /** Embedding model the stored vectors were produced with. */
  embeddingModel?: string;
  chunking?: ChunkingOptions;
  source: "upload" | "paste" | "demo";
  createdAt: number;
  updatedAt: number;
}

export interface ChunkingOptions {
  /** Target chunk size in (estimated) tokens. */
  chunkSize: number;
  /** Tokens of trailing context repeated at the start of the next chunk. */
  chunkOverlap: number;
  /** Chunks smaller than this are merged into a neighbour when possible. */
  minChunkSize: number;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export type RetrievalMode = "semantic" | "keyword" | "hybrid";

export interface RetrievalFilter {
  docTypes?: DocType[];
  excludeDocTypes?: DocType[];
  docIds?: string[];
}

export interface RetrievalOptions {
  mode: RetrievalMode;
  /** How many chunks end up in the LLM context. */
  topK: number;
  /** How many candidates each retriever returns before fusion / reranking. */
  candidateK: number;
  rerank: boolean;
  /** Minimum cosine similarity for semantic hits (0 disables). */
  minSimilarity: number;
  /** Reciprocal Rank Fusion constant. 60 is the value from the original paper. */
  rrfK: number;
  filter?: RetrievalFilter;
  /** Add interview vocabulary to the keyword query (see retrieval/query-expansion.ts). Default on. */
  queryExpansion?: boolean;
}

/** One candidate chunk with every score it collected along the pipeline. */
export interface ScoredCandidate {
  chunkId: string;
  docId: string;
  denseScore?: number;
  denseRank?: number;
  keywordScore?: number;
  keywordRank?: number;
  fusedScore: number;
  fusedRank: number;
  rerankScore?: number;
  rerankRank?: number;
  finalRank?: number;
  selected: boolean;
  dropReason?: "below_threshold" | "outside_top_k";
}

export type ConfidenceLevel = "high" | "medium" | "low" | "none";

export interface RetrievalConfidence {
  level: ConfidenceLevel;
  /** 0..1 — best relevance signal among selected chunks. */
  score: number;
  reason: string;
}

export interface RetrievalTimings {
  embedMs: number;
  denseMs: number;
  keywordMs: number;
  fusionMs: number;
  rerankMs: number;
  totalMs: number;
}

export interface RetrievedChunk {
  chunk: Chunk;
  document: Pick<KbDocument, "id" | "name" | "docType" | "format">;
  /** Best available relevance score for display (rerank probability or cosine). */
  score: number;
  candidate: ScoredCandidate;
  /** Set when the chunk was found by an exact lookup rather than by search. */
  via?: "skill-lookup";
}

/** Lightweight description of a candidate chunk, so traces can show dropped candidates too. */
export interface CandidatePreview {
  docName: string;
  docType: DocType;
  snippet: string;
  headingPath: string[];
  pageStart?: number;
}

export interface RetrievalResult {
  query: string;
  previews: Record<string, CandidatePreview>;
  /** The text actually embedded (may include an instruction prefix). */
  embeddedQuery: string;
  /** The text given to BM25 (the question plus any query expansion). */
  keywordQuery?: string;
  options: RetrievalOptions;
  results: RetrievedChunk[];
  candidates: ScoredCandidate[];
  timings: RetrievalTimings;
  confidence: RetrievalConfidence;
  chunksSearched: number;
  embeddingModel: string;
  rerankerModel?: string;
}
