/**
 * Runs JD matching on the demo workspace in Node and prints every requirement's status,
 * reason and evidence — useful for tuning the deterministic scoring rules.
 * Usage: npx tsx scripts/dev/debug-jd.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@huggingface/transformers";
import { DEMO_DOCUMENTS } from "../../src/lib/demo";
import { extractRequirements } from "../../src/lib/rag/analysis/jd";
import { scoreRequirement } from "../../src/lib/rag/analysis/jd-scoring";
import { hasSkill } from "../../src/lib/rag/analysis/skills";
import { DEFAULT_CHUNKING, DEFAULT_RETRIEVAL } from "../../src/lib/rag/config";
import { TransformersEmbedder } from "../../src/lib/rag/embeddings/embedder";
import { getEmbeddingModel, getRerankerModel } from "../../src/lib/rag/embeddings/models";
import { chunkDocument, embedChunks, parseSource } from "../../src/lib/rag/ingestion/pipeline";
import { CrossEncoderReranker } from "../../src/lib/rag/reranking/reranker";
import { retrieve } from "../../src/lib/rag/retrieval/retriever";
import { SearchIndex, type IndexedDocument } from "../../src/lib/rag/retrieval/search-index";
import { EMPLOYER_DOC_TYPES, type ParsedDocument, type RetrievedChunk, type StoredChunk } from "../../src/lib/rag/types";

env.cacheDir = path.join(process.cwd(), ".cache", "transformers");

async function main() {
  const model = getEmbeddingModel("");
  const embedder = await TransformersEmbedder.create(model, { device: "cpu" });
  const reranker = await CrossEncoderReranker.create(getRerankerModel(""), { device: "cpu" });
  const docs: IndexedDocument[] = [];
  const stored: StoredChunk[] = [];
  let jd: ParsedDocument | undefined;
  for (const [i, demo] of DEMO_DOCUMENTS.entries()) {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "demo", demo.file)));
    const parsed = await parseSource({ kind: "file", fileName: demo.file, bytes });
    if (demo.docType === "job_description") jd = parsed;
    docs.push({ id: `d${i}`, name: demo.file, docType: demo.docType, format: parsed.format });
    stored.push(...(await embedChunks(chunkDocument(`d${i}`, demo.file, parsed, DEFAULT_CHUNKING), embedder)));
  }
  const index = new SearchIndex(stored, docs);
  const deps = {
    index,
    embedQuery: (q: string) => embedder.embedQuery(q),
    queryPrefix: model.queryPrefix,
    reranker,
    embeddingModelId: model.id,
    embeddingCalibration: model.calibration,
    rerankCalibration: reranker.model.calibration,
  };
  const candidate = index.entries.filter((e) => !EMPLOYER_DOC_TYPES.includes(e.document.docType));
  const requirements = extractRequirements(jd!.blocks);
  const weights = { required: 1, responsibility: 0.75, preferred: 0.5 };
  let weighted = 0;
  let total = 0;
  for (const r of requirements) {
    const result = await retrieve(r.text, { ...DEFAULT_RETRIEVAL, topK: 3, filter: { excludeDocTypes: EMPLOYER_DOC_TYPES } }, deps);
    const lookup: RetrievedChunk[] = candidate
      .filter((e) => r.skills.some((s) => hasSkill(e.chunk.embedText, s)))
      .slice(0, 4)
      .map((e) => ({
        chunk: e.chunk,
        document: e.document,
        score: 0,
        candidate: { chunkId: e.chunk.id, docId: e.chunk.docId, fusedScore: 0, fusedRank: 0, selected: false },
      }));
    const m = scoreRequirement(r, result.results, lookup);
    total += weights[r.importance];
    weighted += weights[r.importance] * (m.status === "strong" ? 1 : m.status === "partial" ? 0.5 : 0);
    console.log(
      `\n[${m.status.toUpperCase().padEnd(7)}] (${r.importance}) ${r.text}\n   skills=${r.skills.join(", ") || "-"} · best=${m.score.toFixed(3)} · ${m.reason}`,
    );
    for (const e of m.evidence) console.log(`   · ${e.document.name}: ${e.chunk.text.replace(/\s+/g, " ").slice(0, 110)}`);
  }
  console.log(`\nWeighted coverage: ${Math.round((weighted / total) * 100)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
