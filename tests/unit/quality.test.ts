import { describe, expect, it } from "vitest";
import type { JdRequirement } from "@/lib/rag/analysis/jd";
import { judgeSkill, scoreRequirement } from "@/lib/rag/analysis/jd-scoring";
import { DEFAULT_RETRIEVAL } from "@/lib/rag/config";
import { l2Normalize } from "@/lib/rag/embeddings/vector-math";
import { judgeSupport, lexicalSupport, numbersIn } from "@/lib/rag/generation/citations";
import { expandQuery } from "@/lib/rag/retrieval/query-expansion";
import { retrieve } from "@/lib/rag/retrieval/retriever";
import { SearchIndex } from "@/lib/rag/retrieval/search-index";
import type { RetrievedChunk } from "@/lib/rag/types";

function rc(id: string, text: string, rerankScore?: number): RetrievedChunk {
  return {
    chunk: { id, docId: "d", index: 0, text, embedText: text, headingPath: [], tokenCount: 20 },
    document: { id: "d", name: "resume.pdf", docType: "resume", format: "pdf" },
    score: rerankScore ?? 0,
    candidate: { chunkId: id, docId: "d", fusedScore: 0, fusedRank: 1, selected: true, rerankScore },
  };
}

function req(text: string, skills: string[], importance: JdRequirement["importance"] = "required"): JdRequirement {
  return { id: "r", text, skills, importance, section: "Requirements" };
}

describe("interview-aware query expansion", () => {
  it("adds concrete vocabulary for abstract interview themes", () => {
    expect(expandQuery("What leadership experience do I have?")).toContain("led");
    expect(expandQuery("Tell me about a time I disagreed with my manager")).toContain("disagreement");
    expect(expandQuery("What cloud platforms have I used?")).toContain("ec2");
  });

  it("leaves ordinary questions alone", () => {
    expect(expandQuery("What led to the data leakage?")).toBeNull();
    expect(expandQuery("Which algorithm did I use for churn?")).toBeNull();
  });

  it("lets keyword search find 'Led a team of 4' for a leadership question", async () => {
    const vector = l2Normalize(new Float32Array([1, 0]));
    const index = new SearchIndex(
      [
        {
          id: "a",
          docId: "d",
          index: 0,
          text: "Led a team of 4 to build a marketplace.",
          embedText: "Led a team of 4 to build a marketplace.",
          headingPath: [],
          tokenCount: 10,
          vector,
        },
        {
          id: "b",
          docId: "d",
          index: 1,
          text: "Trained an LSTM autoencoder.",
          embedText: "Trained an LSTM autoencoder.",
          headingPath: [],
          tokenCount: 10,
          vector,
        },
      ],
      [{ id: "d", name: "resume.pdf", docType: "resume", format: "pdf" }],
    );
    const deps = {
      index,
      embedQuery: async () => vector,
      embeddingModelId: "toy",
      embeddingCalibration: { high: 0.8, medium: 0.6, low: 0.4 },
    };
    const options = { ...DEFAULT_RETRIEVAL, mode: "keyword" as const, rerank: false };
    const withExpansion = await retrieve("What leadership experience do I have?", options, deps);
    expect(withExpansion.results[0]?.chunk.id).toBe("a");
    expect(withExpansion.keywordQuery).toContain("led");
    const without = await retrieve("What leadership experience do I have?", { ...options, queryExpansion: false }, deps);
    expect(without.results).toEqual([]);
  });
});

