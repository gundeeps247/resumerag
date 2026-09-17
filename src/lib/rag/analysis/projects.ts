/**
 * Project detection: finds the projects and roles a candidate can be asked about, using
 * document structure (headings under "Projects" / "Experience" in resumes, and the titles
 * of project reports). Mentions of the same project in different documents are merged
 * when they share a distinctive name (e.g. "LexiSearch", "Finlytics").
 */
import type { DocType } from "../types";

export interface ProjectChunk {
  id: string;
  docId: string;
  docName: string;
  docType: DocType;
  headingPath: string[];
  text: string;
}

export interface DetectedProject {
  id: string;
  name: string;
  kind: "project" | "experience" | "report";
  chunkIds: string[];
  docIds: string[];
  docNames: string[];
  preview: string;
}

const SECTION_KIND: { pattern: RegExp; kind: DetectedProject["kind"] }[] = [
  { pattern: /project/i, kind: "project" },
  { pattern: /experience|employment|internship|work history/i, kind: "experience" },
];

// Words too generic to identify a project on their own.
const COMMON = new Set(
  (
    "machine learning intern internship engineer engineering software developer development system systems project projects app application web full stack " +
    "fullstack data science scientist analyst analysis prediction predictive model models search semantic real time realtime detection platform tool " +
    "report notes design customer customers based using legal documents document sensors iot anomaly marketplace campus research assistant team"
  ).split(" "),
);

function distinctiveTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !COMMON.has(t));
}

function cleanName(name: string): string {
  return name
    .replace(/\s+[-–—|]\s+(design notes|notes|report|project report)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param docTitles title of each document (its first top-level heading), used to name
 *   project reports — their section headings ("3. Data") are not project names.
 */
export function detectProjects(chunks: ProjectChunk[], docTitles: Record<string, string> = {}): DetectedProject[] {
  const found: DetectedProject[] = [];

  const add = (name: string, kind: DetectedProject["kind"], chunk: ProjectChunk) => {
    const clean = cleanName(name);
    if (clean.length < 3) return;
    const tokens = distinctiveTokens(clean);
    const existing = found.find(
      (p) =>
        p.name.toLowerCase() === clean.toLowerCase() || (tokens.length > 0 && distinctiveTokens(p.name).some((t) => tokens.includes(t))),
    );
    if (existing) {
      if (!existing.chunkIds.includes(chunk.id)) existing.chunkIds.push(chunk.id);
      if (!existing.docIds.includes(chunk.docId)) {
        existing.docIds.push(chunk.docId);
        existing.docNames.push(chunk.docName);
      }
      // Prefer the more descriptive resume heading as the display name.
      if (kind !== "report" && existing.kind === "report") {
        existing.name = clean;
        existing.kind = kind;
      }
      return;
    }
    found.push({
      id: `p${found.length}`,
      name: clean,
      kind,
      chunkIds: [chunk.id],
      docIds: [chunk.docId],
      docNames: [chunk.docName],
      preview: chunk.text.replace(/^- /gm, "").slice(0, 180),
    });
  };

  for (const chunk of chunks) {
    if (chunk.docType === "resume" || chunk.docType === "internship") {
      const path = chunk.headingPath;
      const sectionIndex = path.findIndex((h) => SECTION_KIND.some((s) => s.pattern.test(h)));
      if (sectionIndex >= 0 && sectionIndex < path.length - 1) {
        const kind = SECTION_KIND.find((s) => s.pattern.test(path[sectionIndex]))!.kind;
        add(path[sectionIndex + 1], kind, chunk);
      }
    } else if (chunk.docType === "project_report" || chunk.docType === "research_paper") {
      const title = docTitles[chunk.docId] || chunk.docName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      add(title, "report", chunk);
    }
  }
  return found;
}
