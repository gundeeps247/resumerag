import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJson, parseWithSchema } from "@/lib/llm/json";
import { OllamaProvider } from "@/lib/llm/providers/ollama";
import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";
import { fetchLlmStatus, NO_SERVER_PROVIDER_MESSAGE, streamChat } from "@/lib/llm/client";
import { chatRequestSchema } from "@/lib/llm/schema";
import { readNdjson, readSse, withStallTimeout } from "@/lib/llm/stream";
import type { StreamEvent } from "@/lib/llm/types";
import { RateLimiter } from "@/lib/server/rate-limit";
import { z } from "zod";

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe("withStallTimeout", () => {
  /** Yields the given items, then waits until aborted. */
  function hangingSource(...items: number[]) {
    return async function* (signal: AbortSignal) {
      for (const item of items) yield item;
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    };
  }

  it("passes items through and aborts a source that stops producing", async () => {
    const seen: number[] = [];
    const run = async () => {
      for await (const n of withStallTimeout(hangingSource(1, 2), { firstMs: 200, idleMs: 20 })) seen.push(n);
    };
    await expect(run()).rejects.toMatchObject({ name: "StallError", message: expect.stringMatching(/stopped responding/) });
    expect(seen).toEqual([1, 2]);
  });

  it("finishes normally when the source completes, and keeps a caller abort as AbortError", async () => {
    async function* finite() {
      yield 1;
    }
    expect(await collect(withStallTimeout(finite, { firstMs: 50, idleMs: 50 }))).toEqual([1]);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(
      collect(withStallTimeout(hangingSource(), { signal: controller.signal, firstMs: 5_000, idleMs: 5_000 })),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("extractJson", () => {
  it("parses plain JSON, fenced JSON and JSON with chatter around it", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('Sure! Here it is: {"ok":true} Hope this helps.')).toEqual({ ok: true });
  });

  it("repairs output that was cut off mid-way", () => {
    expect(extractJson('{"questions":["one","two","thr')).toEqual({ questions: ["one", "two", "thr"] });
  });

  it("validates the shape with zod", () => {
    const schema = z.object({ score: z.number().min(1).max(5) });
    expect(parseWithSchema('{"score":4}', schema)).toEqual({ score: 4 });
    expect(() => parseWithSchema('{"score":9}', schema)).toThrow(/expected format/);
  });
});

describe("stream readers", () => {
  it("reads NDJSON split across network chunks", async () => {
    const items = await collect(readNdjson<{ n: number }>(streamOf('{"n":1}\n{"n"', ":2}\n", '{"n":3}')));
    expect(items.map((i) => i.n)).toEqual([1, 2, 3]);
  });

  it("reads SSE and stops at [DONE]", async () => {
    const items = await collect(
      readSse<{ v: string }>(streamOf('data: {"v":"a"}\n\n: keep-alive\n', 'data: {"v":"b"}\n\ndata: [DONE]\n\ndata: {"v":"c"}\n')),
    );
    expect(items.map((i) => i.v)).toEqual(["a", "b"]);
  });
});

describe("OllamaProvider", () => {
  it("streams deltas and reports token usage", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          streamOf(
            '{"message":{"content":"Hel"},"done":false}\n',
            '{"message":{"content":"lo"},"done":false}\n{"message":{"content":""},"done":true,"prompt_eval_count":12,"eval_count":2}\n',
          ),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", model: "qwen2.5:7b-instruct" });
    const events = await collect(provider.streamChat([{ role: "user", content: "hi" }], { json: { schema: { type: "object" } } }));

    const text = events
      .filter((e): e is Extract<StreamEvent, { type: "delta" }> => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(text).toBe("Hello");
    expect(events.at(-1)).toMatchObject({ type: "done", promptTokens: 12, completionTokens: 2 });

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.format).toEqual({ type: "object" });
    expect(body.options.num_ctx).toBe(8192);
  });

  it("explains how to fix a missing model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ models: [{ name: "llama3.2:latest" }] })),
    );
    const status = await new OllamaProvider({ baseUrl: "http://x", model: "qwen2.5:7b-instruct" }).status();
    expect(status.available).toBe(false);
    expect(status.error).toContain("ollama pull qwen2.5:7b-instruct");
  });
});

describe("OpenAICompatibleProvider", () => {
  it("parses SSE chunks and sends the bearer token", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          streamOf(
            'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
            'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\ndata: [DONE]\n\n',
          ),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://api.example.com/v1/", apiKey: "secret", model: "m" });
    const events = await collect(provider.streamChat([{ role: "user", content: "hi" }]));
    expect(events[0]).toEqual({ type: "delta", text: "Hi" });
    expect(events.at(-1)).toMatchObject({ type: "done", promptTokens: 5, completionTokens: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  });
});

describe("LLM client without a server provider", () => {
  it("skips the chat request once the status endpoint reports provider none", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/llm/status")
        return Response.json({ provider: "none", label: "No LLM configured", model: "", available: false, models: [] });
      return Response.json({ error: "unexpected" }, { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await fetchLlmStatus({ mode: "server" });
    expect(status.provider).toBe("none");
    await expect(collect(streamChat({ mode: "server" }, [{ role: "user", content: "hi" }]))).rejects.toThrow(NO_SERVER_PROVIDER_MESSAGE);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/llm/status"]);

    // A later status check that finds a provider re-enables server generation.
    fetchMock.mockImplementation(async () =>
      Response.json({ provider: "ollama", label: "Ollama", model: "m", available: true, models: ["m"] }),
    );
    await fetchLlmStatus({ mode: "server" });
    await collect(streamChat({ mode: "server" }, [{ role: "user", content: "hi" }])).catch(() => undefined);
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain("/api/llm/chat");
  });
});

describe("chatRequestSchema", () => {
  it("accepts a normal request and rejects abuse", () => {
    expect(chatRequestSchema.safeParse({ messages: [{ role: "user", content: "hi" }] }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ messages: [{ role: "tool", content: "x" }] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ messages: [{ role: "user", content: "hi" }], model: "../../etc/passwd;rm" }).success).toBe(false);
    const huge = Array.from({ length: 4 }, () => ({ role: "user" as const, content: "x".repeat(40_000) }));
    expect(chatRequestSchema.safeParse({ messages: huge }).success).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per window", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.check("ip", 0)).toBe(true);
    expect(limiter.check("ip", 10)).toBe(true);
    expect(limiter.check("ip", 20)).toBe(false);
    expect(limiter.check("other", 20)).toBe(true);
    expect(limiter.check("ip", 1500)).toBe(true);
  });
});
