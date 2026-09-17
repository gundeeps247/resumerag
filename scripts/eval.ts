/**
 * Offline evaluation of the retrieval pipeline over the demo workspace.
 *
 *   npm run eval                     # compare BM25 / semantic / hybrid / hybrid+rerank
 *   npm run eval -- --grid           # also sweep chunk sizes
 *   npm run eval -- --inspect        # print how each demo document was parsed and chunked
 *   npm run eval -- --model=Xenova/all-MiniLM-L6-v2
 *
 * Uses exactly the same parsing, chunking, embedding and retrieval code as the app,
 * running the open-source models locally in Node. Results are written to
 * public/eval/reference-results.json and shown on the app's Evaluation page.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@huggingface/transformers";
import { DEFAULT_CHUNKING } from "../src/lib/rag/config";
import { DEMO_DOCUMENTS } from "../src/lib/demo";
import { TransformersEmbedder } from "../src/lib/rag/embeddings/embedder";
import { DEFAULT_EMBEDDING_MODEL_ID, getEmbeddingModel, getRerankerModel } from "../src/lib/rag/embeddings/models";
import { EVAL_QUESTIONS } from "../src/lib/rag/evaluation/dataset";
import { EVAL_CONFIGS, runEvaluation, type EvalRunResult } from "../src/lib/rag/evaluation/runner";
import { chunkDocument, embedChunks, parseSource } from "../src/lib/rag/ingestion/pipeline";
import { CrossEncoderReranker } from "../src/lib/rag/reranking/reranker";
import { SearchIndex, type IndexedDocument } from "../src/lib/rag/retrieval/search-index";
import type { ChunkingOptions, ParsedDocument, StoredChunk } from "../src/lib/rag/types";

env.cacheDir = path.join(process.cwd(), ".cache", "transformers");

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [key, value] = a.replace(/^--/, "").split("=");
    return [key, value ?? "true"] as const;
  }),
);

async function loadDemoDocs(): Promise<{ doc: IndexedDocument; parsed: ParsedDocument }[]> {
  const out = [];
  for (const [i, demo] of DEMO_DOCUMENTS.entries()) {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "demo", demo.file)));
    const parsed = await parseSource({ kind: "file", fileName: demo.file, bytes });
    const format = parsed.format;
    out.push({ doc: { id: `demo${i}`, name: demo.file, docType: demo.docType, format }, parsed });
  }
  return out;
}

async function buildIndex(
  docs: { doc: IndexedDocument; parsed: ParsedDocument }[],
  chunking: ChunkingOptions,
  embedder: TransformersEmbedder,
): Promise<SearchIndex> {
  const chunks: StoredChunk[] = [];
  for (const { doc, parsed } of docs) {
    const drafts = chunkDocument(doc.id, doc.name, parsed, chunking);
    chunks.push(...(await embedChunks(drafts, embedder)));
  }
  return new SearchIndex(
    chunks,
    docs.map((d) => d.doc),
  );
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function printTable(runs: EvalRunResult[]) {
  console.log(
    `\n| Configuration | Hit@${runs[0].k} | Recall@${runs[0].k} | Precision@${runs[0].k} | MRR | nDCG | Abstention acc. | Mean latency |`,
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of runs) {
    console.log(
      `| ${r.config.label} | ${pct(r.metrics.hitRate)} | ${pct(r.metrics.recall)} | ${pct(r.metrics.precision)} | ${r.metrics.mrr.toFixed(3)} | ${r.metrics.ndcg.toFixed(3)} | ${pct(r.abstention.accuracy)} | ${r.latency.meanMs.toFixed(0)} ms |`,
    );
  }
}

async function main() {
  const modelId = args.get("model") ?? DEFAULT_EMBEDDING_MODEL_ID;
  const model = getEmbeddingModel(modelId);
  const docs = await loadDemoDocs();

  if (args.has("inspect")) {
    for (const { doc, parsed } of docs) {
      console.log(`\n=== ${doc.name} (${parsed.format}, ${parsed.blocks.length} blocks, pages: ${parsed.pageCount ?? "-"})`);
      if (parsed.warnings.length) console.log("warnings:", parsed.warnings);
      if (args.has("blocks"))
        for (const b of parsed.blocks) console.log(`  [${b.kind}${b.level ?? ""}${b.page ? ` p${b.page}` : ""}] ${b.text}`);
      for (const c of chunkDocument(doc.id, doc.name, parsed, DEFAULT_CHUNKING)) {
        console.log(
          `--- chunk ${c.index} | ${c.tokenCount} tok | ${c.headingPath.join(" > ") || "(no heading)"} | p${c.pageStart ?? "-"}${c.suspicious ? " | SUSPICIOUS" : ""}`,
        );
        console.log(c.text);
      }
    }
    return;
  }

  console.log(`Loading ${model.id} and ${getRerankerModel("").id} (first run downloads the models)...`);
  const t0 = Date.now();
  const embedder = await TransformersEmbedder.create(model, { device: "cpu" });
  const reranker = await CrossEncoderReranker.create(getRerankerModel(""), { device: "cpu" });
  console.log(`Models ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const t1 = Date.now();
  const index = await buildIndex(docs, DEFAULT_CHUNKING, embedder);
  console.log(`Indexed ${docs.length} documents into ${index.size} chunks in ${((Date.now() - t1) / 1000).toFixed(1)} s`);

  const deps = {
    index,
    embedQuery: (q: string) => embedder.embedQuery(q),
    queryPrefix: model.queryPrefix,
    reranker,
    embeddingModelId: model.id,
    embeddingCalibration: model.calibration,
    rerankCalibration: reranker.model.calibration,
  };

  const k = Number(args.get("k") ?? 5);
  const runs = await runEvaluation(EVAL_QUESTIONS, EVAL_CONFIGS, deps, k);
  printTable(runs);

  if (args.has("scores")) {
    console.log("\nTop scores per question (for confidence calibration):");
    for (const run of runs.filter((r) => r.config.id !== "keyword")) {
      console.log(`\n${run.config.label}`);
      for (const q of run.questions) {
        console.log(
          `  ${q.answerable ? "A" : "U"} ${q.topScore.toFixed(3)} ${q.confidence.padEnd(6)} rank1=${q.metrics?.firstRelevantRank ?? "-"}  ${q.question}`,
        );
      }
    }
  }

  const grid: { chunkSize: number; overlap: number; runs: EvalRunResult[] }[] = [];
  if (args.has("grid")) {
    for (const chunkSize of [120, 220, 350, 500]) {
      const chunking = { ...DEFAULT_CHUNKING, chunkSize, chunkOverlap: Math.round(chunkSize * 0.18) };
      const gridIndex = await buildIndex(docs, chunking, embedder);
      const gridRuns = await runEvaluation(
        EVAL_QUESTIONS,
        EVAL_CONFIGS.filter((c) => c.id.startsWith("hybrid")),
        { ...deps, index: gridIndex },
        k,
      );
      grid.push({ chunkSize, overlap: chunking.chunkOverlap, runs: gridRuns });
      console.log(`\nChunk size ${chunkSize} (overlap ${chunking.chunkOverlap}) -> ${gridIndex.size} chunks`);
      printTable(gridRuns);
    }
  }

  if (args.has("no-save")) return;
  const outDir = path.join(process.cwd(), "public", "eval");
  await mkdir(outDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    embeddingModel: model.id,
    rerankerModel: reranker.model.id,
    chunking: DEFAULT_CHUNKING,
    documents: docs.length,
    chunks: index.size,
    questions: EVAL_QUESTIONS.length,
    k,
    runs,
    // The sweep only needs aggregate metrics, not per-question rows.
    grid: grid.map((g) => ({
      chunkSize: g.chunkSize,
      overlap: g.overlap,
      runs: g.runs.map((r) => ({ config: r.config, k: r.k, metrics: r.metrics, abstention: r.abstention, latency: r.latency })),
    })),
  };
  await writeFile(path.join(outDir, "reference-results.json"), JSON.stringify(report, null, 2));
  console.log(`\nSaved public/eval/reference-results.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
