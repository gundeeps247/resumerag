import "server-only";
import { z } from "zod";

/**
 * Server-side configuration, validated once with zod.
 * Secrets (API keys) are only ever read here, in server code, and never sent to the browser.
 */
/**
 * Without an explicit LLM_PROVIDER, local development talks to Ollama on this machine. On Vercel
 * there is no Ollama next to the serverless function, so the default is "none": the deployed site
 * works with zero configuration (evidence-only answers, or each visitor's own Ollama in private mode).
 */
const DEFAULT_PROVIDER = process.env.VERCEL ? "none" : "ollama";

const schema = z.object({
  LLM_PROVIDER: z.enum(["ollama", "openai-compatible", "huggingface", "none"]).default(DEFAULT_PROVIDER),

  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen2.5:7b-instruct"),
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).max(131072).default(8192),

  OPENAI_COMPAT_BASE_URL: z.string().url().optional(),
  OPENAI_COMPAT_API_KEY: z.string().optional(),
  OPENAI_COMPAT_MODEL: z.string().default("llama-3.1-8b-instant"),

  HF_TOKEN: z.string().optional(),
  HF_MODEL: z.string().default("Qwen/Qwen2.5-7B-Instruct"),

  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8192).default(1500),
  /** Comma-separated extra models visitors may select. Hosted providers otherwise serve only their default model. */
  LLM_ALLOWED_MODELS: z.string().optional(),
  /** Optional shared secret protecting the LLM proxy on public deployments. */
  APP_ACCESS_CODE: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(30),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  // Treat empty strings from .env files as "not set".
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
