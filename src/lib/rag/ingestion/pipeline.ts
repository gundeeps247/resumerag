/**
 * Ingestion pipeline (framework-free): file → parse → classify → chunk → embed.
 *
 * The Web Worker calls these functions and persists the result to IndexedDB; the
 * evaluation script calls the very same functions in Node. Keeping the pipeline pure
 * makes it easy to test and to explain.
 */
import { buildEmbedText, chunkBlocks } from "../chunking/chunker";
import { classifyDocument, type ClassificationResult } from "../classify";
import type { Embedder } from "../embeddings/embedder";
import { scanForInjection } from "../guardrails/injection";
import { parseFile, parsePastedText } from "../parsing";
import type { Chunk, ChunkingOptions, ParsedDocument, StoredChunk } from "../types";

export interface PreparedDocument {
  parsed: ParsedDocument;
  classification: ClassificationResult;
  chunks: Chunk[];
}

export type IngestSource = { kind: "file"; fileName: string; bytes: Uint8Array } | { kind: "text"; title: string; text: string };

export async function parseSource(source: IngestSource): Promise<ParsedDocument> {
  return source.kind === "file" ? parseFile(source.fileName, source.bytes) : parsePastedText(source.text, source.title);
}

/** Splits a parsed document into chunks with stable ids and contextual embedding text. */
export function chunkDocument(docId: string, docName: string, parsed: ParsedDocument, options: ChunkingOptions): Chunk[] {
  const title = parsed.title || docName;
  return chunkBlocks(parsed.blocks, options).map((draft) => {
    const scan = scanForInjection(draft.text);
    return {
      ...draft,
      id: `${docId}:${draft.index}`,
      docId,
      embedText: buildEmbedText(title, draft.headingPath, draft.text),
      suspicious: scan.suspicious || undefined,
    };
  });
}

export async function prepareDocument(docId: string, source: IngestSource, options: ChunkingOptions): Promise<PreparedDocument> {
  const parsed = await parseSource(source);
  const name = source.kind === "file" ? source.fileName : source.title;
  const classification = classifyDocument(name, parsed.blocks);
  return { parsed, classification, chunks: chunkDocument(docId, name, parsed, options) };
}

export async function embedChunks(
  chunks: Chunk[],
  embedder: Embedder,
  onProgress?: (done: number, total: number) => void,
): Promise<StoredChunk[]> {
  const vectors = await embedder.embedDocuments(
    chunks.map((c) => c.embedText),
    onProgress,
  );
  return chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i] }));
}
