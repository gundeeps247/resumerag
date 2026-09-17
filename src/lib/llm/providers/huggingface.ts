/**
 * Hugging Face Inference Providers (optional).
 *
 * Hugging Face exposes open-weight models (Qwen, Llama, Mistral…) through an
 * OpenAI-compatible router, so this provider is a thin preset over the
 * OpenAI-compatible one. Requires a (free) HF access token; free accounts get a small
 * monthly credit, so treat it as a convenience for hosted demos, not a dependency.
 */
import type { ProviderId } from "../types";
import { OpenAICompatibleProvider } from "./openai-compatible";

export const HF_ROUTER_URL = "https://router.huggingface.co/v1";

export class HuggingFaceProvider extends OpenAICompatibleProvider {
  override readonly id: ProviderId = "huggingface";

  constructor(config: { token: string; model: string; baseUrl?: string }) {
    super({
      baseUrl: config.baseUrl ?? HF_ROUTER_URL,
      apiKey: config.token,
      model: config.model,
      label: "Hugging Face Inference",
    });
  }
}
