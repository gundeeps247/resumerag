/**
 * Document type classifier.
 *
 * A transparent keyword-scoring classifier: each type has signals (file-name hints,
 * section names, typical phrases) with weights. The highest score wins. It is
 * deliberately simple and explainable; the user can always override the result.
 *
 * Why it matters: the type becomes metadata that retrieval filters on. For example the
 * JD matcher must search the *candidate's* documents only — never the job description.
 */
import type { DocType, TextBlock } from "./types";

interface Signal {
  pattern: RegExp;
  weight: number;
}

const FILENAME_HINTS: Partial<Record<DocType, RegExp>> = {
  resume: /\b(resume|résumé|cv|curriculum)\b/i,
  job_description: /\b(jd|job|role|position|posting|opening|vacancy)\b/i,
  company_info: /\b(company|about|org|culture)\b/i,
  project_report: /\b(report|project|design|writeup|write-up|case[- ]study|readme|notes?)\b/i,
  research_paper: /\b(paper|arxiv|thesis|publication|preprint)\b/i,
  internship: /\b(internship|offer|certificate|completion)\b/i,
  notes: /\b(notes|lecture|syllabus|revision|cheat)\b/i,
};

const CONTENT_SIGNALS: Record<Exclude<DocType, "other">, Signal[]> = {
  resume: [
    { pattern: /^(education|experience|work experience|professional experience)$/im, weight: 3 },
    { pattern: /^(skills|technical skills|projects|certifications|achievements)$/im, weight: 2 },
    { pattern: /[\w.+-]+@[\w-]+\.[\w.]+/, weight: 2 },
    { pattern: /linkedin\.com|github\.com/i, weight: 2 },
    { pattern: /\b(gpa|cgpa|b\.?tech|b\.?sc|bachelor|master)\b/i, weight: 1.5 },
  ],
  job_description: [
    { pattern: /\b(responsibilities|what you('|’)?ll do|what you will do)\b/i, weight: 3 },
    { pattern: /\b(requirements|qualifications|must have|nice to have|preferred)\b/i, weight: 3 },
    { pattern: /\b(we are looking for|we're looking for|you will|about the role|the role)\b/i, weight: 2 },
    { pattern: /\b(apply|benefits|equal opportunity|compensation)\b/i, weight: 1.5 },
  ],
  company_info: [
    { pattern: /\b(our mission|our values|about us|founded in|headquartered)\b/i, weight: 3 },
    { pattern: /\b(customers|products|funding|series [a-d]|employees)\b/i, weight: 1 },
  ],
  research_paper: [
    { pattern: /^abstract$/im, weight: 3 },
    { pattern: /\b(related work|et al\.|arxiv|doi:|references)\b/i, weight: 2 },
    { pattern: /\b(we propose|our method|experiments|ablation)\b/i, weight: 1.5 },
  ],
  project_report: [
    { pattern: /\b(problem statement|architecture|implementation|methodology)\b/i, weight: 2 },
    { pattern: /\b(results|evaluation|future work|lessons learned|conclusion)\b/i, weight: 1.5 },
    { pattern: /\b(dataset|baseline|deployment|design decisions?)\b/i, weight: 1 },
  ],
  internship: [
    { pattern: /\b(internship|intern)\b/i, weight: 1.5 },
    { pattern: /\b(offer letter|certificate of completion|mentor|supervisor|stipend)\b/i, weight: 2 },
  ],
  notes: [{ pattern: /\b(lecture|chapter|notes|revision|summary)\b/i, weight: 1 }],
};

export interface ClassificationResult {
  docType: DocType;
  confidence: number;
  scores: Partial<Record<DocType, number>>;
}

export function classifyDocument(fileName: string, blocks: TextBlock[]): ClassificationResult {
  const headingText = blocks
    .filter((b) => b.kind === "heading")
    .map((b) => b.text)
    .join("\n");
  const sample = blocks
    .slice(0, 400)
    .map((b) => b.text)
    .join("\n")
    .slice(0, 20_000);
  const text = `${headingText}\n${sample}`;

  const scores: Partial<Record<DocType, number>> = {};
  for (const [type, signals] of Object.entries(CONTENT_SIGNALS) as [DocType, Signal[]][]) {
    let score = 0;
    for (const s of signals) if (s.pattern.test(text)) score += s.weight;
    if (FILENAME_HINTS[type]?.test(fileName)) score += 4;
    scores[type] = score;
  }

  const ranked = (Object.entries(scores) as [DocType, number][]).sort((a, b) => b[1] - a[1]);
  const [bestType, best] = ranked[0] ?? ["other", 0];
  const second = ranked[1]?.[1] ?? 0;
  if (best < 3) return { docType: "other", confidence: 0.3, scores };
  const confidence = Math.min(0.99, 0.5 + (best - second) / (best + 1) / 2);
  return { docType: bestType, confidence, scores };
}
