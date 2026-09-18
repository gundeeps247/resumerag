# Demo script (3–5 minutes)

A rehearsed walkthrough for interviews. **Bold** lines are what to say; the rest is what to click.

## Before the interview (10 minutes)

1. `ollama serve` is running and `ollama list` shows `qwen2.5:7b-instruct` (or `llama3.2` on a slow laptop).
2. `npm run dev`, open http://localhost:3000.
3. **Settings → Developer & appearance → Developer mode: on** (shows latency and token counts).
4. **Knowledge base:** the demo workspace is loaded and all six documents say "N chunks". Models are warm (open the Ask page once; the top bar shows no download pill).
5. Pre-run the slow parts so you can show results instantly if time is short:
   - **Ask:** "How did I handle class imbalance in the churn model?" (keep this conversation).
   - **JD match:** run the analysis once.
   - **Mock interview:** answer one question.
6. Close other heavy apps — local generation is CPU-bound.

**Backup plan:** if Ollama is slow or down, the app falls back to the in-browser model (or, failing that, to _evidence-only mode_) — a feature to show, not a failure: "generation degrades, retrieval and citations do not." On a machine that has never loaded the browser model, expect a one-time ~850 MB download, so pre-warm it in Settings → Language model before demoing offline.

---

## The script

### 0:00 — The problem (20 s)

Landing page.

**"When you prepare for interviews with a chatbot, it confidently invents things about you. I wanted the opposite: an assistant that only answers from my own documents, shows where every claim comes from, and tells me what an interviewer will challenge. It's a RAG system that runs almost entirely in the browser, with open-source models and no paid APIs."**

### 0:20 — Documents in, knowledge base built (30 s)

Click **Open app → Knowledge base**.

**"These are six fictional documents: a PDF resume, a Word project report, Markdown notes, and a job description. Each file was parsed, split into chunks and embedded inside the browser — nothing was uploaded."**

Click **Inspect** on the resume.

**"This is what the system actually searches: chunks of about 220 tokens that follow the document's structure. Each keeps its heading path and page number — that's what makes citations precise."**

### 0:50 — Ask a question, show evidence (50 s)

Go to **Ask** and open the pre-run conversation (or ask live):

> How did I handle class imbalance in the churn model?

**"The answer cites numbered passages."** Hover a citation chip. **"Hover shows the exact passage; click opens it with its document and location."**

Point at the badges: **"'Strong evidence' comes from the reranker's score, and '2 of 2 verified' means each sentence was checked against its cited passage — including whether its numbers appear there."**

### 1:40 — How the answer was generated (50 s)

Click **How this answer was generated**.

**"This is the pipeline for this exact answer. The question is embedded into 384 numbers. Semantic search compares it with every chunk; BM25 does keyword search in parallel. Reciprocal rank fusion merges the two rankings. Then a cross-encoder rereads the top 20 with the question — you can see the rank changes here — and the top five go to the model. Retrieval took about a second, mostly the reranker running on four WebAssembly threads; the rest is local generation."**

If asked why hybrid: **"Embeddings understand meaning but miss exact terms like 'scale_pos_weight' or '0.89'. BM25 catches those."**

### 2:30 — It refuses instead of guessing (20 s)

New chat:

> Have I ever worked at Google?

**"There's no evidence, so it refuses — without even calling the language model. On my evaluation set it refuses every unanswerable question."**

### 2:50 — Interview intelligence: JD match (40 s)

Go to **JD match** (pre-run).

**"Each requirement in the job description is searched against my documents only — the JD itself is excluded by a metadata filter, so a skill only counts if I can point to evidence."** Scroll to the Kubernetes/MLflow row. **"Here it found my own note that I haven't used MLflow, so it's a gap, even though MLflow appears elsewhere as future work. Status is decided deterministically; the LLM only writes the preparation plan."**

### 3:30 — Resume X-ray or mock interview (30 s)

**Prep studio → Resume X-ray**, top claim:

**"It predicts which resume claims an interviewer will challenge. This one says 'Helped reduce churn by 18%' — unclear ownership plus a big number. And it caught that my resume says AUC 0.91 while my report says 0.89."** Click **What supports this?** to show evidence from other documents.

_(Alternative: show a completed mock-interview answer with rubric scores and "claims not backed by your documents".)_

### 4:00 — Evaluation (30 s)

Go to **Evaluation**.

**"I measured every stage on 30 labelled questions. Semantic search alone found 79% of the facts; hybrid 89%; with reranking and interview-aware query expansion, 100% in the top five, with an MRR of 0.89. And I list where it still fails — for example a leadership question that's wrongly refused."**

### 4:30 — Architecture close (30 s)

**"Architecturally, the heavy work — parsing, embeddings, vector search, reranking — runs in a Web Worker with Transformers.js, and data lives in IndexedDB. The server is just a validated, rate-limited streaming proxy to Ollama, behind a provider interface. That's why it deploys on Vercel: there's no GPU or database to host. Happy to go deeper into any stage."**

---

## Likely interruptions and short answers

| They ask                                       | You say                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Why not ChatGPT?"                             | "It doesn't know my documents, invents facts, and I didn't want personal data or paid APIs in the loop."                                         |
| "Where's the vector database?"                 | "IndexedDB plus an in-memory exact index — perfect recall at personal scale; pgvector is the scaling path."                                      |
| "Why is generation slow?"                      | "A 7B model on a laptop CPU, ~6 tokens/s. Retrieval is ~1.3 s in the browser. A GPU or a smaller model fixes generation."                        |
| "What if the documents contradict each other?" | "The prompt asks the model to flag it, and the consistency checker finds numeric conflicts deterministically."                                   |
| "How do you know it works?"                    | "The evaluation page: fact-based labels, four retrieval configurations, a chunk-size sweep and a generation check."                              |
| "What about prompt injection?"                 | "Detected at upload, sources isolated in tags and declared untrusted, outputs schema-constrained — and I'm honest that it's not fully solvable." |

## If you only have 90 seconds

Landing sentence → Ask answer with citation hover → pipeline panel (fusion + rerank) → refusal → one sentence on local-first architecture.
