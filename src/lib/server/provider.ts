import "server-only";
import { HuggingFaceProvider } from "@/lib/llm/providers/huggingface";
import { OllamaProvider } from "@/lib/llm/providers/ollama";
import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";
import { modelAllowlist } from "@/lib/llm/model-policy";
import type { LLMProvider } from "@/lib/llm/types";
import { getServerEnv } from "./env";

/** Builds the LLM provider selected by environment variables (LLM_PROVIDER). */
export function getServerProvider(): LLMProvider | null {
  const env = getServerEnv();
  switch (env.LLM_PROVIDER) {
    case "ollama":
      return new OllamaProvider({ baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_MODEL, numCtx: env.OLLAMA_NUM_CTX });
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        baseUrl: env.OPENAI_COMPAT_BASE_URL ?? "",
        apiKey: env.OPENAI_COMPAT_API_KEY,
        model: env.OPENAI_COMPAT_MODEL,
      });
    case "huggingface":
      return new HuggingFaceProvider({ token: env.HF_TOKEN ?? "", model: env.HF_MODEL });
    case "none":
      return null;
  }
}

/** Models the browser may request on this deployment (null = any). See model-policy.ts. */
export function getServerModelAllowlist(): string[] | null {
  const env = getServerEnv();
  const defaults = { ollama: env.OLLAMA_MODEL, "openai-compatible": env.OPENAI_COMPAT_MODEL, huggingface: env.HF_MODEL, none: "" };
  return modelAllowlist(env.LLM_PROVIDER, defaults[env.LLM_PROVIDER], env.LLM_ALLOWED_MODELS);
}
