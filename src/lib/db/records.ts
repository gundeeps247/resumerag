/**
 * Shapes of the records the interview-prep features persist locally.
 */
import type { RetrievalResult } from "@/lib/rag/types";

export interface CitationCheck {
  sentence: string;
  citedSources: number[];
  /** Best cosine similarity between the sentence and any cited (or context) passage sentence. */
  support: number;
  /** Share of content words found in the cited passages. */
  overlap?: number;
  /** Numbers stated in the sentence but absent from its sources. */
  missingNumbers?: string[];
  supported: boolean;
}

export interface AnswerRecordTrace {
  mode: "llm" | "evidence-only" | "refused" | "error";
  originalQuery: string;
  searchQuery: string;
  retrieval: RetrievalResult;
  prompt?: { system: string; user: string; contextTokens: number; sourceCount: number };
  generation?: {
    model: string;
    durationMs: number;
    firstTokenMs?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
  verification?: {
    checks: CitationCheck[];
    supportedRatio: number;
    invalidCitations: number[];
  };
  error?: string;
}

export type QuestionCategory = "recruiter" | "technical" | "project" | "behavioral" | "ai_ml" | "system_design" | "follow_up" | "challenge";

export type Difficulty = "easy" | "medium" | "hard";

export interface SavedQuestion {
  id: string;
  question: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  whyAsked?: string;
  sourceChunkIds: string[];
  status: "new" | "practicing" | "confident";
  origin: string;
  createdAt: number;
}

export interface MockTurn {
  question: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  answer?: string;
  evaluation?: {
    overall: number;
    scores: Record<string, number>;
    strengths: string[];
    improvements: string[];
    unsupportedClaims: string[];
    betterAnswerOutline: string;
  };
  evidenceChunkIds: string[];
}

export interface MockSessionRecord {
  id: string;
  title: string;
  focus: string;
  status: "active" | "completed";
  createdAt: number;
  updatedAt: number;
  turns: MockTurn[];
  summary?: { overall: number; strengths: string[]; focusAreas: string[] };
}

export interface SavedAnalysis {
  id: string;
  kind: "resume-xray" | "jd-match" | "deep-dive" | "consistency" | "star" | "questions";
  title: string;
  createdAt: number;
  /** Knowledge-base version the analysis was computed on (to flag stale results). */
  kbVersion: number;
  result: unknown;
}
