/** Small helpers for reading streamed HTTP responses (NDJSON and Server-Sent Events). */

/** Yields complete lines from a streamed response body. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield line;
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

/** Parses newline-delimited JSON. Invalid lines are skipped. */
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  for await (const line of readLines(body)) {
    try {
      yield JSON.parse(line) as T;
    } catch {
      // ignore partial or malformed lines
    }
  }
}

export class StallError extends Error {
  override name = "StallError";
}

/**
 * Guards a stream against hanging forever: if the source produces nothing for `firstMs`
 * (model loading + prompt processing) or `idleMs` between items, it is aborted and a
 * StallError is thrown. Only time spent waiting on the source counts. A caller's own
 * abort still surfaces as the source's AbortError.
 */
export async function* withStallTimeout<T>(
  start: (signal: AbortSignal) => AsyncIterable<T>,
  options: { signal?: AbortSignal; firstMs: number; idleMs: number },
): AsyncGenerator<T> {
  const controller = new AbortController();
  let stalledAfter = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalledAfter = ms;
      controller.abort();
    }, ms);
  };
  const onCallerAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onCallerAbort();
  else options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  arm(options.firstMs);
  try {
    for await (const item of start(controller.signal)) {
      clearTimeout(timer);
      yield item;
      arm(options.idleMs);
    }
  } catch (error) {
    if (stalledAfter) {
      throw new StallError(
        `The language model stopped responding (no output for ${Math.round(stalledAfter / 1000)} s). ` +
          "It may still be loading, be overloaded, or the connection dropped. Try again, or choose a smaller model in Settings.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}

/** Parses an OpenAI-style SSE stream ("data: {...}" lines, terminated by "data: [DONE]"). */
export async function* readSse<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  for await (const line of readLines(body)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      yield JSON.parse(data) as T;
    } catch {
      // ignore keep-alive comments and malformed chunks
    }
  }
}

/**
 * Turns push-style callbacks (for example tokens arriving from a Web Worker) into an async
 * iterable. `push` queues an item, `close` ends iteration once the queue drains, and `fail`
 * makes the iterator throw.
 */
export function createAsyncQueue<T>() {
  const items: T[] = [];
  let closed = false;
  let failure: { error: unknown } | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  return {
    push(item: T) {
      if (closed) return;
      items.push(item);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    fail(error: unknown) {
      failure ??= { error };
      closed = true;
      notify();
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      while (true) {
        if (items.length) {
          yield items.shift() as T;
          continue;
        }
        if (failure) throw failure.error;
        if (closed) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}
