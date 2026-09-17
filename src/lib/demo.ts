/**
 * Demo workspace: fictional documents for the persona "Alex Rivera".
 * No real person's data is used anywhere in this project.
 */
import type { DocType } from "./rag/types";

export interface DemoDocument {
  file: string;
  docType: DocType;
  description: string;
}

export const DEMO_DOCUMENTS: DemoDocument[] = [
  { file: "alex-rivera-resume.pdf", docType: "resume", description: "Two-page resume (PDF)" },
  { file: "finlytics-churn-project-report.docx", docType: "project_report", description: "Internship project report (DOCX)" },
  { file: "lexisearch-design-notes.md", docType: "project_report", description: "Personal project design notes (Markdown)" },
  { file: "behavioral-story-notes.md", docType: "notes", description: "Raw behavioural stories (Markdown)" },
  { file: "northwind-ml-engineer-jd.txt", docType: "job_description", description: "Target job description (TXT)" },
  { file: "northwind-company-notes.md", docType: "company_info", description: "Company research notes (Markdown)" },
];

export const SUGGESTED_QUESTIONS: string[] = [
  "What machine learning project did I build during my internship?",
  "How did I handle class imbalance in the churn model?",
  "Why did I add BM25 to LexiSearch?",
  "What exactly did I personally build in the churn project?",
  "Tell me about a time I disagreed with a teammate.",
  "What is my experience with Kubernetes?",
];
