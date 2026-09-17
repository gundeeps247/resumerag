# LexiSearch — Design Notes

_Personal project by Alex Rivera (fictional demo data). Built between August and November 2024._

## Overview

LexiSearch is a semantic search engine for Indian court judgments. Lawyers and law students usually search judgments with exact keyword tools, which fail when the same legal idea is phrased differently ("wrongful termination" vs "illegal dismissal"). LexiSearch lets users type a natural-language question and returns the most relevant passages, with the judgment name and paragraph number.

The corpus contains 25,000 publicly available judgments (roughly 1.9 million passages after chunking).

## Architecture

1. **Ingestion** — judgments are downloaded as PDFs, converted to text with PyMuPDF, and cleaned (headers, page numbers and footnote markers removed).
2. **Chunking** — each judgment is split into chunks of about 300 words with a 50-word overlap. Paragraph numbers are stored as metadata so results can point to "para 14".
3. **Embeddings** — every chunk is embedded with the open-source `all-MiniLM-L6-v2` sentence-transformers model (384 dimensions). Embedding the full corpus took about 3 hours on a single T4 GPU in Google Colab.
4. **Vector index** — vectors are stored in a FAISS IVF-Flat index with 256 clusters (`nlist = 256`) and `nprobe = 16` at query time. IVF was chosen over a flat index because brute-force search over 1.9M vectors took around 400 ms per query.
5. **Hybrid retrieval** — results from FAISS and from a BM25 index (built with the `rank_bm25` library) are combined with reciprocal rank fusion.
6. **API and UI** — a FastAPI backend exposes `/search`; the React frontend highlights the matching passage and lets users filter by court and year (metadata filters).

## Evaluation

Two law-student volunteers annotated 200 real queries with the passages that answer them.

| Retrieval method | MRR@10 | Recall@20 |
| --- | --- | --- |
| BM25 only | 0.51 | 0.74 |
| Dense only (MiniLM + FAISS) | 0.66 | 0.83 |
| Hybrid (BM25 + dense, RRF) | 0.72 | 0.88 |

Hybrid retrieval was clearly best. Dense-only search struggled with exact citation queries such as "AIR 1973 SC 1461", because embedding models do not preserve rare identifiers well — this is the main reason BM25 was added.

## Latency

Measured on a 4 vCPU cloud VM: query embedding takes about 15 ms, FAISS search about 8 ms, and BM25 about 20 ms. End-to-end p95 latency is 120 ms including the API overhead.

## Challenges

- **Long judgments**: some judgments exceed 200 pages. Fixed-size chunking sometimes separated a legal question from the court's answer.
- **Legal jargon**: general-purpose embeddings do not understand Latin legal terms ("res judicata", "obiter dicta") well.
- **Evaluation effort**: labelling relevant passages was slow; only 200 queries were annotated, so the metrics have wide confidence intervals.

## What I would do differently

- Add a cross-encoder reranker on the top 50 results to improve precision at the top of the list.
- Try a domain-adapted embedding model such as a legal-BERT variant, or fine-tune MiniLM on the annotated pairs.
- Chunk by the judgment's own structure (facts, issues, arguments, holding) instead of fixed word counts.
- Store vectors in PostgreSQL with pgvector so metadata filters and vectors live in one database.
