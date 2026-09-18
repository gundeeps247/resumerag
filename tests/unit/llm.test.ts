import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMissingCommas, extractJson, parseWithSchema } from "@/lib/llm/json";
import { OllamaProvider } from "@/lib/llm/providers/ollama";
import { OpenAICompatibleProvider } from "@/lib/llm/providers/openai-compatible";
import { BROWSER_MODELS, browserModelWeightsUrl, DEFAULT_BROWSER_MODEL_ID, getBrowserModel } from "@/lib/llm/browser-models";
import {
  fetchLlmStatus,
  type LlmStatus,
  NO_SERVER_PROVIDER_MESSAGE,
  rememberServerStatus,
  resolveMode,
  serverIsUsable,
  streamChat,
} from "@/lib/llm/client";
import { migrateSettings } from "@/lib/client/settings";
import { createAsyncQueue } from "@/lib/llm/stream";
import { fallbackReason } from "@/lib/workflows/common";
import { isModelAllowed, modelAllowlist } from "@/lib/llm/model-policy";
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

  it("repairs a missing separator between values", () => {
    // Observed from a 1.2B model: an array item and an object member with no comma.
    expect(extractJson('{"strengths":["clear structure" "good numbers"]}')).toEqual({ strengths: ["clear structure", "good numbers"] });
    expect(extractJson('{"scores":{"relevance":3 "clarity":4}}')).toEqual({ scores: { relevance: 3, clarity: 4 } });
    expect(extractJson('{"items":[{"a":1} {"b":2}]}')).toEqual({ items: [{ a: 1 }, { b: 2 }] });
    // Valid JSON, including strings that contain braces and quotes, must be untouched.
    expect(extractJson('{"a":"he said \\"hi\\" {not json}","b":[1,2]}')).toEqual({ a: 'he said "hi" {not json}', b: [1, 2] });
    expect(addMissingCommas('{"a": {"b": 1}}')).toBe('{"a": {"b": 1}}');
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

describe("automatic connection mode", () => {
  const serverStatus = (patch: Record<string, unknown>) =>
    Response.json({ provider: "ollama", label: "Ollama", model: "m", available: true, models: ["m"], ...patch });

  /** The client caches the server status for 30 s; drop it so the next case re-checks. */
  const expireStatusCache = () => rememberServerStatus(null);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rememberServerStatus(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    rememberServerStatus(null);
  });

  it("uses the server when it has a reachable model, and the in-browser model otherwise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => serverStatus({})),
    );
    await expect(resolveMode({ mode: "auto" })).resolves.toBe("server");

    // No provider configured (the default on Vercel) → generate in the browser instead.
    expireStatusCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => serverStatus({ provider: "none", available: false })),
    );
    await expect(resolveMode({ mode: "auto" })).resolves.toBe("in-browser");

    // Provider configured but unreachable (Ollama not running) → also the browser.
    expireStatusCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => serverStatus({ available: false, error: "not reachable" })),
    );
    await expect(resolveMode({ mode: "auto" })).resolves.toBe("in-browser");

    // Status endpoint itself failing must not leave the app without a model.
    expireStatusCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(resolveMode({ mode: "auto" })).resolves.toBe("in-browser");
  });

  it("reuses a fresh status instead of re-checking the server on every prompt", async () => {
    const fetchMock = vi.fn(async () => serverStatus({}));
    vi.stubGlobal("fetch", fetchMock);
    expireStatusCache();
    await resolveMode({ mode: "auto" });
    await resolveMode({ mode: "auto" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expireStatusCache();
    await resolveMode({ mode: "auto" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not spend a protected deployment's quota without its access code", () => {
    const protectedServer: LlmStatus = {
      provider: "openai-compatible",
      label: "Hosted",
      model: "m",
      available: true,
      models: [],
      requiresAccessCode: true,
    };
    expect(serverIsUsable({ ...protectedServer }, {})).toBe(false);
    expect(serverIsUsable({ ...protectedServer }, { accessCode: "secret" })).toBe(true);
    expect(serverIsUsable({ ...protectedServer, requiresAccessCode: false }, {})).toBe(true);
    expect(serverIsUsable(null, { accessCode: "secret" })).toBe(false);
  });

  it("explicit modes are never overridden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => serverStatus({})),
    );
    await expect(resolveMode({ mode: "in-browser" })).resolves.toBe("in-browser");
    await expect(resolveMode({ mode: "browser-ollama" })).resolves.toBe("browser-ollama");
  });
});

