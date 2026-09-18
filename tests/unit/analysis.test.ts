import { describe, expect, it } from "vitest";
import { normalizeCategory } from "@/lib/workflows/mock";
import { analyzeClaim, extractClaims, extractMetrics, flagConflicts } from "@/lib/rag/analysis/claims";
import { extractNumericFacts, findInconsistencies } from "@/lib/rag/analysis/consistency";
import { extractRequirements, statesAbsence } from "@/lib/rag/analysis/jd";
import { detectProjects } from "@/lib/rag/analysis/projects";
import { extractSkills, hasSkill } from "@/lib/rag/analysis/skills";

describe("skills", () => {
  it("finds technical skills, including tricky names", () => {
    const names = extractSkills("Python, C++, C#, Node.js, scikit-learn, PyTorch; familiar with Kubernetes and AWS (EC2, S3).").map(
      (s) => s.name,
    );
    expect(names).toEqual(expect.arrayContaining(["Python", "C++", "C#", "Node.js", "scikit-learn", "PyTorch", "Kubernetes", "AWS"]));
  });

  it("does not confuse ordinary words with languages", () => {
    const names = extractSkills("We had to go to the office. React quickly. Java is fine.").map((s) => s.name);
    expect(names).not.toContain("Go");
    expect(names).toContain("Java");
    expect(names).not.toContain("JavaScript");
    expect(hasSkill("Built with Next.js", "Next.js")).toBe(true);
  });
});

describe("claim analysis", () => {
  it("flags unclear ownership on a big result as high severity", () => {
    const { flags } = analyzeClaim("Helped reduce customer churn by 18% through targeted retention campaigns.");
    expect(flags.find((f) => f.type === "ownership")?.severity).toBe("high");
    expect(flags.some((f) => f.type === "big_metric")).toBe(true);
  });

  it("flags expert claims, vague wording, buzzwords and weak skills", () => {
    expect(analyzeClaim("Expert in machine learning and deep learning.").flags.map((f) => f.type)).toContain("overclaim");
    expect(analyzeClaim("Worked on various backend improvements and bug fixes.").flags.map((f) => f.type)).toContain("vague");
    expect(analyzeClaim("Designed a scalable, fault-tolerant architecture.").flags.map((f) => f.type)).toContain("buzzword");
    expect(analyzeClaim("Cloud: Docker, AWS, familiar with Kubernetes").flags.map((f) => f.type)).toContain("weak_skill");
  });

  it("does not flag a specific, quantified bullet as vague", () => {
    const { flags, metrics } = analyzeClaim("Introduced Redis caching for product lookups, reducing p95 latency by 40%.");
    expect(metrics).toContain("40%");
    expect(flags.map((f) => f.type)).not.toContain("vague");
    expect(flags.map((f) => f.type)).not.toContain("no_metric");
  });

  it("extracts metrics", () => {
    expect(extractMetrics("AUC of 0.91 for 120,000 customers, 2M+ requests, 5x faster, 120 ms, 40 features")).toEqual(
      expect.arrayContaining(["0.91", "120,000", "2M+", "5x", "120 ms", "40"]),
    );
    // "5 more" is not a metric, and "p95" is a percentile name, not a number to defend.
    expect(extractMetrics("I tried 5 more ideas in p95 terms")).toEqual([]);
  });

  it("splits chunks into claims and ranks the riskiest first", () => {
    const claims = extractClaims([
      {
        chunkId: "c1",
        docId: "d",
        docName: "resume.pdf",
        headingPath: ["Experience", "ML Intern"],
        text: "Jan 2025 - Jun 2025 | Fintech startup\n\n- Built a churn model using XGBoost with AUC 0.91.\n- Helped reduce customer churn by 18% through retention campaigns.",
      },
    ]);
    expect(claims.map((c) => c.text)).toEqual([
      "Helped reduce customer churn by 18% through retention campaigns.",
      "Built a churn model using XGBoost with AUC 0.91.",
    ]);
    expect(claims[0].section).toBe("Experience > ML Intern");
  });
});

describe("project detection", () => {
  it("finds resume projects and merges them with matching project reports", () => {
    const projects = detectProjects(
      [
        {
          id: "a",
          docId: "r",
          docName: "resume.pdf",
          docType: "resume",
          headingPath: ["Alex", "PROJECTS", "LexiSearch - Semantic Search for Legal Documents"],
          text: "Built search",
        },
        {
          id: "b",
          docId: "r",
          docName: "resume.pdf",
          docType: "resume",
          headingPath: ["Alex", "EXPERIENCE", "Machine Learning Intern - Finlytics"],
          text: "Built churn",
        },
        {
          id: "c",
          docId: "n",
          docName: "lexisearch-notes.md",
          docType: "project_report",
          headingPath: ["LexiSearch — Design Notes", "Architecture"],
          text: "FAISS",
        },
        // Report sections share the document title's heading level, so the title comes from docTitles.
        { id: "d", docId: "p", docName: "report.docx", docType: "project_report", headingPath: ["3. Data"], text: "XGBoost" },
        { id: "e", docId: "r", docName: "resume.pdf", docType: "resume", headingPath: ["Alex", "SKILLS"], text: "Python" },
      ],
      { n: "LexiSearch — Design Notes", p: "Customer Churn Prediction at Finlytics" },
    );
    expect(projects.map((p) => p.name)).toEqual([
      "LexiSearch - Semantic Search for Legal Documents",
      "Machine Learning Intern - Finlytics",
    ]);
    expect(projects[0].docIds).toEqual(["r", "n"]);
    expect(projects[1].chunkIds).toEqual(["b", "d"]);
  });
});

