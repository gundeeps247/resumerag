/**
 * In-memory search index: one flat matrix of vectors for semantic search plus a BM25
 * inverted index for keyword search, both over the same list of chunks.
 *
 * This is the project's "vector database". For a personal knowledge base (hundreds to a
 * few thousand chunks) exact brute-force search takes milliseconds and has perfect
 * recall, so an approximate index (HNSW/IVF) would add complexity without benefit.
 * The `VectorIndex`-style interface (dense / keyword / similarity) is what a pgvector
 * implementation would provide for multi-user, server-side deployments.
 */
import type { Chunk, KbDocument, RetrievalFilter, StoredChunk } from "../types";
import { dot, topKByDot, type VectorHit } from "../embeddings/vector-math";
import { Bm25Index, type Bm25Hit } from "./bm25";

export type IndexedDocument = Pick<KbDocument, "id" | "name" | "docType" | "format">;

export interface IndexEntry {
  chunk: Chunk;
  document: IndexedDocument;
}

export class SearchIndex {
  readonly entries: IndexEntry[];
  readonly dims: number;
  private readonly matrix: Float32Array;
  private readonly bm25: Bm25Index;
  private readonly positions = new Map<string, number>();

  constructor(chunks: StoredChunk[], documents: IndexedDocument[]) {
    const docsById = new Map(documents.map((d) => [d.id, d]));
    const usable = chunks.filter((c) => docsById.has(c.docId) && c.vector?.length);
    this.dims = usable[0]?.vector.length ?? 0;
    this.matrix = new Float32Array(usable.length * this.dims);
    this.entries = usable.map((stored, i) => {
      const { vector, ...chunk } = stored;
      this.matrix.set(vector, i * this.dims);
      this.positions.set(chunk.id, i);
      return { chunk, document: docsById.get(chunk.docId)! };
    });
    // BM25 indexes the same contextual text that is embedded (title + headings + body).
    this.bm25 = new Bm25Index(this.entries.map((e) => e.chunk.embedText));
  }

  get size(): number {
    return this.entries.length;
  }

  /** Builds a predicate implementing metadata filtering (doc types / specific documents). */
  filter(filter?: RetrievalFilter): ((index: number) => boolean) | undefined {
    if (!filter) return undefined;
    const { docTypes, excludeDocTypes, docIds } = filter;
    if (!docTypes?.length && !excludeDocTypes?.length && !docIds?.length) return undefined;
    return (i) => {
      const doc = this.entries[i].document;
      if (docIds?.length && !docIds.includes(doc.id)) return false;
      if (docTypes?.length && !docTypes.includes(doc.docType)) return false;
      if (excludeDocTypes?.length && excludeDocTypes.includes(doc.docType)) return false;
      return true;
    };
  }

  dense(query: Float32Array, k: number, allow?: (index: number) => boolean): VectorHit[] {
    if (!this.dims || query.length !== this.dims) return [];
    return topKByDot(this.matrix, this.dims, query, k, allow);
  }

  keyword(query: string, k: number, allow?: (index: number) => boolean): Bm25Hit[] {
    return this.bm25.search(query, k, allow);
  }

  matchedTerms(query: string): string[] {
    return this.bm25.matchedTerms(query);
  }

  /** Cosine similarity between a query vector and one indexed chunk. */
  similarity(query: Float32Array, index: number): number {
    return dot(query, this.matrix.subarray(index * this.dims, (index + 1) * this.dims));
  }

  vectorOf(chunkId: string): Float32Array | undefined {
    const i = this.positions.get(chunkId);
    return i === undefined ? undefined : this.matrix.subarray(i * this.dims, (i + 1) * this.dims);
  }

  indexOf(chunkId: string): number | undefined {
    return this.positions.get(chunkId);
  }
}
