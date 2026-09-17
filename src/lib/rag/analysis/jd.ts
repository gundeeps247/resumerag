/**
 * Job-description parsing: turns a JD into a list of individual requirements, each
 * tagged as required / preferred / responsibility. Every requirement is then matched
 * against the candidate's documents one by one (multi-query retrieval).
 */
import type { TextBlock } from "../types";
import { extractSkills } from "./skills";

export type Importance = "required" | "preferred" | "responsibility";

export interface JdRequirement {
  id: string;
  text: string;
  importance: Importance;
  section: string;
  skills: string[];
}

const SECTION_RULES: { pattern: RegExp; importance: Importance | null }[] = [
  { pattern: /nice to have|preferred|bonus|plus|desirable|good to have/i, importance: "preferred" },
  {
    pattern: /requirement|qualification|must have|what you('|’)?ll need|you have|who you are|skills|what we('|’)?re looking for/i,
    importance: "required",
  },
  { pattern: /responsibilit|what you('|’)?ll do|what you will do|the role|day to day|you will/i, importance: "responsibility" },
  { pattern: /offer|benefit|perks|about us|about the company|equal opportunity|compensation|how to apply|location/i, importance: null },
];

function sectionImportance(heading: string): Importance | null | undefined {
  return SECTION_RULES.find((r) => r.pattern.test(heading))?.importance;
}

export function extractRequirements(blocks: TextBlock[]): JdRequirement[] {
  const requirements: JdRequirement[] = [];
  let section = "";
  let importance: Importance | null = "required";

  for (const block of blocks) {
    if (block.kind === "heading") {
      section = block.text;
      const detected = sectionImportance(block.text);
      importance = detected === undefined ? importance : detected;
      continue;
    }
    if (!importance) continue;
    const candidates =
      block.kind === "list_item"
        ? [block.text]
        : block.text
            .split(/(?<=[.!?])\s+(?=[A-Z])/)
            // In prose, only sentences addressed to the candidate describe requirements.
            .filter((s) => extractSkills(s).length > 0 && /\b(you|your|experience|required|must|should|will|ability)\b/i.test(s));
    for (const text of candidates) {
      const trimmed = text.trim();
      if (trimmed.split(/\s+/).length < 3) continue;
      requirements.push({
        id: `r${requirements.length + 1}`,
        text: trimmed,
        importance,
        section,
        skills: extractSkills(trimmed).map((s) => s.name),
      });
    }
  }
  return requirements;
}

/** Detects sentences that state a skill is *missing* ("I have not used MLflow"). */
export function statesAbsence(text: string): boolean {
  return /\b(have not|haven't|never|no (?:hands-on |real )?experience|not (?:yet )?used|only (?:used|tried) [\w\s]{0,30}in a tutorial|limited to|want to learn)\b/i.test(
    text,
  );
}
