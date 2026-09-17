# Limitations and roadmap

An honest list of what ResumeRAG does not do well, why, and how a production team would solve it. Being able to talk about these is as valuable in an interview as the features.

---

## Limitations

### 1. Scanned or image-only PDFs

- **Current behaviour:** pdf.js can only read a PDF's text layer. For scanned resumes the parser finds almost no text; the document gets a warning ("This PDF may be scanned or image-based; OCR is not supported").
- **Why:** OCR in the browser (tesseract.js) is a 10–20 MB download and slow (seconds per page), and adds a second error source.
- **Production fix:** run OCR (tesseract.js, PaddleOCR, or a document-AI service) when a page has little text; keep OCR confidence as metadata so low-confidence text can be flagged in citations.

### 2. Complex layouts: tables, multi-column PDFs, images

- **Current behaviour:** tables become one line per row ("Model | ROC-AUC | PR-AUC"); two-column resumes may interleave columns because lines are grouped by vertical position; images and charts are ignored.
- **Why:** PDFs have no notion of tables or columns — only positioned glyphs. Layout reconstruction is a research problem.
- **Production fix:** layout-aware parsers (e.g. Docling, Unstructured, layout models like LayoutLMv3), table-specific chunking (keep a table with its caption; convert rows to "column: value" sentences), and multimodal models for figures.

### 3. Local LLM quality and speed

- **Current behaviour:** on a CPU-only laptop, `qwen2.5:7b-instruct` generates ~6 tokens/s (a paragraph takes 30–60 s); 3B models are faster but follow instructions less reliably. Small models occasionally miss nuance — for example, citing both "AUC 0.91" (resume) and "AUC 0.89" (report) without pointing out that they disagree, even though the prompt asks for it.
- **Why:** quality scales with parameters; the project deliberately avoids paid APIs.
- **Mitigations in the app:** streaming, compact prompts, deterministic-first workflows, a stall timeout so a hung model fails with a clear message (and workflows fall back to their deterministic results) instead of spinning forever, the Consistency Checker for contradictions, citation verification, and the option to use any OpenAI-compatible endpoint (a larger self-hosted or hosted model).
- **Production fix:** a GPU inference server (vLLM/TGI) with a 14–70B open-weight model, or a commercial API behind the same provider interface.

### 4. Vercel compute limits

