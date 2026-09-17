/**
 * Which models the browser may request through the server's LLM proxy.
 *
 * Settings lets a user pick a model, and /api/llm/chat forwards that name to the provider. For
 * Ollama on your own machine that is harmless. On a public deployment with a hosted API key it
 * is not: a visitor could choose any model the key can reach, including expensive ones. Hosted
 * providers therefore serve only their configured model unless LLM_ALLOWED_MODELS lists more.
 */
export type ServerProviderId = "ollama" | "openai-compatible" | "huggingface" | "none";

/** Returns the permitted model names, or null when any model may be requested. */
export function modelAllowlist(provider: ServerProviderId, defaultModel: string, allowedModels?: string): string[] | null {
  const listed = (allowedModels ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (listed.length > 0) return [...new Set([defaultModel, ...listed].filter(Boolean))];
  return provider === "ollama" ? null : [defaultModel];
}

/** A request without a model uses the provider's default, which is always allowed. */
export function isModelAllowed(allowlist: string[] | null, model: string | undefined): boolean {
  return model === undefined || allowlist === null || allowlist.includes(model);
}
