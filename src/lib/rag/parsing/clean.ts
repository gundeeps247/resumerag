/**
 * Text cleaning helpers shared by all parsers.
 *
 * Raw text coming out of PDFs and Word files is messy: ligatures ("fi" as one glyph),
 * non-breaking spaces, invisible characters, words hyphenated across lines, and a zoo
 * of bullet glyphs. Cleaning makes both keyword search and embeddings more reliable.
 *
 * Character classes are written as \u escapes so no invisible characters live in the source.
 */

// Bullet glyphs commonly emitted by Word / PDF exporters, including the private-use
// "Symbol" font bullets U+F0B7 / U+F0A7 that Word uses for default bullets.
const BULLET_GLYPHS =
  "\\u2022\\u25CF\\u25AA\\u25A0\\u25A1\\u25E6\\u2023\\u2219\\u00B7\\u2043\\u27A2\\u27A4\\u25BA\\u25B6\\u2713\\u2714\\uF0B7\\uF0A7";
const BULLET_PREFIX = new RegExp(`^\\s*(?:[${BULLET_GLYPHS}]|[-*+\\u2013\\u2014](?=\\s))\\s*`);
const NUMBERED_PREFIX = /^\s*(?:\d{1,2}|[a-hA-H])[.)]\s+/;

const ZERO_WIDTH = new RegExp("[\\u200B-\\u200D\\uFEFF\\u00AD]", "g");
const NBSP = new RegExp("[\\u00A0\\u2007\\u202F]", "g");
const SINGLE_QUOTES = new RegExp("[\\u2018\\u2019\\u201B\\u2032]", "g");
const DOUBLE_QUOTES = new RegExp("[\\u201C\\u201D\\u201F\\u2033]", "g");
const DASH_VARIANTS = new RegExp("[\\u2010\\u2011]", "g");
// C0 control characters except tab (09) and newline (0A), plus DEL (7F).
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

/** Normalises unicode and whitespace without changing the visible meaning of the text. */
export function normalizeText(input: string): string {
  return (
    input
      // NFKC folds ligatures and full-width characters into their plain equivalents.
      .normalize("NFKC")
      .replace(/\r\n?/g, "\n")
      .replace(ZERO_WIDTH, "")
      .replace(NBSP, " ")
      .replace(SINGLE_QUOTES, "'")
      .replace(DOUBLE_QUOTES, '"')
      .replace(DASH_VARIANTS, "-")
      .replace(CONTROL_CHARS, "")
      .replace(/[^\S\n]+/g, " ")
  );
}

/** Trims and collapses whitespace inside a single line. */
export function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

export interface BulletInfo {
  isBullet: boolean;
  text: string;
}

/** Detects list-item markers ("• ", "- ", "1. ") and strips them. */
export function stripBullet(line: string): BulletInfo {
  const bullet = line.match(BULLET_PREFIX);
  if (bullet) return { isBullet: true, text: cleanLine(line.slice(bullet[0].length)) };
  const numbered = line.match(NUMBERED_PREFIX);
  if (numbered) return { isBullet: true, text: cleanLine(line.slice(numbered[0].length)) };
  return { isBullet: false, text: cleanLine(line) };
}

/**
 * Joins two lines of a paragraph, repairing words split by end-of-line hyphenation
 * ("predic-" + "tion" becomes "prediction") while keeping real hyphens ("real-time").
 */
export function joinLines(previous: string, next: string): string {
  if (/[a-z]-$/.test(previous) && /^[a-z]/.test(next)) {
    return previous.slice(0, -1) + next;
  }
  return `${previous} ${next}`;
}

/** Heuristic: is this line an all-caps section header such as "EXPERIENCE"? */
export function isAllCapsHeading(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, "");
  const visible = line.replace(/\s/g, "");
  // Mostly letters: "2021 - 2025 | CGPA: 8.7/10" is data, not a heading.
  if (letters.length < 3 || line.length > 60 || letters.length < visible.length * 0.7) return false;
  return letters === letters.toUpperCase() && /[A-Z]/.test(letters);
}

/** Short line ending in a colon ("Requirements:"), a common heading style in plain text. */
export function isColonHeading(line: string): boolean {
  const words = line.split(/\s+/).length;
  return words <= 6 && /^[A-Z][^.!?]*:$/.test(line);
}

/** Collapses 3+ newlines and trims; used before storing full document text. */
export function tidyWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