- **Current behaviour:** the deployed site cannot run an LLM itself. It works in evidence-only mode, in private mode (the visitor's local Ollama), or with a hosted provider.
- **Why:** serverless functions have no GPU, limited memory and execution-time limits.
- **Production fix:** dedicated inference infrastructure; the app would only change `LLM_PROVIDER`.

### 5. Data lives in one browser

- **Current behaviour:** documents, vectors and history are in IndexedDB. Another browser or device starts empty; clearing site data deletes everything; there is no backup.
- **Why:** a deliberate privacy choice — no server stores personal documents.
- **Production fix:** optional accounts with end-to-end-encrypted sync, or a server mode (Postgres + pgvector, per-user row-level security). The `SearchIndex` API is designed to be re-implemented on pgvector (see DESIGN_DECISIONS §5). An export/import of the knowledge base would be a small first step.

### 6. Scale

- **Current behaviour:** exact search over every vector. Instant for thousands of chunks; memory and latency grow linearly. Ingestion embeds on the user's CPU (hundreds of pages take minutes).
- **Why:** exact search gives perfect recall and needs no index maintenance at personal scale.
- **How it would scale to a million documents:** move ingestion to a background job queue with GPU embedding; store vectors in pgvector/Qdrant/Milvus with an HNSW index; shard by user/tenant; keep BM25 in a search engine (OpenSearch) or Postgres FTS; cache query embeddings; rerank only the top 50; add metadata filters in the index to prune early.

### 7. Retrieval failures

- **Current behaviour:** the evaluation originally exposed three wrongly refused abstract/behavioural questions. Deterministic interview-aware query expansion fixed two of them. _"What leadership experience do I have?"_ now retrieves _"Led a team of 4…"_ (rank 2) but still gets a near-zero reranker score, so it is refused. The expansion vocabulary is hand-written, so unusual phrasings are not covered.
- **Why:** a small embedding model connects "leadership" and "led a team" weakly; the MS MARCO cross-encoder was trained on web search queries, not interview prompts.
- **Production fix:** LLM-generated query expansion or a learned query rewriter; a stronger or domain-tuned embedding model; fine-tuning the reranker on interview-style pairs; calibration per question type.

### 8. Confidence calibration

- **Current behaviour:** thresholds (reranker 0.5 / 0.1 / 0.01, cosine rescue 0.66) were chosen from 30 questions.
- **Why:** there is no large labelled dataset of interview questions over personal documents.
- **Production fix:** collect user feedback ("this answer was wrong / should have answered"), recalibrate on hundreds of examples, possibly train a small answerability classifier on retrieval features.

### 9. Prompt injection

- **Current behaviour:** instruction-like text in documents is detected by regex heuristics and flagged; sources are isolated in tags and declared untrusted.
- **Why it is not solved:** there is no reliable way to make an LLM ignore instructions embedded in its input; paraphrased or obfuscated injections bypass pattern matching.
- **Production fix:** a trained injection classifier on retrieved chunks, stricter output schemas, separating "reading" and "acting" models, and never letting model output trigger side effects without confirmation. ResumeRAG has no tools or side effects, which limits the blast radius to misleading text — and the evidence panel lets a human verify.

### 10. Conflicting documents

- **Current behaviour:** the Consistency Checker finds numeric disagreements and the X-ray flags affected claims; Ask may still cite one side (see §3).
- **Why:** contradictions in prose (not numbers) are hard to detect deterministically.
- **Production fix:** NLI-based contradiction detection between high-similarity chunk pairs; document dates/versions as metadata so newer sources win.

### 11. Citation verification is a proxy

- **Current behaviour:** a sentence counts as "verified" when it is similar to a sentence of its cited passage (or moderately similar and shares most key words) and every number it states appears in the source. On 15 hand-labelled pairs it judged 14 correctly.
- **Why:** embedding similarity measures topic overlap, not truth. The number check catches "AUC 0.91" vs "0.89", but _"You built the Airflow infrastructure yourself"_ still passes against a passage saying the data engineering team built it.
- **Production fix:** an NLI (entailment) cross-encoder per sentence–passage pair, or claim-level verification with a strong judge model.

### 12. Evaluation set

- **Current behaviour:** 30 synthetic questions over 6 fictional documents written by the same author.
- **Why:** real resumes are private; the goal is a reproducible sanity check.
- **Production fix:** a larger, independently written test set, per-category reporting, confidence intervals, regression tracking in CI, and online metrics (citation clicks, "wrong answer" reports).

### 13. Heuristic analyses

- **Current behaviour:** skills come from a dictionary (~100 skills); weakness rules and requirement extraction are pattern-based; document classification is keyword scoring.
- **Why:** transparent and testable; no training data.
- **Production fix:** embedding-based skill normalisation (ESCO/O*NET taxonomies), an LLM or fine-tuned classifier for claims, user feedback loops.

### 14. Language

- **Current behaviour:** English by default (bge-small-en, English stopwords, English prompts). `multilingual-e5-small` is available but the rest is not localised.
- **Production fix:** multilingual embedding and reranking models, language-aware tokenization, localised prompts and UI.

### 15. Public LLM proxy abuse

- **Current behaviour:** per-IP in-memory rate limiting (per server instance), token caps and an optional access code.
- **Production fix:** a shared rate-limit store (Redis/Upstash), authentication, per-user quotas, abuse monitoring.

### 16. First-run downloads and CDNs

- **Current behaviour:** ~60 MB of models from Hugging Face and ONNX Runtime files from jsDelivr on first use; cached afterwards. The CSP must allow those origins (and `blob:` scripts for ONNX Runtime's loader). The page is also cross-origin isolated (COOP/COEP) so ONNX Runtime can use several threads, which means any future cross-origin embed (images, iframes) must be served with CORS or CORP headers.
- **Production fix:** self-host model and runtime files on the same origin (Transformers.js `env.localModelPath` / `wasmPaths`), enabling fully offline use and a tighter CSP.

### 17. Approximate token counting and page numbers

- Token counts use ~4 characters per token (fast, model-agnostic, slightly off); DOCX files have no fixed pages, so their citations use section paths instead of page numbers.

---

## Roadmap

Prioritised by impact on answer quality and user trust.

| Priority | Item                                                                   | Why                                                  |
| -------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| 1        | LLM-based query expansion beyond the hand-written interview vocabulary | Fixes the remaining abstract-question misses (§7)    |
| 2        | NLI-based citation verification and contradiction detection            | Turns "similar" into "supported" (§10, §11)          |
| 3        | OCR for scanned PDFs (tesseract.js, on demand)                         | Common real-world resume format (§1)                 |
| 4        | Export / import knowledge base (encrypted file)                        | Backup and moving between devices (§5)               |
| 5        | Self-hosted model/runtime files, offline mode                          | Privacy, reliability, tighter CSP (§16)              |
| 6        | Table-aware parsing and chunking                                       | Better answers about metrics in reports (§2)         |
| 7        | WebLLM "fully in-browser" generation mode                              | Zero-install full experience on WebGPU machines (§4) |
| 8        | Optional sync with Postgres + pgvector + auth                          | Multi-device use (§5, §6)                            |
| 9        | Speech mock interviews with in-browser Whisper                         | Practise speaking, not typing                        |
| 10       | Spaced repetition for the question bank                                | Turn saved questions into a study plan               |
| 11       | Larger labelled evaluation set, eval in CI                             | Catch regressions (§12)                              |
| 12       | Printable prep report (PDF)                                            | Take preparation offline                             |
