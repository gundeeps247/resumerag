/**
 * Calibrates citation verification: for hand-labelled (sentence, source) pairs from the
 * demo documents, prints the sentence-level cosine similarity and lexical support, and
 * what judgeSupport decides.  Usage: npx tsx scripts/dev/debug-verify.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@huggingface/transformers";
import { DEMO_DOCUMENTS } from "../../src/lib/demo";
import { DEFAULT_CHUNKING } from "../../src/lib/rag/config";
import { splitSentences } from "../../src/lib/rag/chunking/sentences";
import { TransformersEmbedder } from "../../src/lib/rag/embeddings/embedder";
import { getEmbeddingModel } from "../../src/lib/rag/embeddings/models";
import { dot } from "../../src/lib/rag/embeddings/vector-math";
import { judgeSupport, lexicalSupport } from "../../src/lib/rag/generation/citations";
import { chunkDocument, parseSource } from "../../src/lib/rag/ingestion/pipeline";

env.cacheDir = path.join(process.cwd(), ".cache", "transformers");

const PAIRS: { supported: boolean; sentence: string; find: string }[] = [
  { supported: true, sentence: "You achieved an AUC of 0.89 on the time-based holdout set.", find: "ROC-AUC of 0.89 on a time-based" },
  { supported: true, sentence: "You handled class imbalance with XGBoost's scale_pos_weight parameter.", find: "scale_pos_weight" },
  { supported: true, sentence: "You dropped SMOTE because it hurt probability calibration.", find: "SMOTE" },
  {
    supported: true,
    sentence: "The model runs weekly as a batch-scoring job orchestrated with Airflow.",
    find: "weekly batch-scoring job",
  },
  { supported: true, sentence: "You led a team of four students to build a campus marketplace.", find: "Led a team of 4" },
  { supported: true, sentence: "The final XGBoost model beat a logistic regression baseline.", find: "ROC-AUC of 0.89" },
  { supported: true, sentence: "You explained individual predictions to the retention team with SHAP values.", find: "SHAP values" },
  {
    supported: true,
    sentence: "BM25 was added because dense search struggled with exact citation queries.",
    find: "exact citation queries",
  },
  { supported: false, sentence: "You deployed the model in real time on Kubernetes.", find: "weekly batch-scoring job" },
  { supported: false, sentence: "You reduced churn by 30% using a deep neural network.", find: "ROC-AUC of 0.89" },
  { supported: false, sentence: "The model was trained on 2 million customers.", find: "120,000 customers over 14 months" },
  { supported: false, sentence: "You achieved an AUC of 0.91 on the holdout set.", find: "ROC-AUC of 0.89 on a time-based" },
  { supported: false, sentence: "You presented the results at a major machine learning conference.", find: "retention team could contact" },
  { supported: false, sentence: "You used A/B testing to choose between three retention offers.", find: "pilot retention campaign" },
  { supported: false, sentence: "You built the Airflow infrastructure yourself.", find: "data engineering team owned the Airflow" },
];

async function main() {
  const chunks = [];
  for (const [i, demo] of DEMO_DOCUMENTS.entries()) {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "demo", demo.file)));
    const parsed = await parseSource({ kind: "file", fileName: demo.file, bytes });
    chunks.push(...chunkDocument(`d${i}`, demo.file, parsed, DEFAULT_CHUNKING));
  }
  const embedder = await TransformersEmbedder.create(getEmbeddingModel(""), { device: "cpu" });
  let correct = 0;
  for (const pair of PAIRS) {
    const chunk = chunks.find((c) => c.text.includes(pair.find));
    if (!chunk) throw new Error(`No chunk contains "${pair.find}"`);
    const parts = splitSentences(chunk.text.replace(/^- /gm, "")).filter((s) => s.length > 12);
    const [answer, whole, ...sentenceVectors] = await embedder.embedDocuments([pair.sentence, chunk.embedText, ...parts]);
    const similarity = Math.max(dot(answer, whole), ...sentenceVectors.map((v) => dot(answer, v)));
    const lexical = lexicalSupport(pair.sentence, [chunk.text]);
    const verdict = judgeSupport(similarity, lexical);
    if (verdict === pair.supported) correct++;
    console.log(
      `${pair.supported ? "SUP" : "UNS"} → ${verdict ? "supported  " : "unverified "} sim=${similarity.toFixed(3)} overlap=${lexical.overlap.toFixed(2)} missing=[${lexical.missingNumbers}]  ${pair.sentence}`,
    );
  }
  console.log(`\n${correct}/${PAIRS.length} judged as labelled`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
