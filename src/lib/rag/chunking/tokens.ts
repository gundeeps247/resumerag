/**
 * Cheap token estimate.
 *
 * Embedding models and LLMs split text into "tokens" (word pieces). For English,
 * one token is roughly four characters. Running the real tokenizer for every
 * chunking decision would be slower and model-specific, while an estimate is
 * accurate enough to keep chunks comfortably below the embedding model's 512-token limit.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}