describe("fallback wording", () => {
  it("distinguishes a missing model from a model that answered badly", () => {
    expect(fallbackReason("No LLM provider is configured on the server (LLM_PROVIDER=none).")).toBe("no language model was reachable");
    expect(fallbackReason("Cannot reach Ollama at http://localhost:11434.")).toBe("no language model was reachable");
    expect(fallbackReason("Model output did not match the expected format (scores.evidence)")).toBe(
      "the language model did not return usable JSON",
    );
    expect(fallbackReason("The language model request failed.")).toBe("the language model could not complete the request");
    expect(fallbackReason(undefined)).toBe("generated without a language model");
  });
});

describe("in-browser model registry", () => {
  it("falls back to the default model for unknown ids", () => {
    expect(getBrowserModel(undefined).id).toBe(DEFAULT_BROWSER_MODEL_ID);
    expect(getBrowserModel("nonexistent/model").id).toBe(DEFAULT_BROWSER_MODEL_ID);
    expect(getBrowserModel(BROWSER_MODELS[0].id).id).toBe(BROWSER_MODELS[0].id);
  });

  it("only offers 4-bit builds with 32-bit activations (q4f16 was numerically broken on some GPUs)", () => {
    for (const model of BROWSER_MODELS) {
      expect(browserModelWeightsUrl(model.id)).toContain("model_q4.onnx");
      expect(model.downloadMb).toBeGreaterThan(0);
      expect(model.license).toBeTruthy();
    }
  });
});

describe("settings migration", () => {
  it("moves the old server-only default to automatic, keeping explicit choices", () => {
    expect(migrateSettings({}).llm.mode).toBe("auto");
    // Saved by version 1, where "server" was merely the default.
    expect(migrateSettings({ llm: { mode: "server" } }).llm.mode).toBe("auto");
    // Chosen deliberately after the upgrade.
    expect(migrateSettings({ version: 2, llm: { mode: "server" } }).llm.mode).toBe("server");
    expect(migrateSettings({ llm: { mode: "browser-ollama" } }).llm.mode).toBe("browser-ollama");
    // Unrelated saved settings survive.
    expect(migrateSettings({ temperature: 0.7 }).temperature).toBe(0.7);
    expect(migrateSettings({}).version).toBe(2);
  });
});

describe("createAsyncQueue", () => {
  it("delivers pushed items, then ends", async () => {
    const queue = createAsyncQueue<string>();
    queue.push("a");
    queue.push("b");
    queue.close();
    expect(await collect(queue[Symbol.asyncIterator]())).toEqual(["a", "b"]);
  });

  it("waits for items pushed later and surfaces failures after draining", async () => {
    const queue = createAsyncQueue<number>();
    const collected = collect(queue[Symbol.asyncIterator]());
    queue.push(1);
    await new Promise((r) => setTimeout(r, 0));
    queue.push(2);
    queue.fail(new Error("worker crashed"));
    await expect(collected).rejects.toThrow("worker crashed");
  });
});

describe("model allowlist", () => {
  it("lets local Ollama use any model but pins hosted providers to their configured model", () => {
    expect(isModelAllowed(modelAllowlist("ollama", "qwen2.5:7b-instruct"), "llama3.2")).toBe(true);

    const hosted = modelAllowlist("openai-compatible", "llama-3.1-8b-instant");
    expect(hosted).toEqual(["llama-3.1-8b-instant"]);
    expect(isModelAllowed(hosted, "llama-3.1-8b-instant")).toBe(true);
    expect(isModelAllowed(hosted, "some-expensive-model")).toBe(false);
    expect(isModelAllowed(hosted, undefined)).toBe(true);
  });

  it("adds LLM_ALLOWED_MODELS to the default, trimming and de-duplicating", () => {
    const list = modelAllowlist("huggingface", "Qwen/Qwen2.5-7B-Instruct", " meta-llama/Llama-3.1-8B-Instruct, Qwen/Qwen2.5-7B-Instruct ,");
    expect(list).toEqual(["Qwen/Qwen2.5-7B-Instruct", "meta-llama/Llama-3.1-8B-Instruct"]);
    expect(isModelAllowed(modelAllowlist("ollama", "qwen2.5:7b-instruct", "llama3.2"), "mistral")).toBe(false);
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
