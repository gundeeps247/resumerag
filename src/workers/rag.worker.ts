/// <reference lib="webworker" />
/**
 * The RAG engine, running in a Web Worker.
 *
 * Parsing PDFs and running neural networks takes real CPU time; doing it in a worker
 * keeps the UI smooth. The worker owns:
 *   - the embedding model and the cross-encoder reranker (Transformers.js / ONNX, WASM)
 *   - document ingestion (parse → chunk → embed → store in IndexedDB)
 *   - the in-memory search index, rebuilt whenever the knowledge base changes
 *   - evaluation and playground experiments
 * The main thread calls it through Comlink as if it were a normal async object.
 */
import { env } from "@huggingface/transformers";
import * as Comlink from "comlink";
import { bumpKbVersion, getDb, getKbVersion } from "@/lib/db/schema";
import { DEMO_DOCUMENTS } from "@/lib/demo";
import { DEFAULT_CHUNKING } from "@/lib/rag/config";
import { classifyDocument } from "@/lib/rag/classify";
import { TransformersEmbedder, type ModelLoadProgress } from "@/lib/rag/embeddings/embedder";
import { DEFAULT_EMBEDDING_MODEL_ID, getEmbeddingModel, getRerankerModel } from "@/lib/rag/embeddings/models";
import { cosineSimilarity, dot } from "@/lib/rag/embeddings/vector-math";
import { EVAL_QUESTIONS } from "@/lib/rag/evaluation/dataset";
import { EVAL_CONFIGS, runEvaluation, type EvalRunResult } from "@/lib/rag/evaluation/runner";
import { chunkDocument, embedChunks, parseSource, type IngestSource } from "@/lib/rag/ingestion/pipeline";
import { CrossEncoderReranker } from "@/lib/rag/reranking/reranker";
import { retrieve, type RetrieverDeps } from "@/lib/rag/retrieval/retriever";
import { SearchIndex, type IndexedDocument } from "@/lib/rag/retrieval/search-index";
import { splitSentences } from "@/lib/rag/chunking/sentences";
import type {
  Chunk,
  ChunkingOptions,
  DocType,
  KbDocument,
  ParsedDocument,
  RetrievalOptions,
  RetrievalResult,
  StoredChunk,
  SupportedFormat,
} from "@/lib/rag/types";

// Models come from the Hugging Face Hub and are cached by the browser after the first download.
env.allowLocalModels = false;

export interface EngineConfig {
  embeddingModelId: string;
  device: "wasm" | "webgpu";
}

export interface IngestJob {
  docId: string;
  source: IngestSource;
  chunking: ChunkingOptions;
  /** Known type (demo files, pasted JD); otherwise the classifier decides. */
  docTypeHint?: DocType;
}

export interface EngineStatus {
  embeddingModelId: string;
  embedderReady: boolean;
  rerankerReady: boolean;
  device: string;
  indexedChunks: number;
}

export interface PlaygroundResult {
  retrieval: RetrievalResult;
  chunkCount: number;
  avgChunkTokens: number;
  buildMs: number;
}

export interface SimilarPair {
  a: string;
  b: string;
  similarity: number;
}

type ProgressListener = (progress: ModelLoadProgress) => void;

/** Turns low-level runtime errors into messages a user can act on. */
function friendlyError(error: unknown): string {
  const message = (error as Error)?.message || String(error);
  if (/no available backend|onnx|wasm/i.test(message)) {
    return `The in-browser AI runtime could not start. Check your connection (models download on first use) or try another browser. Details: ${message.slice(0, 160)}`;
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Could not download the embedding model. Check your internet connection, then retry.";
  }
  return message || "Failed to process document.";
}
type EvalProgress = (done: number, total: number, label: string) => void;

class RagEngine {
  private config: EngineConfig = { embeddingModelId: DEFAULT_EMBEDDING_MODEL_ID, device: "wasm" };
  private embedder: Promise<TransformersEmbedder> | null = null;
  private embedderReady = false;
  private reranker: Promise<CrossEncoderReranker> | null = null;
  private rerankerReady = false;
  private index: SearchIndex | null = null;
  private indexKey = "";
  private playground: { key: string; index: SearchIndex; buildMs: number } | null = null;
  private evalIndex: { key: string; index: SearchIndex } | null = null;
  private listeners = new Set<ProgressListener>();
  private queue: Promise<unknown> = Promise.resolve();

  // ------------------------------------------------------------------ models

  onModelProgress(listener: ProgressListener) {
    this.listeners.add(listener);
  }

  configure(config: Partial<EngineConfig>) {
    const next = { ...this.config, ...config };
    if (next.embeddingModelId !== this.config.embeddingModelId || next.device !== this.config.device) {
      this.embedder = null;
      this.embedderReady = false;
      this.reranker = null;
      this.rerankerReady = false;
      this.index = null;
      this.indexKey = "";
      this.playground = null;
      this.evalIndex = null;
    }
    this.config = next;
  }

