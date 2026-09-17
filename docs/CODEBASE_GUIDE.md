# Codebase guide

Where everything lives, why it exists, and how the pieces call each other. Read [PROJECT_EXPLAINED_SIMPLY.md](PROJECT_EXPLAINED_SIMPLY.md) first if a concept is unfamiliar.

## How to read this repository

The code is layered. Each layer only depends on the layers below it:

```
src/app/…            Pages and API routes (Next.js)
src/components/…     UI components
src/lib/workflows/…  Feature orchestration (Ask, Resume X-ray, JD match, mock interview…)
src/lib/client/…     Browser-side helpers: worker client, settings, knowledge-base operations
src/workers/…        The RAG Web Worker (hosts models, index, ingestion)
src/lib/llm/…        LLM provider abstraction (Ollama, OpenAI-compatible, Hugging Face)
src/lib/rag/…        ★ The RAG core — pure TypeScript, no React, no browser APIs
src/lib/db/…         IndexedDB schema
src/lib/server/…     Server-only config, provider factory, rate limiter
```

**`src/lib/rag` is the heart of the project.** It has no dependency on React, Next.js or IndexedDB, so the same code runs in the Web Worker, in Node (`npm run eval`) and in unit tests.

A good reading order: `rag/types.ts` → `rag/parsing` → `rag/chunking/chunker.ts` → `rag/embeddings/embedder.ts` → `rag/retrieval/search-index.ts` → `rag/retrieval/retriever.ts` → `workers/rag.worker.ts` → `workflows/ask.ts` → `app/(app)/ask/page.tsx`.

---

## `src/lib/rag/` — the RAG core

### `types.ts`

- **What:** every domain type: `TextBlock`, `ParsedDocument`, `Chunk`, `StoredChunk`, `KbDocument`, `ChunkingOptions`, `RetrievalOptions`, `ScoredCandidate`, `RetrievalResult`, `DOC_TYPES`, `EMPLOYER_DOC_TYPES`.
- **Why:** one shared vocabulary for parser, chunker, retriever, worker, UI and tests.
- **Note:** `EMPLOYER_DOC_TYPES` (job descriptions, company info) is used everywhere evidence about the candidate is gathered, so employer documents are never mistaken for the candidate's experience.

### `config.ts`

- **What:** `DEFAULT_CHUNKING` (220 / 40 / 30 tokens), `DEFAULT_RETRIEVAL` (hybrid, top-5, 20 candidates, rerank on, RRF k = 60, query expansion on), `FILE_LIMITS` (10 MB, 20 files, 200 PDF pages…).
- **Why:** the tunable numbers in one place; values chosen with the evaluation harness.

### `parsing/` — files → structured blocks

| File                 | What it does                                                                                                                                                             | Key functions                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `index.ts`           | Entry point: validates, dispatches by format, enforces size limits                                                                                                       | `parseFile(fileName, bytes)`, `parsePastedText(text, title)`, `blocksToText()` |
| `validate.ts`        | Extension allow-list, size limit, magic-byte checks                                                                                                                      | `validateFile()`, `formatFromName()`, `FileValidationError`                    |
| `pdf.ts`             | pdf.js (via `unpdf`) text items → lines → headings (font size), bullets, paragraphs (vertical gaps), page numbers; drops repeated headers/footers; warns on scanned PDFs | `parsePdf()`                                                                   |
| `docx.ts`            | mammoth → simple HTML → blocks (no DOM needed, so it works in a worker)                                                                                                  | `parseDocx()`, `htmlToBlocks()`, `decodeEntities()`                            |
| `text.ts`            | Markdown (headings, lists, tables, code) and plain text                                                                                                                  | `parseMarkdown()`, `parsePlainText()`, `stripInlineMarkdown()`                 |
| `lines-to-blocks.ts` | Shared line → block heuristics for PDF and TXT                                                                                                                           | `linesToBlocks()`                                                              |
| `clean.ts`           | Unicode normalisation, bullets, hyphenation, heading heuristics                                                                                                          | `normalizeText()`, `stripBullet()`, `joinLines()`, `isAllCapsHeading()`        |

- **Called by:** `ingestion/pipeline.ts` (`parseSource`).
- **Why blocks instead of strings:** the chunker needs to know where headings and bullets are, and citations need page numbers.