describe("JD requirement scoring", () => {
  const skillsLine = rc("s", "Languages: Python, SQL\nCloud and DevOps: Docker, AWS (EC2, S3), familiar with Kubernetes", 0.6);
  const notes = rc(
    "n",
    "- I have only used Kubernetes in a tutorial.\n- I have not used MLflow; experiments were tracked in spreadsheets.\n- My AWS experience is limited to EC2 and S3.",
    0.3,
  );

  it("judges each skill by the words around it, not the whole chunk", () => {
    expect(judgeSkill("Python", [skillsLine])).toBe("strong");
    expect(judgeSkill("Kubernetes", [skillsLine])).toBe("weak");
    expect(judgeSkill("MLflow", [notes])).toBe("absent");
    expect(judgeSkill("AWS", [notes])).toBe("weak");
    expect(judgeSkill("AWS", [notes, skillsLine])).toBe("strong");
  });

  it("does not downgrade Python because Kubernetes is 'familiar' in the same chunk", () => {
    expect(scoreRequirement(req("Strong programming skills in Python and SQL.", ["Python", "SQL"]), [skillsLine]).status).toBe("strong");
  });

  it("treats 'X or Y' requirements as any-of", () => {
    const m = scoreRequirement(req("Familiarity with at least one cloud platform (AWS or GCP).", ["AWS", "GCP"]), [skillsLine]);
    expect(m.status).toBe("strong");
  });

  it("reports stated gaps, which outweigh passing mentions elsewhere", () => {
    const mlflow = scoreRequirement(req("Experience with MLflow.", ["MLflow"], "preferred"), [notes]);
    expect(mlflow.status).toBe("missing");
    expect(mlflow.reason).toMatch(/not really used MLflow/);
    // "familiar with Kubernetes" on the resume, "only used Kubernetes in a tutorial" in the notes.
    expect(scoreRequirement(req("Experience with Kubernetes.", ["Kubernetes"]), [skillsLine, notes]).status).toBe("missing");
    expect(scoreRequirement(req("Experience with Kubernetes.", ["Kubernetes"]), [skillsLine]).status).toBe("partial");
  });

  it("ignores plans in future-work sections", () => {
    const future = rc("f", "- Track experiments and model versions in MLflow instead of spreadsheets.", 0.9);
    future.chunk.headingPath = ["11. Future Work"];
    expect(judgeSkill("MLflow", [future])).toBe("none");
  });

  it("finds skills named only in the heading path", () => {
    const education = rc("e", "2021 - 2025 | CGPA: 8.7/10\n\nRelevant coursework: Machine Learning, Databases.", 0.01);
    education.chunk.embedText = `Resume > EDUCATION > B.Tech in Computer Science and Engineering\n${education.chunk.text}`;
    const m = scoreRequirement(
      req("Bachelor's degree in Computer Science, Statistics or a related field.", ["Computer science", "Statistics"]),
      [education],
    );
    expect(m.status).toBe("strong");
  });

  it("treats a strong retrieval match as partial when the skill word is absent", () => {
    const m = scoreRequirement(req("Build reliable data pipelines with the data engineering team.", ["ETL"]), [
      rc("p", "The data engineering team owned the Airflow pipeline; I wrote the scoring tasks.", 0.96),
    ]);
    expect(m.status).toBe("partial");
    expect(m.reason).toMatch(/does not name ETL/);
  });

  it("uses exact skill mentions that retrieval missed", () => {
    const unrelated = rc("u", "Designed the marketplace UI.", 0.02);
    const m = scoreRequirement(req("Experience with Docker.", ["Docker"]), [unrelated], [skillsLine]);
    expect(m.status).toBe("strong");
    expect(m.evidence[0].chunk.id).toBe("s");
  });
});

describe("citation support", () => {
  it("normalises numbers", () => {
    expect(numbersIn("120,000 customers, 40% faster, AUC 0.89")).toEqual(["120000", "40", "0.89"]);
  });

  it("rejects a sentence whose number is not in the source", () => {
    const lexical = lexicalSupport("You achieved an AUC of 0.91 on the holdout set.", [
      "The final model achieved a ROC-AUC of 0.89 on a time-based holdout set.",
    ]);
    expect(lexical.missingNumbers).toEqual(["0.91"]);
    expect(judgeSupport(0.95, lexical)).toBe(false);
  });

  it("accepts a close paraphrase and a moderately similar sentence with shared words", () => {
    const passage = ["The final model achieved a ROC-AUC of 0.89 on a time-based holdout set."];
    expect(judgeSupport(0.85, lexicalSupport("The AUC was 0.89.", passage))).toBe(true);
    expect(judgeSupport(0.66, lexicalSupport("You achieved an AUC of 0.89 on the time-based holdout set.", passage))).toBe(true);
    expect(judgeSupport(0.66, lexicalSupport("You deployed it on Kubernetes with autoscaling.", passage))).toBe(false);
  });
});