  private emit(progress: ModelLoadProgress) {
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }

  private getEmbedder(): Promise<TransformersEmbedder> {
    if (!this.embedder) {
      const model = getEmbeddingModel(this.config.embeddingModelId);
      this.embedder = TransformersEmbedder.create(model, { device: this.config.device, onProgress: (p) => this.emit(p) })
        .then((e) => {
          this.embedderReady = true;
          this.emit({ model: model.id, status: "ready" });
          return e;
        })
        .catch((error) => {
          this.embedder = null;
          throw error;
        });
    }
    return this.embedder;
  }

  private getReranker(): Promise<CrossEncoderReranker> {
    if (!this.reranker) {
      const model = getRerankerModel("");
      this.reranker = CrossEncoderReranker.create(model, { device: this.config.device, onProgress: (p) => this.emit(p) })
        .then((r) => {
          this.rerankerReady = true;
          this.emit({ model: model.id, status: "ready" });
          return r;
        })
        .catch((error) => {
          this.reranker = null;
          throw error;
        });
    }
    return this.reranker;
  }

  async warmup(options: { reranker: boolean }) {
    await this.getEmbedder();
    if (options.reranker) await this.getReranker();
  }

  async status(): Promise<EngineStatus> {
    return {
      embeddingModelId: this.config.embeddingModelId,
      embedderReady: this.embedderReady,
      rerankerReady: this.rerankerReady,
      device: this.config.device,
      indexedChunks: this.index?.size ?? 0,
    };
  }

  // --------------------------------------------------------------- ingestion

