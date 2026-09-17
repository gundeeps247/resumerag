/**
 * Keyword tokenizer used by BM25.
 *
 * Interview documents are full of technical terms that generic tokenizers mangle:
 * "C++", "C#", "Node.js", "scikit-learn", "CI/CD", "0.91". This tokenizer keeps
 * those intact *and* also emits their parts, so "scikit-learn" matches a query
 * for "scikit learn" and "node.js" matches "node".
 */

const STOPWORDS = new Set(
  (
    "a an and are as at be been being but by can could did do does doing done for from had has have having " +
    "he her here hers him his how i if in into is it its itself just me more most my myself no nor not " +
    "of off on once only or other our ours out over own same she should so some such than that the their " +
    "theirs them then there these they this those through to too under until up very was we were what " +
    "when where which while who whom why will with would you your yours yourself tell about give show " +
    "explain describe list any all also get got use used using"
  ).split(/\s+/),
);

// A token starts and ends with a letter/digit (or +/# for C++/C#) and may contain . - _ / + # inside.
const TOKEN_PATTERN = /[a-z0-9][a-z0-9+#._/-]*[a-z0-9+#]|[a-z0-9]/g;

/** Very light plural folding ("projects" → "project"); applied identically to docs and queries. */
function foldPlural(token: string): string {
  if (!/^[a-z]+$/.test(token) || token.length <= 4) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && !/(ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase().replace(/['’]s\b/g, "");
  const raw = lower.match(TOKEN_PATTERN) ?? [];
  const out: string[] = [];
  for (const token of raw) {
    if (STOPWORDS.has(token)) continue;
    out.push(foldPlural(token));
    // Compound technical terms: also index their parts.
    if (/[._/-]/.test(token) && !/^\d+(\.\d+)?$/.test(token)) {
      for (const part of token.split(/[._/-]+/)) {
        if (part.length > 1 && !STOPWORDS.has(part)) out.push(foldPlural(part));
      }
    }
  }
  return out;
}