describe("JD requirements", () => {
  it("extracts requirements with importance and ignores benefits", () => {
    const reqs = extractRequirements([
      { kind: "heading", text: "Responsibilities", level: 2 },
      { kind: "list_item", text: "Deploy models to production and monitor drift." },
      { kind: "heading", text: "Requirements", level: 2 },
      { kind: "list_item", text: "Strong programming skills in Python and SQL." },
      { kind: "heading", text: "Nice to have", level: 2 },
      { kind: "list_item", text: "Experience with Kubernetes and MLflow." },
      { kind: "heading", text: "What we offer", level: 2 },
      { kind: "list_item", text: "Competitive salary and health insurance." },
    ]);
    expect(reqs.map((r) => r.importance)).toEqual(["responsibility", "required", "preferred"]);
    expect(reqs[1].skills).toEqual(["Python", "SQL"]);
  });

  it("recognises statements of missing experience", () => {
    expect(statesAbsence("I have not used MLflow; experiments were tracked in spreadsheets.")).toBe(true);
    expect(statesAbsence("I have only used Kubernetes in a tutorial.")).toBe(true);
    expect(statesAbsence("Deployed the model with Docker and FastAPI.")).toBe(false);
  });
});

describe("consistency checker", () => {
  const sources = [
    {
      chunkId: "r1",
      docId: "resume",
      docName: "resume.pdf",
      text: "- Built a churn system using XGBoost that achieved an AUC of 0.91 on the holdout set.\n- Helped reduce customer churn by 18% through retention campaigns.\n- Led a team of 4 to build a marketplace.",
    },
    {
      chunkId: "p1",
      docId: "report",
      docName: "report.docx",
      text: "The final XGBoost model achieved a ROC-AUC of 0.89 on a time-based holdout set. Churn in the pilot group was 11% lower than in the control group.",
    },
    { chunkId: "n1", docId: "notes", docName: "notes.md", text: "I led a team of four students building a marketplace." },
  ];

  it("extracts metric facts with their value", () => {
    const facts = extractNumericFacts(sources[0]);
    expect(facts.find((f) => f.key === "AUC")?.value).toBe(0.91);
    expect(facts.find((f) => f.key === "team size")?.value).toBe(4);
  });

  it("finds numbers that disagree across documents, but not equal ones written differently", () => {
    const candidates = findInconsistencies(sources);
    const keys = candidates.map((c) => c.key);
    expect(keys).toContain("AUC");
    expect(keys).toContain("churn reduction");
    expect(keys).not.toContain("team size");
    const auc = candidates.find((c) => c.key === "AUC")!;
    expect([auc.a.value, auc.b.value].sort()).toEqual([0.89, 0.91]);
  });

  it("ties counts to the number right before the noun and treats N+ as a lower bound", () => {
    const candidates = findInconsistencies([
      {
        chunkId: "1",
        docId: "a",
        docName: "a",
        text: "Led a team of 4 to build a marketplace used by 1,200+ students. Engineered 40+ behavioural features.",
      },
      {
        chunkId: "2",
        docId: "b",
        docName: "b",
        text: "I led a team of four students. I engineered 43 features. We monitored the ten most important features.",
      },
    ]);
    expect(candidates).toEqual([]);
  });

  it("flags resume claims that conflict with another document", () => {
    const claims = extractClaims([
      {
        chunkId: "r1",
        docId: "resume",
        docName: "resume.pdf",
        headingPath: ["Experience"],
        text: "- Built a churn system using XGBoost that achieved an AUC of 0.91 on the holdout set.",
      },
    ]);
    const flagged = flagConflicts(claims, findInconsistencies(sources));
    expect(flagged[0].flags[0]).toMatchObject({ type: "inconsistent", severity: "high" });
    expect(flagged[0].flags[0].why).toContain("0.89");
  });

  it("does not ask for a baseline when the claim already states one", () => {
    const { flags } = analyzeClaim("Wrote tests with pytest, raising test coverage from 52% to 81%.");
    expect(flags.map((f) => f.type)).not.toContain("big_metric");
  });

  it("skips comma-separated skill lists", () => {
    const claims = extractClaims([
      {
        chunkId: "s",
        docId: "resume",
        docName: "resume.pdf",
        headingPath: ["Skills"],
        text: "ML / AI: PyTorch, scikit-learn, XGBoost, pandas, NumPy, SHAP",
      },
    ]);
    expect(claims).toEqual([]);
  });
});

describe("mock interview question labels", () => {
  it("accepts the labels small models actually produce, and falls back when they invent one", () => {
    expect(normalizeCategory("technical", "project")).toBe("technical");
    expect(normalizeCategory("Project", "technical")).toBe("project");
    expect(normalizeCategory("system design", "technical")).toBe("system_design");
    expect(normalizeCategory("AI/ML", "technical")).toBe("technical"); // not a known label
    expect(normalizeCategory("achievements", "behavioral")).toBe("behavioral");
    expect(normalizeCategory(undefined, "recruiter")).toBe("recruiter");
  });
});
