# Architecture

This document shows how ResumeRAG fits together, from the deployment level down to each pipeline. For _why_ each choice was made, see [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md). For where the code lives, see [CODEBASE_GUIDE.md](CODEBASE_GUIDE.md).

## 1. System overview

```mermaid
flowchart TB
  user(("User"))
  subgraph browser["Browser (user's device)"]
    direction TB
    pages["Next.js pages (React)<br/>Home · Documents · Ask · Practise (mock)<br/>Prep tools · Job match · RAG lab · Settings"]
    workflows["Workflows (src/lib/workflows)<br/>ask · resume-xray · deep-dive · jd-match · mock · star · questions · consistency"]
    client["Worker client (Comlink proxy)"]
    subgraph worker["RAG Web Worker (src/workers/rag.worker.ts)"]
      ingest["Ingestion<br/>parse → classify → chunk → embed"]
      index["In-memory SearchIndex<br/>vector matrix + BM25 inverted index"]
      models["Transformers.js models<br/>bge-small-en-v1.5 · ms-marco-MiniLM-L-6-v2"]
      evalw["Evaluation & playground"]
    end
    subgraph llmw["LLM Web Worker (src/workers/llm.worker.ts)"]
      gen["In-browser generation<br/>LFM2 1.2B (q4) · WebGPU or WASM"]
    end
    idb[("IndexedDB (Dexie)<br/>documents · contents · chunks+vectors<br/>conversations · messages · mockSessions<br/>questions · analyses · meta")]
    settings[("localStorage<br/>settings")]
  end
  subgraph server["Next.js server (next dev / next start / Vercel functions)"]
    chat["POST /api/llm/chat"]
    status["GET /api/llm/status"]
    factory["Provider factory (env)"]
  end
  ollama["Ollama (local)"]
  compat["OpenAI-compatible server<br/>(vLLM · LM Studio · llama.cpp · hosted)"]
  hf["Hugging Face Inference"]
  hub["Hugging Face Hub (model files)<br/>jsDelivr (ONNX Runtime .wasm)"]

  user --> pages
  pages --> workflows --> client --> worker
  worker <--> idb
  pages <--> idb
  pages <--> settings
  workflows -->|"prompt (question + top-K passages)"| chat
  pages --> status
  chat --> factory
  status --> factory
  factory --> ollama
  factory --> compat
  factory --> hf
  workflows -. "private mode" .-> ollama
  hub -. "first run, then cached" .-> models
```

**Division of responsibilities**

| Where                  | What                                                               | Why there                                                          |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Web Worker             | Parsing, chunking, embeddings, search, reranking, evaluation       | CPU-heavy; keeps the UI thread free; data is already on the device |
| Main thread            | UI, workflow orchestration, prompt construction, streaming display | Needs React state and user interaction                             |
| IndexedDB              | All persistent data                                                | Free, private, survives reloads                                    |
| Next.js route handlers | LLM proxy and status                                               | Holds provider credentials; enforces limits                        |
| LLM provider           | Text generation                                                    | Needs GB of RAM / a GPU — not available in serverless functions    |

## 2. Ingestion pipeline

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant P as Knowledge base page
  participant D as documents.ts (main thread)
  participant W as RAG worker
  participant DB as IndexedDB
  U->>P: drop resume.pdf
  P->>D: addBrowserFiles(files)
  D->>D: validateFile (extension, size, %PDF- magic bytes)
  D->>D: sha256Hex → duplicate check
  D->>DB: documents.add({status: "queued"})
  D->>W: ingest(job) — bytes transferred, not copied
  Note over W: jobs run one at a time (queue)
  W->>DB: status "parsing"
  W->>W: parsePdf → lines → headings/paragraphs/bullets with page numbers
  W->>W: classifyDocument → "resume"
  W->>DB: contents.put(blocks) — parsed text kept for re-indexing
  W->>W: chunkBlocks (~220 tokens, 40 overlap, heading path)
  W->>W: scanForInjection → flag suspicious chunks
  W->>DB: status "embedding"
  loop batches of 16 chunks
    W->>W: bge-small embeds "title > headings\nchunk text"
    W->>DB: progress %
  end
  W->>DB: chunks.bulkPut(vectors) + status "ready" + bump kbVersion (one transaction)
  DB-->>P: live query updates the row (progress bar → "10 chunks · 2 pages")
