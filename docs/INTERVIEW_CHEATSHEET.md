# 5-minute cheat sheet

## One-liner

**ResumeRAG:** local-first RAG for interview prep — parses, chunks, embeds and searches your documents _in the browser_, answers with a local LLM _only_ from retrieved passages, with citations, refusals and verification, plus interview workflows. Free, open source, deploys on Vercel.

## Architecture (say it in one breath)

Next.js app → **RAG Web Worker** runs Transformers.js (bge-small embeddings, MiniLM cross-encoder) → **IndexedDB** stores chunks + vectors → **hybrid search** (cosine + BM25) → **RRF** → **rerank** → **confidence gate** → numbered context → generation by the strongest model reachable (**/api/llm/chat** → Ollama or a hosted provider, else **LFM2 1.2B in a second Web Worker**) → citations verified.

## Core flow

Ingest: validate → parse (blocks + pages) → classify → chunk (220 / 40, heading path) → embed (title > headings + text) → store.
Query: rewrite follow-up → embed → dense top-20 + BM25 top-20 (interview-aware expansion) → RRF (k = 60) → cross-encoder → top-5 → refuse if no evidence → prompt → stream → verify.

## Technology choices (why in 5 words)

| Choice                           | Why                                                     |
| -------------------------------- | ------------------------------------------------------- |
| Browser RAG (Transformers.js)    | Vercel limits, privacy, zero cost                       |
| bge-small-en-v1.5 (384-d, 34 MB) | Best quality per megabyte                               |
| IndexedDB + exact search         | Personal scale; perfect recall                          |
| BM25 + semantic, RRF             | Exact terms + meaning; rank-based                       |
| ms-marco MiniLM cross-encoder    | +0.09 MRR, answerability signal                         |
| Ollama, qwen2.5:7b               | Free, local, JSON-schema output                         |
| LFM2 1.2B in the browser         | Keyless generation on the live site; benchmarked winner |
| zod + JSON Schema                | Model output = untrusted input                          |
| Next.js + TypeScript             | One language, runs in browser                           |

## Numbers to remember

- 6 demo docs → **42 chunks**; chunk **220** tokens, overlap **40**; top-**5** of **20** candidates.
- Eval (30 Qs, 4 unanswerable): semantic **78.8%** recall / MRR **0.71** → hybrid **88.5%** / **0.80** → + rerank **100%** / **0.894**, nDCG **0.92**, answer/refuse **96.7%**, all unanswerable refused.
- Retrieval ~**1.3 s** in the browser (rerank dominates; **0.37 s** in Node). Was ~4.5 s until COOP/COEP headers enabled multi-threaded WASM. Generation ~**6 tok/s** on a CPU (qwen 7B).
- Citation verification: **14/15** labelled pairs judged correctly.
- **125** unit tests; Playwright E2E; `npm run eval`.

## Terminology (one line each)

- **RAG:** retrieve relevant passages, then generate from them — an open-book exam.
- **Chunk:** a ~220-token passage; the unit of retrieval and citation.
- **Embedding:** 384 numbers = coordinates of meaning.
- **Cosine similarity:** how much two vectors point the same way (dot product when normalised).
- **BM25:** keyword ranking with TF, IDF and length normalisation.
- **Hybrid search:** semantic + keyword retrieval, merged.
- **RRF:** Σ 1/(60 + rank) — merges rankings, ignores incomparable scores.
- **Bi- vs cross-encoder:** separate encodings (fast) vs question + passage together (accurate).
- **Reranking:** cross-encoder re-scores the shortlist; keep top-5.
- **Metadata filtering:** exclude JD/company docs from candidate evidence.
- **Query expansion:** add concrete words for abstract interview themes (leadership → led, managed).
- **Confidence gate:** no relevant evidence → refuse without calling the LLM.
- **Citation verification:** sentence vs cited passage similarity + word overlap + number check.
- **Prompt injection:** document text trying to override instructions; detect, isolate, declare untrusted.
- **MRR:** 1 / rank of the first relevant result, averaged.

## 5 strongest features

1. **Pipeline trace** — every answer shows query → embedding → search → BM25 → RRF → rerank (rank changes) → context → generation → citation check.
2. **Grounded or silent** — confidence gate + citations + per-sentence verification.
3. **JD match that can't lie** — employer docs excluded; skills judged by surrounding words ("I have not used MLflow" = gap).
4. **Resume X-ray** — deterministic weakness rules + cross-document conflicts + grill-mode questions.
5. **Measured** — evaluation of every stage, chunk-size sweep, generation check, failures listed honestly.

## 5 limitations (and fixes)

1. Scanned PDFs → OCR (tesseract.js).
2. Small local LLMs slow/miss nuance → GPU server or hosted open model via the provider interface.
3. Per-browser storage, no sync → encrypted export, optional pgvector + auth.
4. Similarity ≠ entailment in verification → NLI model.
5. Small, self-written eval set → larger independent set in CI.

## 5 future improvements

LLM query expansion · NLI verification · OCR · offline self-hosted models · WebLLM fully-in-browser generation.

## Quick answers

- **Why RAG not fine-tuning?** Facts change, few docs, citations, no GPU.
- **Why not whole doc in context?** Slow locally, worse attention, no precise citations.
- **Retrieval fails?** Low reranker score → refusal; evaluation exposes misses.
- **Contradictions?** Prompt says flag them; consistency checker finds numeric conflicts.
- **Scale to 1M docs?** Queue + GPU embedding, HNSW vector store, sharding, search engine for BM25, rerank top-50.
- **Model change?** Re-index; vectors from different models aren't comparable.
- **Tables?** Rows flattened; production: layout-aware parsing.
- **Hardest bug?** CSP blocked ONNX Runtime's `blob:` import; fresh-profile browser test caught it.