  /** Queues a document for ingestion. Jobs run one at a time to bound memory use. */
  ingest(job: IngestJob): Promise<void> {
    const run = this.queue.then(() => this.runIngest(job));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runIngest(job: IngestJob): Promise<void> {
    const db = getDb();
    const update = (patch: Partial<KbDocument>) => db.documents.update(job.docId, { ...patch, updatedAt: Date.now() });
    try {
      await update({ status: "parsing", progress: 5, error: undefined });
      const parsed = await parseSource(job.source);
      await this.store(job, parsed);
    } catch (error) {
      await update({ status: "error", progress: 0, error: friendlyError(error) });
      throw error;
    }
  }

  private async store(job: IngestJob, parsed: ParsedDocument) {
    const db = getDb();
    const doc = await db.documents.get(job.docId);
    if (!doc) return; // deleted while processing
    const update = (patch: Partial<KbDocument>) => db.documents.update(job.docId, { ...patch, updatedAt: Date.now() });

    const classification = classifyDocument(doc.name, parsed.blocks);
    const docType = doc.docTypeLocked ? doc.docType : (job.docTypeHint ?? classification.docType);
    await db.contents.put({ docId: job.docId, title: parsed.title, blocks: parsed.blocks, pageCount: parsed.pageCount });
    await update({
      status: "chunking",
      progress: 15,
      docType,
      pageCount: parsed.pageCount,
      warnings: parsed.warnings,
      charCount: parsed.blocks.reduce((n, b) => n + b.text.length, 0),
    });

    const chunks = chunkDocument(job.docId, doc.name, parsed, job.chunking);
    if (!chunks.length) throw new Error("No readable text was found in this document.");
    await update({ status: "embedding", progress: 20, chunkCount: chunks.length });

    const embedder = await this.getEmbedder();
    let lastWrite = 0;
    const stored = await embedChunks(chunks, embedder, (done, total) => {
      const now = Date.now();
      if (now - lastWrite > 250 || done === total) {
        lastWrite = now;
        void update({ progress: Math.round(20 + (78 * done) / total) });
      }
    });

    await db.transaction("rw", db.chunks, db.documents, db.meta, async () => {
      if (!(await db.documents.get(job.docId))) return;
      await db.chunks.where("docId").equals(job.docId).delete();
      await db.chunks.bulkPut(stored);
      await db.documents.update(job.docId, {
        status: "ready",
        progress: 100,
        chunkCount: stored.length,
        embeddingModel: embedder.model.id,
        chunking: job.chunking,
        updatedAt: Date.now(),
      });
      await bumpKbVersion(db);
    });
  }

  /** Re-chunks and re-embeds documents from their stored parsed text (e.g. after changing model or chunk size). */
  reindex(docIds: string[], chunking: ChunkingOptions): Promise<void> {
    const run = this.queue.then(async () => {
      const db = getDb();
      for (const docId of docIds) {
        const content = await db.contents.get(docId);
        const doc = await db.documents.get(docId);
        if (!content || !doc) continue;
        try {
          await this.store(
            { docId, chunking, source: { kind: "text", title: content.title, text: "" }, docTypeHint: doc.docType },
            { title: content.title, blocks: content.blocks, pageCount: content.pageCount, format: doc.format, warnings: doc.warnings },
          );
        } catch (error) {
          await db.documents.update(docId, { status: "error", error: friendlyError(error) });
        }
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ------------------------------------------------------------------ search

  private async getIndex(): Promise<SearchIndex> {
    const db = getDb();
    const version = await getKbVersion(db);
    const key = `${version}|${this.config.embeddingModelId}`;
    if (this.index && this.indexKey === key) return this.index;

    const model = getEmbeddingModel(this.config.embeddingModelId);
    const docs = (await db.documents.where("status").equals("ready").toArray()).filter((d) => d.embeddingModel === model.id);
    const ids = docs.map((d) => d.id);
    const chunks = ids.length ? await db.chunks.where("docId").anyOf(ids).toArray() : [];
    const indexed: IndexedDocument[] = docs.map(({ id, name, docType, format }) => ({ id, name, docType, format }));
    this.index = new SearchIndex(
      chunks.filter((c) => c.vector.length === model.dims),
      indexed,
    );
    this.indexKey = key;
    return this.index;
  }

  private async deps(index: SearchIndex, options: RetrievalOptions): Promise<RetrieverDeps> {
    const model = getEmbeddingModel(this.config.embeddingModelId);
    const embedder = options.mode !== "keyword" ? await this.getEmbedder() : null;
    const reranker = options.rerank ? await this.getReranker() : undefined;
    return {
      index,
      embedQuery: (q) => embedder!.embedQuery(q),
      queryPrefix: model.queryPrefix,
      reranker,
      embeddingModelId: model.id,
      embeddingCalibration: model.calibration,
      rerankCalibration: reranker?.model.calibration,
    };
  }

  async search(query: string, options: RetrievalOptions): Promise<RetrievalResult> {
    const index = await this.getIndex();
    return retrieve(query, options, await this.deps(index, options));
  }

  /** Runs several searches in one call (multi-query retrieval for JD matching, deep dives…). */
  async searchMany(queries: string[], options: RetrievalOptions): Promise<RetrievalResult[]> {
    const index = await this.getIndex();
    const deps = await this.deps(index, options);
    const out: RetrievalResult[] = [];
    for (const q of queries) out.push(await retrieve(q, options, deps));
    return out;
  }

  async listChunks(filter?: {
    docIds?: string[];
    docTypes?: DocType[];
  }): Promise<(Chunk & { docName: string; docType: DocType; docFormat: SupportedFormat })[]> {
    const index = await this.getIndex();
    const allow = index.filter(filter);
    return index.entries
      .filter((_, i) => !allow || allow(i))
      .map((e) => ({ ...e.chunk, docName: e.document.name, docType: e.document.docType, docFormat: e.document.format }));
  }

  async embed(texts: string[], kind: "query" | "document"): Promise<Float32Array[]> {
    const embedder = await this.getEmbedder();
    const vectors = kind === "query" ? await Promise.all(texts.map((t) => embedder.embedQuery(t))) : await embedder.embedDocuments(texts);
    return Comlink.transfer(
      vectors,
      vectors.map((v) => v.buffer as ArrayBuffer),
    );
  }

  /**
   * Citation verification: for every answer sentence, how similar is it to the chunks it
   * cites (or, if it cites nothing, to any chunk in the context)?
   */
  private sentenceCache = new Map<string, Float32Array[]>();

  async supportScores(sentences: string[], chunkIdsPerSentence: string[][]): Promise<{ best: number; chunkId?: string }[]> {
    if (!sentences.length) return [];
    const index = await this.getIndex();
    const embedder = await this.getEmbedder();

    // Compare each answer sentence with every *sentence* of the cited passages (and the
    // passage as a whole), so a long passage does not dilute a precise match.
    const key = (id: string) => `${this.indexKey}|${id}`;
    const parts: { id: string; text: string }[] = [];
    for (const id of new Set(chunkIdsPerSentence.flat())) {
      if (this.sentenceCache.has(key(id))) continue;
      const i = index.indexOf(id);
      if (i === undefined) continue;
      this.sentenceCache.set(key(id), []);
      for (const s of splitSentences(index.entries[i].chunk.text.replace(/^- /gm, ""))) if (s.length > 12) parts.push({ id, text: s });
    }
    if (parts.length) {
      const vectors = await embedder.embedDocuments(parts.map((p) => p.text));
      parts.forEach((p, j) => this.sentenceCache.get(key(p.id))!.push(vectors[j]));
    }

    const answerVectors = await embedder.embedDocuments(sentences);
    return answerVectors.map((v, i) => {
      let best = 0;
      let bestId: string | undefined;
      for (const id of chunkIdsPerSentence[i]) {
        const whole = index.vectorOf(id);
        for (const cv of [...(whole ? [whole] : []), ...(this.sentenceCache.get(key(id)) ?? [])]) {
          const s = dot(v, cv);
          if (s > best) {
            best = s;
            bestId = id;
          }
        }
      }
      return { best, chunkId: bestId };
    });
  }

  async similarity(a: string, b: string): Promise<number> {
    const embedder = await this.getEmbedder();
    const [va, vb] = await embedder.embedDocuments([a, b]);
    return cosineSimilarity(va, vb);
  }

  async rerankTexts(query: string, passages: string[]): Promise<number[]> {
    return (await this.getReranker()).score(query, passages);
  }

  /** Pairs of chunks from *different* documents that talk about the same thing (for the consistency checker). */
  async similarChunkPairs(minSimilarity: number, docTypes?: DocType[]): Promise<SimilarPair[]> {
    const index = await this.getIndex();
    const allow = index.filter(docTypes?.length ? { docTypes } : undefined);
    const ids = index.entries.map((_, i) => i).filter((i) => !allow || allow(i));
    const pairs: SimilarPair[] = [];
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const a = index.entries[ids[x]];
        const b = index.entries[ids[y]];
        if (a.document.id === b.document.id) continue;
        const s = dot(index.vectorOf(a.chunk.id)!, index.vectorOf(b.chunk.id)!);
        if (s >= minSimilarity) pairs.push({ a: a.chunk.id, b: b.chunk.id, similarity: s });
      }
    }
    return pairs.sort((p, q) => q.similarity - p.similarity).slice(0, 200);
  }

  // -------------------------------------------------------------- playground

  /** Searches an experimental index built with custom chunking, without touching the real one. */
  async playgroundSearch(query: string, chunking: ChunkingOptions, options: RetrievalOptions): Promise<PlaygroundResult> {
    const db = getDb();
    const version = await getKbVersion(db);
    const key = `${version}|${this.config.embeddingModelId}|${chunking.chunkSize}|${chunking.chunkOverlap}|${chunking.minChunkSize}`;
    if (!this.playground || this.playground.key !== key) {
      const started = performance.now();
      const docs = await db.documents.where("status").equals("ready").toArray();
      const embedder = await this.getEmbedder();
      const stored: StoredChunk[] = [];
      for (const doc of docs) {
        const content = await db.contents.get(doc.id);
        if (!content) continue;
        const parsed: ParsedDocument = { title: content.title, blocks: content.blocks, format: doc.format, warnings: [] };
        stored.push(...(await embedChunks(chunkDocument(doc.id, doc.name, parsed, chunking), embedder)));
      }
      const indexed = docs.map(({ id, name, docType, format }) => ({ id, name, docType, format }));
      this.playground = { key, index: new SearchIndex(stored, indexed), buildMs: performance.now() - started };
    }
    const { index, buildMs } = this.playground;
    const retrieval = await retrieve(query, options, await this.deps(index, options));
    const tokens = index.entries.reduce((n, e) => n + e.chunk.tokenCount, 0);
    return { retrieval, chunkCount: index.size, avgChunkTokens: index.size ? tokens / index.size : 0, buildMs };
  }

  // -------------------------------------------------------------- evaluation

  /** Builds an index over the bundled demo documents (independent of the user's data) and evaluates it. */
  async evaluate(chunking: ChunkingOptions = DEFAULT_CHUNKING, k = 5, onProgress?: EvalProgress): Promise<EvalRunResult[]> {
    const key = `${this.config.embeddingModelId}|${chunking.chunkSize}|${chunking.chunkOverlap}|${chunking.minChunkSize}`;
    if (!this.evalIndex || this.evalIndex.key !== key) {
      const embedder = await this.getEmbedder();
      const stored: StoredChunk[] = [];
      const docs: IndexedDocument[] = [];
      for (const [i, demo] of DEMO_DOCUMENTS.entries()) {
        onProgress?.(i, DEMO_DOCUMENTS.length, `Indexing ${demo.file}`);
        const bytes = new Uint8Array(await (await fetch(`/demo/${demo.file}`)).arrayBuffer());
        const parsed = await parseSource({ kind: "file", fileName: demo.file, bytes });
        const id = `eval-${i}`;
        docs.push({ id, name: demo.file, docType: demo.docType, format: parsed.format });
        stored.push(...(await embedChunks(chunkDocument(id, demo.file, parsed, chunking), embedder)));
      }
      this.evalIndex = { key, index: new SearchIndex(stored, docs) };
    }
    await this.getReranker();
    const deps = await this.deps(this.evalIndex.index, { ...EVAL_CONFIGS[3].options });
    return runEvaluation(EVAL_QUESTIONS, EVAL_CONFIGS, deps, k, onProgress);
  }
}

export type { RagEngine };

Comlink.expose(new RagEngine());