```

**Parsing detail (PDF).** PDFs store positioned text fragments, not paragraphs:

```mermaid
flowchart LR
  a["pdf.js text items<br/>(str, x, y, fontSize, hasEOL)"] --> b["Group by y into lines<br/>sort top→bottom, left→right"]
  b --> c["Drop repeated headers/footers<br/>(same text on ≥50% of pages)"]
  c --> d["Body font size = most common size"]
  d --> e["Headings = lines ≥8% larger<br/>(level by size rank)"]
  d --> f["Paragraph breaks = vertical gaps,<br/>bullet glyphs, short previous line"]
  e --> g["Blocks with page numbers"]
  f --> g
  c --> h{"< 40 chars per page?"}
  h -- yes --> i["Warning: probably scanned — OCR not supported"]
```

## 3. Chunking

```mermaid
flowchart TD
  s[Next block] --> h{Heading?}
  h -- yes --> f1["Close current chunk (no overlap across sections)<br/>update heading path"]
  h -- no --> fit{"Fits in the<br/>current chunk?"}
  fit -- yes --> add[Add whole block]
  fit -- "no, and chunk is ≥50% full" --> f2["Close chunk, carry trailing<br/>sentences ≤40 tokens as overlap"] --> add
  fit -- "no, block too big / chunk nearly empty" --> sp["Split block into sentences<br/>(Intl.Segmenter), pack them"]
  add --> s
  sp --> s
  f1 --> s
  s -. end .-> m["Merge chunks < 30 tokens into a neighbour<br/>(keep their heading inline)"]
  m --> e["embedText = title > heading path + text<br/>(contextual chunk header)"]
```

## 4. Retrieval

```mermaid
flowchart LR
  q[Question] --> emb["embedQuery<br/>'Represent this sentence for searching relevant passages: …'"]
  emb --> dense["Dense search<br/>dot product vs every chunk vector<br/>(exact, top candidateK=20)"]
  q --> bm["BM25 search<br/>tech-aware tokens, k1=1.2, b=0.75<br/>(top 20)"]
  filt["Metadata filter<br/>docTypes / excludeDocTypes / docIds"] -.-> dense
  filt -.-> bm
  dense --> rrf["Reciprocal Rank Fusion<br/>score = Σ 1/(60 + rank)"]
  bm --> rrf
  rrf --> th["Optional similarity threshold"]
  th --> rr["Cross-encoder rerank<br/>(question, chunk) → sigmoid(logit)"]
  rr --> top["Top-K = 5"]
  top --> conf["Confidence<br/>reranker probability, cosine as second opinion"]
```

Every candidate keeps `denseScore/denseRank`, `keywordScore/keywordRank`, `fusedScore/fusedRank`, `rerankScore/rerankRank`, `finalRank` and a `dropReason`, which is what the "How this answer was generated" panel displays.

## 5. Generation (Ask)

```mermaid
sequenceDiagram
  autonumber
  participant UI as Ask page
  participant A as askQuestion()
  participant W as Worker
  participant L as /api/llm/chat → Ollama
  UI->>A: "Why is it different in the report?"
  A->>A: looksLikeFollowUp → yes
  A->>L: condense with history (temperature 0, 80 tokens)
  L-->>A: "Why is the churn model AUC different in the project report?"
  A->>W: search(rewritten, hybrid + rerank, scope filter)
  W-->>A: RetrievalResult (5 chunks, candidates, timings, confidence)
  alt confidence = none (and strict grounding)
    A-->>UI: refusal message, no LLM call
  else evidence found
    A->>A: buildContext → <source id="1" document=… location=…>
    A->>L: system rules + sources + question (stream)
    L-->>UI: tokens (rendered live with citation chips)
    A->>W: supportScores(sentences, cited chunk ids)
    W-->>A: cosine per sentence
    A-->>UI: answer + trace (retrieval, prompt, generation stats, verification)
  end