### `classify.ts`

- **What:** keyword-scoring document classifier (`classifyDocument(fileName, blocks)` → `{ docType, confidence, scores }`).
- **Called by:** the worker during ingestion (unless the user locked the type).

### `chunking/`

| File           | What it does                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chunker.ts`   | `chunkBlocks(blocks, options)` — structure-aware chunking: section boundaries at headings, whole blocks packed to ~220 tokens, sentence-level splitting for oversized blocks, sentence-level overlap, merging of tiny chunks, heading path and page range per chunk. `buildEmbedText(title, headingPath, text)` builds the contextual header that is embedded. |
| `sentences.ts` | `splitSentences()` using `Intl.Segmenter` (handles decimals and abbreviations), `splitByWords()` for extreme cases.                                                                                                                                                                                                                                            |
| `tokens.ts`    | `estimateTokens()` — ≈ characters ÷ 4.                                                                                                                                                                                                                                                                                                                         |

- **Called by:** `ingestion/pipeline.ts` (`chunkDocument`), the worker's playground and evaluation.
- **Why it exists:** embedding a whole 80-page PDF as one vector would be inefficient and meaningless; small focused chunks are what retrieval returns and what the LLM reads.

### `embeddings/`

| File             | What it does                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models.ts`      | Registry of embedding models (bge-small default, MiniLM, bge-base, multilingual-e5) and the reranker, with dimensions, pooling, query prefix, size and **confidence calibration thresholds**. `getEmbeddingModel()`, `getRerankerModel()`.                  |
| `embedder.ts`    | `TransformersEmbedder.create(model, options)` loads the model with Transformers.js (WASM/WebGPU in the browser, CPU in Node); `embedDocuments(texts)` (batches of 16) and `embedQuery(text)` (adds the model's query instruction). Emits download progress. |
| `vector-math.ts` | `dot`, `l2Normalize`, `cosineSimilarity`, `topKByDot` (exact nearest-neighbour search over a flat `Float32Array`).                                                                                                                                          |

- **Called by:** the worker (ingestion, search, verification) and `scripts/eval.ts`.

### `retrieval/`

| File                 | What it does                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokenizer.ts`       | `tokenize()` for BM25: lower-cases, keeps `c++`, `node.js`, `scikit-learn`, `0.89` intact and also emits their parts, removes stopwords, folds simple plurals.                                                                                                      |
| `bm25.ts`            | `Bm25Index` — inverted index with k1 = 1.2, b = 0.75; `search(query, k, allow)`, `idf(term)`, `matchedTerms()`.                                                                                                                                                     |
| `query-expansion.ts` | `expandQuery(question)` — adds concrete vocabulary for abstract interview themes (leadership → "led team managed…"). Used for BM25 and the reranker query.                                                                                                          |
| `fusion.ts`          | `reciprocalRankFusion(rankings, k)` — Σ weight / (k + rank).                                                                                                                                                                                                        |
| `search-index.ts`    | `SearchIndex` — the in-memory "vector database": one matrix of vectors + a BM25 index over the same chunks. `dense()`, `keyword()`, `filter()` (metadata filters), `similarity()`, `vectorOf()`.                                                                    |
| `retriever.ts`       | `retrieve(query, options, deps)` — the full pipeline: embed → dense top-K → BM25 top-K → RRF → optional threshold → cross-encoder rerank → top-K → confidence. Returns results **plus the complete trace** (every candidate's scores and ranks, timings, previews). |
| `confidence.ts`      | `assessConfidence()` — maps the best reranker probability (or cosine) to high / medium / low / none, with a semantic "second opinion" when the reranker is miscalibrated.                                                                                           |

- **Called by:** the worker (`search`, `searchMany`, `playgroundSearch`, `evaluate`) and `scripts/eval.ts`.
- **Calls:** `SearchIndex`, a `Reranker`, and an `embedQuery` function passed in as dependencies — which is why it is easy to unit-test with fake vectors (`tests/unit/retriever.test.ts`).

### `reranking/reranker.ts`

- **What:** `CrossEncoderReranker.create(model)` and `score(query, passages)` → sigmoid probabilities, in batches of 10.
- **Why:** re-scores the ~20 fused candidates by reading question and passage together; the largest single quality gain in the evaluation.

### `generation/`

| File            | What it does                                                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context.ts`    | `buildContext(results, maxTokens)` → numbered `<source id=… document=… type=… location=…>` blocks within a token budget; `formatLocation()` ("page 1 · Experience > ML Intern"). Neutralises tag look-alikes.                                       |
| `prompts.ts`    | `GROUNDING_RULES` (shared by every feature), `askSystemPrompt()`, `askUserPrompt()`, `condenseQuestionMessages()` (follow-up rewriting), `looksLikeFollowUp()`.                                                                                     |
| `citations.ts`  | `parseCitations()`, `invalidCitations()`, `splitAnswerSentences()`, `linkCitations()` (turns `[1]` into chip links), `lexicalSupport()` (word overlap + numbers missing from the source), `judgeSupport()` (verification decision), `REFUSAL_TEXT`. |
| `extractive.ts` | `extractiveAnswer()` — evidence-only answers when no LLM is reachable.                                                                                                                                                                              |

### `guardrails/injection.ts`

- **What:** `scanForInjection(text)` (regex heuristics for instruction overrides, role hijacks, prompt markers, exfiltration, evaluation manipulation) and `neutralizeTags(text)`.
- **Called by:** `ingestion/pipeline.ts` (flags chunks) and `generation/context.ts`.

### `ingestion/pipeline.ts`

- **What:** `parseSource()`, `chunkDocument(docId, name, parsed, options)` (chunks + ids + embed text + injection flags), `prepareDocument()`, `embedChunks(chunks, embedder)`.
- **Called by:** the worker and `scripts/eval.ts`. Framework-free by design.

### `analysis/` — deterministic interview intelligence

| File             | What it does                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills.ts`      | ~100-skill taxonomy with robust patterns (C++, C#, Node.js…); `extractSkills()`, `hasSkill()`.                                                                                                                                                  |
| `claims.ts`      | Resume claim extraction and the weakness rules (ownership, overclaim, vague, buzzword, weak skill, no metric, big metric); `extractClaims()`, `analyzeClaim()`, `extractMetrics()`, `flagConflicts()` (adds "Conflicts with another document"). |
| `projects.ts`    | `detectProjects(chunks, docTitles)` — projects/roles from resume headings and report titles, merged across documents by distinctive names.                                                                                                      |
| `jd.ts`          | `extractRequirements(blocks)` — JD sections → required / preferred / responsibility requirements with skills.                                                                                                                                   |
| `jd-scoring.ts`  | `scoreRequirement(requirement, retrieved, skillMentions)` and `judgeSkill()` — strong / partial / missing from how each skill is mentioned ("familiar with", "I have not used", future-work sections ignored), any-of for "X or Y".             |
| `consistency.ts` | `extractNumericFacts()` and `findInconsistencies()` — numbers that disagree across documents (AUC 0.91 vs 0.89), with lower-bound ("40+") and stage ("first model") handling.                                                                   |

### `evaluation/`

| File         | What it does                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `dataset.ts` | 30 labelled questions (`EVAL_QUESTIONS`) with required facts per document; 4 unanswerable.                       |
| `metrics.ts` | `factMatches()`, `scoreRetrieval()` (Hit, Recall, Precision, MRR, nDCG per question), `aggregate()`.             |
| `runner.ts`  | `EVAL_CONFIGS` (BM25, semantic, hybrid, hybrid + rerank) and `runEvaluation()` — shared by the browser and Node. |
| `report.ts`  | Type of `public/eval/reference-results.json`.                                                                    |

---

## `src/workers/rag.worker.ts` — the RAG engine

The `RagEngine` class, exposed with Comlink. It owns the models, the ingestion queue and the search index.

| Method                                                                | What it does                                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `configure({ embeddingModelId, device })`                             | Switches model/device; resets caches.                                                                                                    |
| `warmup({ reranker })`                                                | Pre-loads models in the background.                                                                                                      |
| `ingest(job)`                                                         | Queued: parse → classify → store parsed blocks → chunk → embed (progress) → write chunks + status in one transaction → bump `kbVersion`. |
| `reindex(docIds, chunking)`                                           | Re-chunks and re-embeds from stored parsed text.                                                                                         |
| `search(query, options)` / `searchMany(queries, options)`             | Runs `retrieve()` against the (lazily rebuilt) `SearchIndex`.                                                                            |
| `listChunks(filter)`                                                  | All indexed chunks with document metadata (used by analysis features).                                                                   |
| `supportScores(sentences, chunkIds)`                                  | Citation verification: max similarity between each answer sentence and each sentence of the cited chunks.                                |
| `similarity(a, b)`, `rerankTexts()`, `similarChunkPairs()`, `embed()` | Utilities for workflows and evaluation.                                                                                                  |
| `playgroundSearch(query, chunking, options)`                          | Builds a temporary index with custom chunking (cached) and searches it.                                                                  |
| `evaluate(chunking, k, onProgress)`                                   | Indexes the demo documents separately and runs the evaluation.                                                                           |

**Index freshness:** `getIndex()` compares `meta.kbVersion` in IndexedDB with the version its in-memory index was built from and rebuilds when documents change.

---

## `src/lib/llm/` — language-model access

| File                             | What it does                                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`                       | `LLMProvider` interface (`streamChat`, `status`), `ChatMessage`, `GenerateOptions`, `StreamEvent`, `ProviderError`.                                                                                                                                                                  |
| `providers/ollama.ts`            | `OllamaProvider` — `/api/chat` streaming (NDJSON), JSON-schema `format`, `num_ctx` 8192, `/api/tags` status with "run `ollama pull …`" hints. Works on the server and in the browser.                                                                                                |
| `providers/openai-compatible.ts` | `OpenAICompatibleProvider` — `/chat/completions` streaming (SSE), bearer auth, `/models` status.                                                                                                                                                                                     |
| `providers/huggingface.ts`       | `HuggingFaceProvider` — preset of the OpenAI-compatible provider for the HF router.                                                                                                                                                                                                  |
| `stream.ts`                      | `readLines`, `readNdjson`, `readSse` stream readers; `withStallTimeout()` aborts a stream that produces nothing for too long (`StallError`).                                                                                                                                         |
| `json.ts`                        | `extractJson()` (fences, chatter, truncated output) and `parseWithSchema()` (zod).                                                                                                                                                                                                   |
| `schema.ts`                      | `chatRequestSchema` — request validation for the API route (roles, sizes, model-name pattern).                                                                                                                                                                                       |
| `client.ts`                      | Browser side: `streamChat(connection, …)` (server route or direct Ollama, guarded by a stall timeout: 240 s to first output, 90 s between chunks), `complete()`, `completeJson()` (schema → JSON Schema → constrained decoding → validation → one repair retry), `fetchLlmStatus()`. |

## `src/lib/server/` (server-only)

| File            | What it does                                                                  |
| --------------- | ----------------------------------------------------------------------------- |
| `env.ts`        | zod-validated environment (`getServerEnv()`), empty strings treated as unset. |
| `provider.ts`   | `getServerProvider()` — builds the provider chosen by `LLM_PROVIDER`.         |
| `rate-limit.ts` | `RateLimiter` — sliding-window, per-IP, in memory.                            |

## `src/app/api/llm/`

- `chat/route.ts` — `POST`: access code check → rate limit → zod validation → stream provider events as NDJSON; caps output tokens; passes the request's abort signal to the provider.
- `status/route.ts` — `GET`: provider, model, availability, model list, whether an access code is required. Never returns secrets.

## `src/lib/workflows/` — features

All client-side ("use client"), all built from `common.ts`:

| File                 | What it does                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `common.ts`          | `CANDIDATE_FILTER`, `gatherEvidence(queries)` (multi-query retrieval, round-robin merge, dedupe), `runLlmJson()` (JSON call that returns an error value instead of throwing), `validSources()`, `loadDocTitles()`. |
| `ask.ts`             | `askQuestion()` — follow-up rewriting → retrieval (with scope filter) → confidence gate → context → streamed generation → citation verification; evidence-only fallback. Returns content + full trace.             |
| `resume-xray.ts`     | `analyzeResume()` (claims, conflicts, skills map, projects), `findSupport(claim)`, `generateChallenges(claims, mode)` (likely / grill).                                                                            |
| `deep-dive.ts`       | `listProjects()`, `prepareProject()` (evidence + checklist), `streamExplanation(level)`, `generateQuestionLadder()`.                                                                                               |
| `jd-match.ts`        | `matchJobDescription(jdDocId)` (requirements × retrieval × skill lookup × scoring), `summarizeMatch()`.                                                                                                            |
| `mock.ts`            | `nextQuestion()`, `evaluateAnswer()`, `deliveryStats()`, `adaptDifficulty()`, `RUBRIC`.                                                                                                                            |
| `star.ts`            | `buildStarAnswer(prompt)` with facts / phrasing / missing separation.                                                                                                                                              |
| `questions.ts`       | `generateQuestions({ category, difficulty, count, focus })`, `CATEGORY_INFO`.                                                                                                                                      |
| `consistency.ts`     | `findCandidates()`, `verifyCandidates()`.                                                                                                                                                                          |
| `generation-eval.ts` | `runGenerationEval()` — faithfulness, answer relevance, context precision, correct refusals.                                                                                                                       |

## `src/lib/client/` — browser helpers

| File               | What it does                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rag-client.ts`    | `getRag()` — creates the worker once and returns the Comlink proxy; `onModelProgress()`.                                                                                                                               |
| `documents.ts`     | `addBrowserFiles()`, `addFiles()` (validate, hash, dedupe, queue), `addPastedText()`, `loadDemoWorkspace()`, `deleteDocument()`, `setDocumentType()`, `reindexDocuments()`, `clearKnowledgeBase()`, `deleteAllData()`. |
| `settings.ts`      | `useSettings()`, `updateSettings()`, `DEFAULT_SETTINGS` — localStorage + `useSyncExternalStore`.                                                                                                                       |
| `question-bank.ts` | `saveQuestion()` with duplicate check.                                                                                                                                                                                 |

## `src/lib/db/`

- `schema.ts` — `ResumeRagDB` (Dexie) tables and indexes; `getDb()`; `bumpKbVersion()` / `getKbVersion()`.
- `records.ts` — `AnswerRecordTrace`, `CitationCheck`, `SavedQuestion`, `MockSessionRecord`, `SavedAnalysis`.

## Other `src/lib` files

- `demo.ts` — `DEMO_DOCUMENTS` and `SUGGESTED_QUESTIONS`.
- `format.ts` — display helpers (`formatBytes`, `formatRelative`, `formatMs`, `pct`, `truncate`, `newId`).
- `utils.ts` — `cn()` class-name helper.

## `src/hooks/`

- `use-kb.ts` — `useDocuments()`, `useKbStats()`, `useDocumentDetail()` (Dexie live queries).
- `use-llm-status.ts` — polls `/api/llm/status` (or local Ollama in private mode).
- `use-model-progress.ts` — aggregates model download events for the top bar.
- `use-mobile.ts` — media-query hook used by the sidebar.

## `src/components/`

| Folder       | Contents                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app-shell/` | `app-sidebar.tsx`, `topbar.tsx` (model download pill, LLM status pill, theme toggle), `nav.ts`, `rag-bridge.tsx` (syncs settings to the worker, pre-loads models).                                                                   |
| `chat/`      | `assistant-message.tsx`, `citation-chip.tsx` (hover preview), `source-card.tsx`, `evidence-panel.tsx` (Sources / Pipeline / Prompt tabs), `pipeline-trace.tsx` ("How this answer was generated" + candidates table), `composer.tsx`. |
| `documents/` | `upload-dropzone.tsx`, `paste-dialog.tsx`, `document-list.tsx` (status, progress, retry, type change), `document-viewer.tsx` (chunks with overlap shading, parsed text), `demo-button.tsx`.                                          |
| `common/`    | `page-header.tsx`, `doc-type.tsx`, `score-bar.tsx` (meters and rings), `confidence-badge.tsx`, `markdown.tsx` (safe rendering), `cited-text.tsx`, `feature-states.tsx` (empty/LLM notices), `severity.tsx`.                          |
| `charts/`    | `grouped-bars.tsx` — accessible, colour-blind-safe metric bars.                                                                                                                                                                      |
| `brand/`     | `logo.tsx`.                                                                                                                                                                                                                          |
| `ui/`        | shadcn/ui primitives (generated; edit freely).                                                                                                                                                                                       |

## `src/app/` — routes

| Route                                                                                          | File                                    | Notes                                                       |
| ---------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `/`                                                                                            | `page.tsx`                              | Landing page (server component; reads reference eval JSON). |
| `/dashboard`                                                                                   | `(app)/dashboard/page.tsx`              | Readiness score, next steps; `?demo=1` loads the demo.      |
| `/documents`                                                                                   | `(app)/documents/page.tsx`              | Knowledge base.                                             |
| `/ask`                                                                                         | `(app)/ask/page.tsx`                    | Chat with evidence panel, history, scope selector.          |
| `/prep`, `/prep/resume`, `/prep/project`, `/prep/questions`, `/prep/star`, `/prep/consistency` | `(app)/prep/**`                         | Prep studio tools.                                          |
| `/mock`                                                                                        | `(app)/mock/page.tsx`                   | Mock interview.                                             |
| `/jd`                                                                                          | `(app)/jd/page.tsx`                     | JD match.                                                   |
| `/lab`                                                                                         | `(app)/lab/page.tsx`                    | Retrieval playground.                                       |
| `/evaluation`                                                                                  | `(app)/evaluation/page.tsx`             | Evaluation.                                                 |
| `/settings`                                                                                    | `(app)/settings/page.tsx`               | Settings.                                                   |
| —                                                                                              | `(app)/layout.tsx`                      | Sidebar shell for all app pages.                            |
| —                                                                                              | `layout.tsx`, `globals.css`, `icon.svg` | Root layout, theme tokens, favicon.                         |

## Scripts, tests and data

| Path                                                      | What it is                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/eval.ts`                                         | Offline evaluation (`npm run eval`, `--grid`, `--inspect --blocks`, `--scores`, `--model=…`, `--no-save`).                                 |
| `scripts/generate-demo-docs.ts`                           | Generates the demo PDF (pdf-lib) and DOCX (docx).                                                                                          |
| `scripts/dev/debug-verify.ts`                             | Calibrates citation verification thresholds on labelled pairs.                                                                             |
| `scripts/dev/debug-jd.ts`                                 | Prints JD-match statuses and evidence for the demo data.                                                                                   |
| `tests/unit/*.test.ts`                                    | Vitest: chunking, parsing, retrieval primitives, retriever, generation/citations, LLM providers & API validation, analysis, quality rules. |
| `tests/e2e/smoke.spec.ts`                                 | Playwright: landing, demo ingestion in the browser, cited answer, pipeline panel, refusal.                                                 |
| `public/demo/`                                            | Fictional demo documents.                                                                                                                  |
| `public/eval/reference-results.json`                      | Output of `npm run eval -- --grid`, shown on the Evaluation and landing pages.                                                             |
| `next.config.ts`                                          | Security headers (CSP etc.) and cross-origin isolation (COOP/COEP), which ONNX Runtime needs to run WebAssembly on several threads.        |
| `vercel.json`, `.env.example`, `.github/workflows/ci.yml` | Deployment, configuration, CI.                                                                                                             |

## Tracing a feature through the code: "Ask"

1. `app/(app)/ask/page.tsx` → `send()` saves the user message and calls `askQuestion()`.
2. `lib/workflows/ask.ts` → maybe rewrites the follow-up (`lib/llm/client.ts` → `/api/llm/chat` → Ollama).
3. → `getRag().search()` → `workers/rag.worker.ts` `search()` → `getIndex()` → `rag/retrieval/retriever.ts` `retrieve()` → `SearchIndex.dense()` / `keyword()` → `fusion.ts` → `reranker.ts` → `confidence.ts`.
4. → confidence gate → `rag/generation/context.ts` `buildContext()` → `prompts.ts`.
5. → `streamChat()` → `/api/llm/chat` → `OllamaProvider.streamChat()` → tokens stream back to the page.
6. → `splitAnswerSentences()` → worker `supportScores()` → `lexicalSupport()` / `judgeSupport()`.
7. → the page saves the assistant message with its trace; `components/chat/assistant-message.tsx` renders citations; `evidence-panel.tsx` and `pipeline-trace.tsx` render the evidence.
