/**
 * Interview-aware query expansion (deterministic, no LLM).
 *
 * Interview questions are often abstract ("What leadership experience do I have?") while
 * documents are concrete ("Led a team of 4 to build…"). Keyword search can only match
 * words that appear in both, so for common interview themes we append the concrete
 * vocabulary people use when describing them. The expansion only feeds BM25 — the
 * embedding model and the reranker still see the original question, and the expansion
 * is shown in the pipeline trace.
 */

const THEMES: { pattern: RegExp; terms: string }[] = [
  {
    pattern: /\b(leadership|leader|led a team|lead(ing)? (a|the) team|manag(e|ed|ing) (a |the |my )?team|mentor(ed|ing)?)\b/i,
    terms: "led team managed coordinated mentored owned",
  },
  {
    pattern: /\b(disagree\w*|conflict\w*|push(ed)? back|argument|difficult (colleague|teammate|manager))\b/i,
    terms: "disagreement disagreed thought wrong proposed instead convinced analysis meeting adopted",
  },
  { pattern: /\b(mistake|failure|failed|went wrong|regret)\b/i, terms: "mistake bug leak leaked audit lesson learned fixed" },
  {
    pattern: /\b(pressure|deadline|tight timeline|stressful|urgent)\b/i,
    terms: "deadline pressure hours before stopped working fallback re-scoped",
  },
  {
    pattern: /\b(non-technical|stakeholders?|communicat\w*)\b|\bexplain\w*\b.{0,40}\b(someone|manager|business|layman)\b/i,
    terms: "explain explained non-technical stakeholders presented trust",
  },
  { pattern: /\b(cloud|aws|gcp|azure)\b/i, terms: "aws ec2 s3 gcp azure cloud" },
  { pattern: /\b(testing|tests|test coverage)\b/i, terms: "tests testing pytest unit integration coverage" },
  { pattern: /\b(proud|achievements?|accomplishments?)\b/i, terms: "achieved improved won reduced increased award" },
  { pattern: /\b(teamwork|collaborat\w*)\b/i, terms: "team collaboration together teammates" },
];

/** Returns extra keyword terms for the question, or null when no interview theme applies. */
export function expandQuery(query: string): string | null {
  const terms = THEMES.filter((t) => t.pattern.test(query)).flatMap((t) => t.terms.split(" "));
  return terms.length ? [...new Set(terms)].join(" ") : null;
}