```

**Which model answers.** `streamChat` resolves the connection first (`src/lib/llm/client.ts`): the default "automatic" mode uses the server's provider when `/api/llm/status` reports a reachable one, and otherwise the in-browser model in the LLM worker — so a deployment with no model still generates. If nothing can run, `askQuestion` returns an **evidence-only** answer: the most relevant sentences from the top passages, each with its citation, clearly labelled as quotes.

## 6. Interview workflows

Every workflow follows _deterministic first, LLM second_:

```mermaid
flowchart LR
  subgraph det["Deterministic (instant, always available)"]
    r1["Multi-query retrieval<br/>(gatherEvidence, round-robin merge)"]
    r2["Rules & extraction<br/>claims · skills · projects · JD requirements · numeric facts"]
  end
  subgraph llm["LLM (optional)"]
    j["Compact prompt + JSON schema<br/>(Ollama constrained decoding)"]
    z["zod validation<br/>+ one repair retry"]
  end
  det --> llm
  det --> fb["Fallback output<br/>(templates / heuristics)"]
  j --> z --> out[UI with citations]
  fb --> out
```

| Workflow            | Deterministic part                                                                                                                             | LLM part                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Resume X-ray        | claim extraction, weakness rules, cross-document conflicts, skills map, "what supports this?" retrieval                                        | likely / grill questions                           |
| Project deep dive   | project detection, 5-query evidence, preparation checklist                                                                                     | 5 explanation levels (streamed), question ladder   |
| JD match            | requirement extraction, one retrieval per requirement (candidate docs only), status from reranker scores + skill mentions + absence statements | summary, prep plan, likely questions               |
| Mock interview      | evidence retrieval, delivery stats, adaptive difficulty, unsupported-claim check (each answer sentence verified against your documents)        | question, rubric evaluation, better-answer outline |
| STAR builder        | evidence retrieval, "no evidence" guard                                                                                                        | STAR structure with facts vs phrasing              |
| Consistency checker | numeric fact extraction and pairing                                                                                                            | verdict per pair                                   |
| Question generator  | category-specific retrieval                                                                                                                    | tailored questions (templates without LLM)         |

## 7. Deployment modes

```mermaid
flowchart TB
  subgraph m0["Vercel, nothing configured (the live demo)"]
    b0[Browser] --> v0["Vercel: static app + /api/llm/status"]
    b0 --> l0["LLM worker in the same tab<br/>LFM2 1.2B from the HF CDN, then cached"]
  end
  subgraph m1["Local development"]
    b1[Browser] --> n1["next dev"] --> o1["Ollama localhost:11434"]
  end
  subgraph m2["Vercel + private mode"]
    b2[Browser] -->|static app + /api/llm/status| v2[Vercel]
    b2 -->|"direct (OLLAMA_ORIGINS)"| o2["Ollama on the visitor's computer"]
  end
  subgraph m3["Vercel + hosted open-weight model"]
    b3[Browser] --> v3["Vercel /api/llm/chat<br/>(access code, rate limit)"] --> h3["OpenAI-compatible provider"]
  end
  subgraph m4["Nothing can generate at all"]
    b4[Browser] --> e4["Evidence-only answers<br/>retrieval · citations · evaluation still work"]
  end
```

## 8. Data model (IndexedDB)

```mermaid
erDiagram
  documents ||--|| contents : "parsed blocks"
  documents ||--o{ chunks : "split into"
  conversations ||--o{ messages : contains
  documents {
    string id PK
    string name
    string docType
    string status
    string hash
    int chunkCount
    string embeddingModel
  }
  contents {
    string docId PK
    json blocks
    int pageCount
  }
  chunks {
    string id PK "docId:index"
    string docId
    string text
    string embedText
    json headingPath
    int pageStart
    Float32Array vector
    bool suspicious
  }
  messages {
    string id PK
    string conversationId
    string role
    string content
    json trace "retrieval + prompt + verification"
  }
  mockSessions {
    string id PK
    json turns
    json summary
  }
  questions {
    string id PK
    string category
    string status
  }
  analyses {
    string id PK
    string kind
    json result
  }
  meta {
    string key PK "kbVersion"
  }
```

`meta.kbVersion` is bumped by every change to documents or chunks; the worker compares it with the version its in-memory index was built from and rebuilds when they differ.
