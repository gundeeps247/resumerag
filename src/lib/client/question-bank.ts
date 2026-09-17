"use client";

import { getDb } from "@/lib/db/schema";
import type { Difficulty, QuestionCategory, SavedQuestion } from "@/lib/db/records";
import { newId } from "@/lib/format";

export async function saveQuestion(input: {
  question: string;
  category: QuestionCategory;
  difficulty: Difficulty;
  whyAsked?: string;
  sourceChunkIds?: string[];
  origin: string;
}): Promise<boolean> {
  const db = getDb();
  const exists = await db.questions.filter((q) => q.question.trim().toLowerCase() === input.question.trim().toLowerCase()).first();
  if (exists) return false;
  const record: SavedQuestion = {
    id: newId(),
    question: input.question,
    category: input.category,
    difficulty: input.difficulty,
    whyAsked: input.whyAsked,
    sourceChunkIds: input.sourceChunkIds ?? [],
    status: "new",
    origin: input.origin,
    createdAt: Date.now(),
  };
  await db.questions.add(record);
  return true;
}
