# Design decisions

Every significant choice in ResumeRAG, written as: **options → decision → why → trade-off**. Where the evaluation harness produced data, the numbers are quoted (from `npm run eval`, 30 questions over the demo workspace).

---

## 1. Overall architecture

**Options**

- **A. Classic server-side RAG:** upload files to an API, embed on the server, store vectors in a hosted vector DB, generate on the server.
- **B. Local-first RAG:** parse, embed, store and search in the browser; the server only proxies the LLM call.
- **C. Hybrid:** browser embeds, server stores vectors in Postgres/pgvector.

**Decision:** B — local-first, with a thin streaming LLM proxy.

**Why**

- **Vercel fit.** Serverless functions have no GPU, capped memory and bundle size (ONNX Runtime's native binaries for Node are hundreds of MB) and short lifetimes. Loading an embedding model on every cold start is slow and fragile. The browser, by contrast, has a CPU (and often a GPU via WebGPU) and persistent storage.
- **Privacy.** Resumes are personal. In B the documents never leave the device; only the top passages for a question go to the LLM — and with local Ollama, not even those.
- **Cost.** No database, vector DB or embedding API bills. The deployed site is static files plus one tiny function.
- **Setup.** `npm install && npm run dev` — there is nothing to provision.

**Trade-off:** no cross-device sync or multi-user sharing; the first visit downloads ~60 MB of models; indexing speed depends on the user's device. Option C is the documented scaling path (see §5).

## 2. Application framework

**Options:** Streamlit/Gradio (Python) · FastAPI + React (two services) · **Next.js full-stack**.

**Decision:** Next.js 16 (App Router) with TypeScript.

**Why:** one language across UI, worker, API and tests; first-class Vercel deployment; route handlers are enough for the LLM proxy; the whole RAG core runs in the browser, where Python cannot. Streamlit would look like a student demo and cannot run models client-side.

**Trade-off:** the Python ML ecosystem (LangChain, RAGAS, sentence-transformers) is not directly usable; the RAG core is written by hand in TypeScript — which is also an advantage for understanding and explaining it.

## 3. Where embeddings run

**Options:** paid embedding API (OpenAI, Cohere) · server-side model (Python service or Node + onnxruntime) · **browser (Transformers.js)** · Ollama embeddings endpoint.

**Decision:** Transformers.js in a Web Worker, WASM by default, WebGPU optional.

**Why:** free, private, identical in the browser and in Node (the evaluation script uses the same class), and Vercel-compatible. Ollama embeddings would tie retrieval to a local server and break the deployed demo.

**Trade-off:** first-run download; WASM is slower than a GPU server (≈1–2 s to embed the 42 demo chunks on a laptop; much longer for hundreds of pages).

## 4. Embedding model

| Candidate                                   | Dims | Size (q8)  | Notes                                                       |
| ------------------------------------------- | ---- | ---------- | ----------------------------------------------------------- |
| all-MiniLM-L6-v2                            | 384  | ~23 MB     | Classic, fastest, weaker retrieval; 256-token limit         |
| **bge-small-en-v1.5**                       | 384  | ~34 MB     | Strong retrieval for its size, 512-token limit, MIT licence |
| bge-base-en-v1.5                            | 768  | ~110 MB    | Better, 3× download, slower indexing                        |
| multilingual-e5-small                       | 384  | ~118 MB    | ~100 languages                                              |
| nomic-embed-text-v1.5 / EmbeddingGemma-300M | 768  | 140–200 MB | Higher quality, too heavy for a default browser download    |

**Decision:** `bge-small-en-v1.5`, with MiniLM, bge-base and multilingual-e5 selectable in Settings.

**Why:** best retrieval quality per megabyte among small English models, a 512-token window that fits our ~220-token chunks plus header, and CLS pooling + a query instruction documented on the model card.

**Trade-off:** English-focused; a larger model would fix some misses (e.g. _"leadership"_ vs _"led a team of 4"_). The registry (`src/lib/rag/embeddings/models.ts`) makes switching a one-line change; changing models requires re-indexing, because vectors from different models live in different spaces — each document stores the model it was embedded with and the UI flags stale documents.

## 5. Vector storage

**Options**

| Option                                        | Verdict                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Pinecone / managed vector DB                  | Paid, and uploads private documents to a third party                         |
| FAISS                                         | Great library, but in-process (Python/C++); nothing to persist on serverless |
| Chroma                                        | Needs a running server                                                       |
| Postgres + pgvector (Supabase/Neon free tier) | Excellent for multi-user; requires auth and moves documents to a server      |
| PGlite (Postgres in WASM)                     | Interesting, but a whole database engine for a few thousand rows             |
| **IndexedDB + in-memory exact search**        | Free, private, zero setup                                                    |

**Decision:** IndexedDB (via Dexie) for persistence; an in-memory `SearchIndex` (one flat `Float32Array` matrix + BM25 inverted index) for search.

**Why:** at personal scale (hundreds to a few thousand chunks) brute-force search is instant — 5,000 × 384 multiply-adds ≈ 2M operations ≈ a few milliseconds — and has **perfect recall**, unlike approximate indexes. Dexie's live queries let the UI update automatically while the worker writes progress.

**Trade-off:** per-browser, no sync, and brute force stops being instant somewhere around 10⁵–10⁶ chunks. The `SearchIndex` API (`dense`, `keyword`, `filter`, `similarity`) is what a `pgvector` implementation would provide for a multi-user version:

```sql
create table chunks (id text primary key, user_id uuid, doc_type text, text text, embedding vector(384), tsv tsvector);
create index on chunks using hnsw (embedding vector_cosine_ops);
-- dense:   select id from chunks where user_id = $1 order by embedding <=> $2 limit 20;
-- keyword: select id from chunks where user_id = $1 and tsv @@ plainto_tsquery($3) order by ts_rank_cd(tsv, ...) desc limit 20;
```

## 6. Exact vs approximate nearest-neighbour search

**Options:** exact (brute force) · HNSW · IVF.

**Decision:** exact.

**Why:** an approximate index trades recall for speed; that only pays off at scale. The demo's LexiSearch notes describe exactly this trade-off (IVF was needed for 1.9M vectors, not for 42).

**Trade-off:** O(n) per query. Fine here; HNSW (pgvector, hnswlib-wasm) is the upgrade path.

## 7. Chunking strategy

**Options**

| Strategy                                                                    | Problem                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Fixed-size character slicing                                                | Cuts sentences and bullets in half; mixes sections            |
| Recursive character splitter (LangChain-style)                              | Better, but blind to headings and pages                       |
| **Structure-aware**                                                         | Uses the parser's headings, paragraphs and bullets            |
| Semantic chunking (split where embeddings of consecutive sentences diverge) | Extra embedding pass; resumes already have explicit structure |
| Parent–child (small chunks for search, parent section for context)          | Adds complexity; our chunks already align with sections       |

**Decision:** structure-aware chunking (`src/lib/rag/chunking/chunker.ts`):

1. A heading starts a new section; chunks never span two sections.
2. Whole blocks are packed up to the chunk size; oversized blocks are split at sentence boundaries (`Intl.Segmenter`).
3. Overlap (last ~40 tokens, whole sentences only) repeats between chunks of the _same_ section.
4. Chunks under 30 tokens merge into a neighbour, keeping their heading inline ("Languages: English, Hindi").
5. Each chunk records its heading path and page range.

**Why:** a resume role, project or report section is a natural unit of meaning, and interviewers ask about exactly those units. Citations become precise ("page 1 · Experience > Machine Learning Intern").

**Trade-off:** depends on parser quality — a PDF whose headings are not visually distinct loses structure. Semantic and parent–child chunking were evaluated conceptually and deferred (documented in §27).

## 8. Chunk size and overlap

**Measured** (hybrid + rerank):

| Chunk size | Chunks | Recall@5 | MRR   |
| ---------- | ------ | -------- | ----- |
| 120        | 54     | 96.2%    | 0.856 |
| **220**    | 42     | 100%     | 0.894 |
| 350        | 41     | 100%     | 0.897 |
| 500        | 41     | 100%     | 0.897 |

**Decision:** 220 tokens with 40 tokens (~1 sentence) of overlap.

**Why:** too-small chunks lose context (120 is measurably worse); above ~220 the structure-aware chunker already splits at section boundaries, so larger limits change almost nothing for short documents while making citations less precise and the reranker's 512-token input tighter. 220 tokens ≈ one resume role or two report paragraphs.

**Trade-off:** long reports with huge sections benefit from larger chunks; the setting is user-adjustable and the Playground can test it on a temporary index.

## 9. Contextual chunk headers

**Options:** embed the raw chunk · **prepend document title + heading path** · LLM-generated context per chunk ("contextual retrieval").

**Decision:** prepend `title > heading path` to the embedded (and BM25-indexed) text; show the raw text to users and the LLM.

**Why:** the bullet _"Improved AUC from 0.78 to 0.89"_ does not say which project it belongs to; its heading path does. LLM-generated context would cost an LLM call per chunk — too slow on local models — for a benefit mostly captured by the headings.

## 10. Keyword search

**Options:** none (embeddings only) · Postgres full-text search · a JS library (MiniSearch, Lunr, wink) · **own BM25**.

**Decision:** an ~80-line BM25 (`src/lib/rag/retrieval/bm25.ts`) with a tokenizer that keeps technical terms intact ("C++", "node.js", "scikit-learn", "0.89") and also emits their parts.

**Why:** embeddings are weak at rare identifiers, exact numbers and names. A library would work, but BM25 is a classic interview topic — owning 80 readable lines beats explaining a dependency.

**Trade-off:** no stemming beyond plural folding, no phrase queries.

## 11. Combining keyword and semantic results

**Options:** weighted sum of normalised scores · **Reciprocal Rank Fusion (RRF)** · learned fusion.

**Decision:** RRF with k = 60.

**Why:** BM25 scores (0–10+) and cosine similarities (0.5–0.9) are on incomparable scales; normalising them is fragile. RRF uses only ranks, has one well-studied parameter and no training. Measured: Recall@5 rises from 78.8% (semantic only) to 88.5% (hybrid) and MRR from 0.710 to 0.804.

**Trade-off:** on this small set, BM25 with interview-aware expansion alone reaches slightly higher recall (90.4%) than hybrid (88.5%) — fusion can pull a semantically similar but wrong chunk upward. Reranking resolves it (100%).

## 12. Reranking

**Options:** none · **ms-marco-MiniLM-L-6-v2 cross-encoder** · bge-reranker-base (~280 MB) · LLM-as-reranker.

**Decision:** MiniLM-L6 cross-encoder over the top 20 fused candidates, keeping the top 5.

**Why:** measured +11.5 points Recall@5 (88.5% → 100%) and +0.09 MRR (0.804 → 0.894) over hybrid, for a 23 MB download and ~370 ms per query in Node or ~1.1–1.5 s in the browser. It is also the best _answerability_ signal: every unanswerable question scores ≈0.000, most answerable ones 0.2–0.99. An LLM reranker would take tens of seconds locally.

**Browser performance (found by measuring):** the Playground showed 3.6–5.1 s per reranked search in the browser against 373 ms in Node. ONNX Runtime Web only runs WebAssembly on several threads when the page is _cross-origin isolated_ (it needs `SharedArrayBuffer`); otherwise it silently uses one. Adding `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` in `next.config.ts` gave it four threads and brought reranking down to 1.1–1.5 s. The catch: under `require-corp` every cross-origin resource must be served with CORS or CORP headers. Hugging Face, jsDelivr and a CORS-enabled Ollama all are, but it matters before embedding any third-party content.

**Trade-off:** trained on web search queries, so it under-scores abstract interview phrasing ("What leadership experience…", "Tell me about a time…"). Mitigated by giving it the expanded query (§18) and by the semantic second opinion in the confidence gate (§16); one such question is still refused.

## 13. Generation backend

**Options**

| Option                                      | Verdict                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| OpenAI / Anthropic APIs                     | Excellent quality, but paid — not allowed as a dependency                                        |
| Hugging Face Inference                      | Free token with limited credit — optional adapter                                                |
| Ollama (local)                              | Free, private, easy model switching, JSON-schema constrained decoding                            |
| OpenAI-compatible endpoint                  | Covers vLLM, LM Studio, llama.cpp, hosted free tiers, and paid APIs if a user wants them         |
| **In-browser model (Transformers.js/ONNX)** | Free, private and needs no key or account, at the cost of a one-time download and modest quality |
| An LLM inside a Vercel function             | Impossible: no GPU, a 250 MB bundle limit and a 60 s cap                                         |

**Decision:** an `LLMProvider` interface (`src/lib/llm/types.ts`) with Ollama, OpenAI-compatible and Hugging Face implementations, a browser-direct Ollama mode, **an in-browser model (§13a)** and an evidence-only fallback when nothing is reachable. The connection defaults to **automatic**: the server's provider when it has a working one (Ollama during local development), otherwise the in-browser model.

**Why:** the app must work with zero paid services, zero configuration and no signup — a deployed portfolio has no server model, so the browser is the only place left to generate. The provider abstraction is ~150 lines and every HTTP implementation uses plain `fetch`, so the same Ollama class runs on the server and in the browser.

**Trade-off:** answer quality and speed depend on the visitor's hardware, and "automatic" means the same question can be answered by different models on different machines — the answer footer and the trace always name the model that actually wrote it.

## 13a. Which in-browser model

Generation in the tab only helps if a model small enough to download is still careful enough to stay grounded. So the choice was measured rather than guessed: `scripts/llm-bench` builds prompts with the app's own pipeline (hybrid retrieval, reranking, context building, the real system prompts), runs every candidate in headless Chrome over WebGPU, and grades the replies with the app's own citation, number and schema checks — six grounded questions, two questions the documents cannot answer, and two structured-JSON workflows.

| Model (4-bit, q4)       | Download | Facts found | Answers cited | Invented numbers | Correct refusals | Valid JSON | First token | Decode                                         |
| ----------------------- | -------- | ----------- | ------------- | ---------------- | ---------------- | ---------- | ----------- | ---------------------------------------------- |
| **LFM2 1.2B** (default) | 850 MB   | **92%**     | **100%**      | **0**            | **2/2**          | 1/2        | 14.8 s      | 19.6 tok/s                                     |
| LFM2 700M (option)      | 559 MB   | 92%         | 83%           | 1                | 1/2              | 1/2        | 4.3 s       | 34.4 tok/s                                     |
| Qwen3 0.6B              | 919 MB   | 67%         | 100%          | 0                | 2/2              | 0/2        | 8.1 s       | 5.5 tok/s                                      |
| Qwen2.5 0.5B            | 786 MB   | 50%         | 33%           | 0                | 0/2              | 1/2        | 5.0 s       | 8.2 tok/s                                      |
| gemma-3 1B              | 859 MB   | —           | —             | —                | —                | —          | —           | hung the GPU device (`DXGI_ERROR_DEVICE_HUNG`) |
| Qwen2.5 1.5B            | 1788 MB  | —           | —             | —                | —                | —          | —           | could not create a session                     |

Measured on a laptop AMD integrated GPU; a discrete GPU or Apple Silicon is several times faster.

**Decision:** **LFM2 1.2B** by default, with LFM2 700M offered for small or slow devices.

**Why:** it was the only candidate that cited every answer, invented no numbers and refused both unanswerable questions — the three properties this product is built on. Qwen2.5 0.5B failed all three; Qwen3 0.6B stayed honest but missed a third of the facts and was the slowest to write; the two 1B+ alternatives did not run at all on mainstream integrated graphics, which rules them out as a default for strangers' laptops.

**Licensing note:** LFM2 weights are open but not under a standard permissive licence — they carry the LFM Open License v1.0, which is free to use commercially below a revenue threshold. The embedding and reranking models are MIT/Apache-2.0. The Settings panel links each model's licence, and switching the default to an Apache-2.0 model (Qwen3 0.6B) is a one-line change in the registry if a stricter licence is required.

**Findings worth keeping:**

- **16-bit activations (`q4f16`) are not safe to ship.** They are ~40% smaller, and on the benchmark GPU they produced repeated tokens and random Chinese — while the same weights in `q4` (32-bit activations) answered correctly and matched the CPU output exactly. The registry therefore only lists `q4` builds.
- **Structured output is the weak spot.** Even the default model gets one of the two JSON workflows wrong first time (no grammar-constrained decoding exists in Transformers.js), so those features rely on the repair retry and the deterministic fallbacks of §25 — and the schemas now default missing optional arrays instead of rejecting an otherwise good reply.
- **Small models still hallucinate**, which is why nothing here replaces the confidence gate (§16) and per-sentence verification (§17): in a live check, LFM2 700M answered "you managed 1 Kubernetes cluster in production on AWS" from documents that say the opposite, and the verification panel marked it unsupported.

## 14. Default local model

**Decision:** for Ollama, `qwen2.5:7b-instruct` by default, `llama3.2` (3B) recommended for slow machines. For the browser, LFM2 1.2B (§13a).

**Why:** Qwen2.5-7B follows grounding instructions and JSON schemas reliably; 3B models are ~1.6× faster but more often ignore formatting rules or miss nuance. Both are selectable at runtime. A 7B model through Ollama remains clearly better than anything that fits in a browser download, which is why "automatic" prefers a configured server model over the in-browser one.

## 15. Structured output from local models

**Options:** parse free text with regexes · JSON mode only · **JSON schema constrained decoding + validation + repair**.

**Decision:** workflows define a **zod** schema → converted to JSON Schema (`z.toJSONSchema`) → passed to Ollama's `format` (constrained decoding) → the output is extracted (`extractJson` handles code fences, chatter and truncated output) → validated with zod → on failure, one retry that includes the validation error.

**Why:** model output is untrusted input; the UI must never render half-parsed data. Constrained decoding removes most failures at the source.

## 16. Refusing instead of guessing (confidence gate)

**Options:** always generate and hope the prompt prevents hallucination · **gate generation on retrieval confidence**.

**Decision:** compute a confidence level from the best reranker probability (thresholds 0.5 / 0.1 / 0.01), or cosine similarity when reranking is off. With **strict grounding** on (default), confidence "none" returns the refusal message _without calling the LLM_. If the reranker says "none" but cosine similarity is ≥ 0.66, report "low" instead (second opinion).

**Why:** the cheapest hallucination is the one never generated. Measured: 100% of unanswerable questions refused, 96.2% of answerable ones answered. Semantic-only gating refuses only 75% of unanswerable ones — cosine similarity is a poor answerability signal.

**Trade-off:** thresholds come from a 30-question set; one answerable question (_"What leadership experience do I have?"_) is still wrongly refused (listed on the Evaluation page).

## 17. Citation verification

**Options:** none · LLM-as-judge (slow, circular) · NLI entailment model · **embedding similarity between each sentence and its cited passages**.

**Decision:** split the answer into sentences and, for each one, combine three signals: (1) the best embedding similarity against every _sentence_ of the cited passages (comparing with whole passages diluted the score of precise matches); (2) content-word overlap with the cited passages; (3) a **number check** — any number the sentence states that is missing from its sources makes it unverified. A sentence is verified when it passes the number check and has similarity ≥ 0.80, or similarity ≥ 0.62 with ≥ 50% word overlap. Citation numbers that point to no source are flagged separately.

**Why:** cheap (one small embedding batch), local and visible to users. Calibrated on 15 hand-labelled sentence/passage pairs (`scripts/dev/debug-verify.ts`): 14 judged correctly. The number check catches the most dangerous interview error — a wrong metric.

**Trade-off:** similarity is still not entailment — _"You built the Airflow infrastructure yourself"_ passes against a passage saying the data engineering team built it. An NLI model is on the roadmap.

## 18. Query rewriting

**Options:** never · always (LLM) · **only for follow-ups** · HyDE · LLM multi-query expansion.

**Decision:** a heuristic detects follow-ups (short, pronouns like "it/that", "what about…"); only those are rewritten by the LLM into standalone questions (temperature 0, 80 tokens). Without an LLM, the previous question is prepended. Workflows use **deterministic multi-query retrieval** (several fixed queries per feature, merged round-robin).

**Why:** each extra LLM call costs seconds locally. HyDE (retrieve with a hypothetical answer) is risky for personal documents: the hypothetical answer invents facts that then steer retrieval.

**Interview-aware query expansion (added because of the evaluation).** Abstract interview questions ("What leadership experience do I have?", "Tell me about a time I disagreed…") failed because documents use concrete words ("Led a team of 4", "I proposed… instead"). `src/lib/rag/retrieval/query-expansion.ts` appends hand-written vocabulary for common interview themes. Fed to BM25 only, it improved first-stage recall (hybrid 82.7% → 88.5%) but the reranker — still seeing the abstract question — dropped the right chunks again, so the final result did not move. Also giving the reranker the expanded query raised the full pipeline's Recall@5 from 94.2% to 100%, MRR from 0.821 to 0.894, and answer/refuse accuracy from 90% to 96.7%, with every unanswerable question still refused. The expansion is shown in the pipeline trace and can be switched off in Settings.

## 19. Metadata filtering

**Decision:** documents carry a type (auto-classified, user-editable). Evidence about the candidate always uses `excludeDocTypes: [job_description, company_info]`; Ask has a scope selector.

**Why:** without it, a JD saying "Kubernetes required" is retrieved as evidence that _the candidate_ knows Kubernetes. This is the most important correctness rule in JD matching.

## 20. Parsing libraries

**PDF options:** pdf-parse (unmaintained) · PyMuPDF (Python) · **unpdf (pdf.js serverless build)**. unpdf runs in browsers, workers and Node, and `extractTextItems` exposes positions and font sizes, which our layout reconstruction uses to recover headings, bullets and paragraphs with page numbers.

**DOCX options:** manual XML parsing · **mammoth** (maps Word styles to simple HTML). A small dedicated HTML-to-blocks converter works without a DOM, so it runs in the worker.

## 21. Worker communication and state

**Decisions:** Comlink for worker RPC (typed async calls instead of hand-written message protocols); Dexie + `useLiveQuery` instead of a global state library (the database _is_ the state, shared by worker and UI); a tiny `useSyncExternalStore` store for settings in localStorage.

## 22. UI system

**Options:** Streamlit · MUI/Chakra · **Tailwind + shadcn/ui**. shadcn components are copied into the repo (fully editable), accessible (Radix), and match the look of modern developer tools. Charts use the validated colour-blind-safe palette and are simple HTML/CSS rather than a chart library.

## 23. LLM proxy design

**Decision:** one streaming route (`/api/llm/chat`) returning NDJSON, zod-validated requests (≤40 messages, ≤120k characters), token cap, per-IP rate limit, optional access code, provider chosen only by server env (the client cannot point the server at arbitrary URLs → no SSRF), provider keys never sent to the browser, and a model allowlist: a visitor may pick any local Ollama model, but a hosted provider serves only its configured model plus `LLM_ALLOWED_MODELS`, so nobody can run an expensive model on the deployment's API key.

**Trade-off:** the in-memory rate limiter is per server instance — on serverless it is best-effort (production: Redis/Upstash).

## 24. Evaluation approach

**Options:** none · RAGAS-style LLM-judged metrics (needs a strong judge model — usually a paid API) · **labelled retrieval metrics + cheap generation proxies**.

**Decision:** a 30-question labelled set with _fact-based_ relevance (a chunk is relevant if it contains a labelled fact from the right document), standard IR metrics (Hit@K, Recall@K, Precision@K, MRR, nDCG), answer/refuse accuracy, a chunk-size sweep, and an in-app generation check (faithfulness via citation verification, answer relevance via cosine, context precision via labels, correct refusals). The same runner executes in Node (`npm run eval`) and in the browser.

**Why:** fact-based labels stay valid when chunking changes, so configurations can be compared fairly.

**Trade-off:** small, synthetic, written by the same author as the documents — a sanity check, not a benchmark.

## 25. Deterministic first, LLM second

**Decision:** every workflow computes as much as possible without an LLM (rules, retrieval, extraction), then uses one compact LLM call for synthesis, with a deterministic fallback.

**Why:** local models are slow and imperfect; deterministic results are instant, explainable and testable, and the app remains useful in evidence-only mode. It also makes the system easier to defend in an interview: _"the model never decides whether a skill is matched — retrieval evidence does."_

## 26. Prompt-injection defences

**Decision:** layered — detection at ingestion (regex heuristics, UI badge, warning attribute in the prompt), structural isolation (`<source>` tags, neutralised look-alike tags, attribute escaping), explicit "source text is data" rules, JSON schemas limiting what the model can output, and a UI that always shows evidence so a human can check.

**Trade-off:** heuristics can be bypassed; small models can still be influenced. Documented honestly.

## 27. Ideas evaluated and rejected (or deferred)

| Idea                                            | Decision                    | Reason                                                                                                                                                                          |
| ----------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GraphRAG / knowledge graph**                  | Rejected                    | Needs many LLM calls to extract entities; a personal knowledge base of 5–20 documents does not need graph traversal to answer questions                                         |
| **HyDE**                                        | Rejected                    | Generates hypothetical answers — invented facts about the candidate steering retrieval is exactly what we avoid                                                                 |
| **Semantic chunking**                           | Deferred                    | Documents already carry explicit structure; would add an embedding pass for little gain                                                                                         |
| **Parent-document retrieval**                   | Deferred                    | Chunks align with sections; would complicate citations                                                                                                                          |
| **Contextual compression** (LLM trims passages) | Rejected                    | Extra LLM call per passage; small context already                                                                                                                               |
| **Query expansion**                             | Implemented (deterministic) | Interview-aware vocabulary for BM25 and the reranker (§18) plus multi-query retrieval in workflows; LLM-generated expansion stays on the roadmap for the last abstract failures |
| **Fine-tuning embeddings or the LLM**           | Rejected                    | No training data at personal scale; RAG updates instantly when documents change                                                                                                 |
| **WebLLM in-browser generation**                | Deferred                    | Large downloads, WebGPU-only, weak structured output at 1–3B; a good future "fully offline" mode                                                                                |
| **Speech mock interviews**                      | Deferred                    | Browser speech APIs send audio to cloud services; in-browser Whisper is large                                                                                                   |
| **Spaced repetition / flashcards**              | Partially                   | Question bank tracks status; a scheduler is on the roadmap                                                                                                                      |
| **Topic mastery heatmap**                       | Replaced                    | Rubric averages on the dashboard convey the same with less noise                                                                                                                |
| **Answer confidence scores**                    | Implemented                 | Retrieval confidence badge + per-sentence verification                                                                                                                          |
| **Citation verification**                       | Implemented                 | §17                                                                                                                                                                             |
| **Reciprocal rank fusion**                      | Implemented                 | §11                                                                                                                                                                             |
