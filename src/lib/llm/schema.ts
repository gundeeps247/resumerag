/**
 * Request validation for the LLM proxy. Shared by the API route (server) and its tests.
 */
import { z } from "zod";

export const MAX_MESSAGE_CHARS = 48_000;
export const MAX_TOTAL_CHARS = 120_000;

export const chatRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string().max(MAX_MESSAGE_CHARS),
        }),
      )
      .min(1)
      .max(40),
    temperature: z.number().min(0).max(1.5).optional(),
    maxTokens: z.number().int().min(16).max(8192).optional(),
    json: z.union([z.boolean(), z.object({ schema: z.record(z.string(), z.unknown()) })]).optional(),
    model: z
      .string()
      .regex(/^[\w.:/@-]{1,120}$/, "Invalid model name")
      .optional(),
  })
  .refine((body) => body.messages.reduce((n, m) => n + m.content.length, 0) <= MAX_TOTAL_CHARS, {
    message: `Conversation exceeds ${MAX_TOTAL_CHARS} characters`,
  });

export type ChatRequest = z.infer<typeof chatRequestSchema>;
