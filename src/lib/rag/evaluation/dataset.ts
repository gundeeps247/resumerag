/**
 * Evaluation set for the demo workspace.
 *
 * Each question lists the facts a correct answer depends on and the demo document that
 * contains them. Unanswerable questions (no facts) check that the system says
 * "I couldn't find this" instead of hallucinating.
 */
import type { FactSpec } from "./metrics";

export interface EvalQuestion {
  id: string;
  question: string;
  category: "resume" | "project" | "behavioural" | "employer" | "unanswerable";
  facts: FactSpec[];
}

const RESUME = "resume";
const REPORT = "churn-project-report";
const LEXI = "lexisearch";
const STORIES = "behavioral";
const JD = "jd";
const COMPANY = "company";

export const EVAL_QUESTIONS: EvalQuestion[] = [
  {
    id: "q01",
    category: "resume",
    question: "What machine learning project did I build during my internship?",
    facts: [
      { doc: RESUME, anyOf: ["churn prediction"] },
      { doc: REPORT, anyOf: ["churn prediction model"] },
    ],
  },
  {
    id: "q02",
    category: "project",
    question: "Which algorithm did I use for the churn model?",
    facts: [
      { doc: RESUME, anyOf: ["xgboost"] },
      { doc: REPORT, anyOf: ["xgboost"] },
    ],
  },
  {
    id: "q03",
    category: "project",
    question: "What AUC did the churn model achieve?",
    facts: [
      { doc: RESUME, anyOf: ["0.91"] },
      { doc: REPORT, anyOf: ["0.89"] },
    ],
  },
  {
    id: "q04",
    category: "project",
    question: "How did I handle class imbalance?",
    facts: [{ doc: REPORT, anyOf: ["scale_pos_weight", "smote"] }],
  },
  {
    id: "q05",
    category: "project",
    question: "What data leakage problem did I run into?",
    facts: [
      { doc: REPORT, anyOf: ["account_status_updated_at"] },
      { doc: STORIES, anyOf: ["leak"] },
    ],
  },
  {
    id: "q06",
    category: "project",
    question: "How was the churn model deployed to production?",
    facts: [
      { doc: REPORT, anyOf: ["batch-scoring job", "airflow"] },
      { doc: RESUME, anyOf: ["airflow"] },
    ],
  },
  {
    id: "q07",
    category: "project",
    question: "How did I explain the model's predictions to stakeholders?",
    facts: [
      { doc: REPORT, anyOf: ["shap"] },
      { doc: RESUME, anyOf: ["shap"] },
    ],
  },
  {
    id: "q08",
    category: "project",
    question: "What exactly was my personal contribution to the churn project?",
    facts: [{ doc: REPORT, anyOf: ["i owned feature engineering"] }],
  },
  {
    id: "q09",
    category: "project",
    question: "What baseline did the final churn model beat?",
    facts: [{ doc: REPORT, anyOf: ["logistic regression"] }],
  },
  {
    id: "q10",
    category: "project",
    question: "Which evaluation metric mattered most to the business for churn?",
    facts: [{ doc: REPORT, anyOf: ["recall in the top 10%", "recall at top 10%"] }],
  },
  {
    id: "q11",
    category: "resume",
    question: "How much did I reduce latency at CartWave and how?",
    facts: [{ doc: RESUME, anyOf: ["redis caching"] }],
  },
  { id: "q12", category: "resume", question: "What testing experience do I have?", facts: [{ doc: RESUME, anyOf: ["pytest"] }] },
  {
    id: "q13",
    category: "project",
    question: "Which embedding model does LexiSearch use?",
    facts: [{ doc: LEXI, anyOf: ["all-minilm-l6-v2"] }],
  },
  {
    id: "q14",
    category: "project",
    question: "How did LexiSearch compare against a BM25 baseline?",
    facts: [
      { doc: LEXI, anyOf: ["0.51"] },
      { doc: RESUME, anyOf: ["0.51"] },
    ],
  },
  {
    id: "q15",
    category: "project",
    question: "Why did I add keyword search to LexiSearch?",
    facts: [{ doc: LEXI, anyOf: ["exact citation", "rare identifiers"] }],
  },
  {
    id: "q16",
    category: "project",
    question: "What kind of FAISS index did LexiSearch use and why?",
    facts: [{ doc: LEXI, anyOf: ["ivf-flat", "nlist"] }],
  },
  {
    id: "q17",
    category: "project",
    question: "What would I do differently in LexiSearch?",
    facts: [{ doc: LEXI, anyOf: ["cross-encoder reranker"] }],
  },
  { id: "q18", category: "project", question: "Describe the PulseCheck project.", facts: [{ doc: RESUME, anyOf: ["lstm autoencoder"] }] },
  {
    id: "q19",
    category: "resume",
    question: "What leadership experience do I have?",
    facts: [
      { doc: RESUME, anyOf: ["led a team of 4"] },
      { doc: STORIES, anyOf: ["led a team of four"] },
    ],
  },
  {
    id: "q20",
    category: "resume",
    question: "Which hackathon did I win?",
    facts: [
      { doc: RESUME, anyOf: ["hacknorth"] },
      { doc: STORIES, anyOf: ["hacknorth"] },
    ],
  },
  { id: "q21", category: "resume", question: "What is my CGPA?", facts: [{ doc: RESUME, anyOf: ["8.7"] }] },
  {
    id: "q22",
    category: "resume",
    question: "What cloud platforms have I worked with?",
    facts: [
      { doc: RESUME, anyOf: ["aws (ec2, s3)"] },
      { doc: STORIES, anyOf: ["ec2 and s3"] },
    ],
  },
  {
    id: "q23",
    category: "behavioural",
    question: "Tell me about a time I disagreed with someone at work.",
    facts: [{ doc: STORIES, anyOf: ["disagreement", "30 days"] }],
  },
  {
    id: "q24",
    category: "behavioural",
    question: "Tell me about a time I worked under pressure.",
    facts: [{ doc: STORIES, anyOf: ["rate limit", "10 hours before the deadline"] }],
  },
  {
    id: "q25",
    category: "employer",
    question: "What does the Northwind interview process look like?",
    facts: [{ doc: COMPANY, anyOf: ["project deep dive"] }],
  },
  {
    id: "q26",
    category: "employer",
    question: "Which MLOps tools does the Northwind job mention?",
    facts: [{ doc: JD, anyOf: ["mlflow"] }],
  },
  { id: "q27", category: "unanswerable", question: "What is my experience with the Rust programming language?", facts: [] },
  { id: "q28", category: "unanswerable", question: "Have I ever worked at Google?", facts: [] },
  { id: "q29", category: "unanswerable", question: "Which mobile apps have I published on the App Store?", facts: [] },
  { id: "q30", category: "unanswerable", question: "What was my salary at my last job?", facts: [] },
];
