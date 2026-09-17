/**
 * GET /api/llm/status — which LLM provider the server is configured with, whether it is
 * reachable and which models it offers. Never returns secrets.
 */
import { getServerEnv } from "@/lib/server/env";
import { getServerModelAllowlist, getServerProvider } from "@/lib/server/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = getServerEnv();
  const provider = getServerProvider();
  const common = {
    requiresAccessCode: Boolean(env.APP_ACCESS_CODE),
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
  };

  if (!provider) {
    return Response.json(
      { provider: "none", label: "No LLM configured", model: "", available: false, models: [], ...common },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const status = await provider.status();
  // Only offer models this deployment will actually serve.
  const allowlist = getServerModelAllowlist();
  const models = allowlist ? status.models.filter((m) => allowlist.includes(m)) : status.models;
  return Response.json({ ...status, models, ...common }, { headers: { "Cache-Control": "no-store" } });
}
