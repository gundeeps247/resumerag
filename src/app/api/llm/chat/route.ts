/**
 * POST /api/llm/chat — streaming LLM proxy.
 *
 * The browser does retrieval locally and sends the finished prompt here; this route
 * forwards it to the configured provider and streams tokens back as NDJSON. Keeping the
 * provider call on the server means API keys (if any) never reach the browser.
 */
import { chatRequestSchema } from "@/lib/llm/schema";
import { ProviderError, type StreamEvent } from "@/lib/llm/types";
import { getServerEnv } from "@/lib/server/env";
import { getServerProvider } from "@/lib/server/provider";
import { RateLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
// Matches vercel.json; 60 s is allowed on every Vercel plan. Hosted providers answer well
// within it — slow local models are reached directly from the browser instead.
export const maxDuration = 60;

let limiter: RateLimiter | undefined;

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const env = getServerEnv();

  if (env.APP_ACCESS_CODE && request.headers.get("x-access-code") !== env.APP_ACCESS_CODE) {
    return jsonError(401, "This deployment requires an access code (Settings → Model).");
  }

  limiter ??= new RateLimiter(env.RATE_LIMIT_PER_MINUTE);
  if (!limiter.check(clientKey(request))) {
    return jsonError(429, "Too many requests. Please wait a minute and try again.");
  }

  const provider = getServerProvider();
  if (!provider) return jsonError(503, "No LLM provider is configured on the server (LLM_PROVIDER=none).");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be JSON.");
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request.");

  const { messages, temperature, maxTokens, json, model } = parsed.data;
  const encoder = new TextEncoder();

  // The browser may disconnect mid-answer (tab closed, user pressed stop, stall timeout).
  // After that, writing to or closing the stream throws, so both are guarded.
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        for await (const event of provider.streamChat(messages, {
          temperature,
          maxTokens: Math.min(maxTokens ?? env.LLM_MAX_OUTPUT_TOKENS, env.LLM_MAX_OUTPUT_TOKENS),
          json,
          model,
          signal: request.signal,
        })) {
          send(event);
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          const message = error instanceof ProviderError ? error.message : "The language model request failed.";
          console.error("[llm/chat]", error);
          send({ type: "error", message });
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
