import { describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "@/lib/types";
import { ChatTurnStoppedError } from "@/lib/chat-turn-control";
import { isTransientMidStreamError, withStreamRetry } from "@/lib/provider-retry";

vi.mock("@/lib/constants", () => ({
  MAX_STREAM_RETRIES_PRE: 2,
  MAX_STREAM_RETRIES_POST: 1,
  STREAM_RETRY_TOTAL_TIMEOUT_MS: 10_000,
  STREAM_RETRY_BASE_DELAY_MS: 1
}));

type Result = { answer: string; thinking: string; toolCalls: unknown[]; usage: Record<string, unknown> };

const FINAL: Result = { answer: "done", thinking: "", toolCalls: [], usage: {} };

function answerDelta(text: string): ChatStreamEvent {
  return { type: "answer_delta", text };
}

function statusError(status: number, message = `HTTP ${status}`): Error {
  return Object.assign(new Error(message), { status });
}

function connError(message = "fetch failed"): Error {
  return new Error(message);
}

function retryAfterError(seconds: number): Error {
  return Object.assign(new Error("slow_down"), {
    status: 429,
    headers: new Headers({ "retry-after": String(seconds) })
  });
}

type Attempt = { events?: ChatStreamEvent[]; error?: Error; result?: Result };

function makeFactory(attempts: Attempt[], invocations?: { count: number }) {
  return () => {
    if (invocations) invocations.count += 1;
    const spec = attempts.shift() ?? { result: FINAL };
    return (async function* () {
      for (const event of spec.events ?? []) {
        yield event;
      }
      if (spec.error) throw spec.error;
      return spec.result ?? FINAL;
    })();
  };
}

function alwaysFailingFactory(error: Error, invocations?: { count: number }) {
  return () => {
    if (invocations) invocations.count += 1;
    return (async function* () {
      throw error;
    })();
  };
}

async function consume<T>(gen: AsyncGenerator<ChatStreamEvent, T>): Promise<{ events: ChatStreamEvent[]; value: T }> {
  const events: ChatStreamEvent[] = [];
  while (true) {
    const next = await gen.next();
    if (next.done) {
      return { events, value: next.value };
    }
    events.push(next.value);
  }
}

describe("isTransientMidStreamError", () => {
  it("retries retryable status codes", () => {
    expect(isTransientMidStreamError(statusError(408))).toBe(true);
    expect(isTransientMidStreamError(statusError(409))).toBe(true);
    expect(isTransientMidStreamError(statusError(429))).toBe(true);
    expect(isTransientMidStreamError(statusError(500))).toBe(true);
    expect(isTransientMidStreamError(statusError(502))).toBe(true);
    expect(isTransientMidStreamError(statusError(503))).toBe(true);
    expect(isTransientMidStreamError(statusError(529))).toBe(true);
  });

  it("does not retry non-retryable status codes", () => {
    expect(isTransientMidStreamError(statusError(400))).toBe(false);
    expect(isTransientMidStreamError(statusError(401))).toBe(false);
    expect(isTransientMidStreamError(statusError(403))).toBe(false);
    expect(isTransientMidStreamError(statusError(404))).toBe(false);
    expect(isTransientMidStreamError(statusError(422))).toBe(false);
  });

  it("retries connection-drop messages when no status is present", () => {
    expect(isTransientMidStreamError(connError("fetch failed"))).toBe(true);
    expect(isTransientMidStreamError(connError("ECONNRESET"))).toBe(true);
    expect(isTransientMidStreamError(connError("socket hang up"))).toBe(true);
    expect(isTransientMidStreamError(connError("The connection was terminated abnormally"))).toBe(true);
  });

  it("surfaces unknown errors without a status", () => {
    expect(isTransientMidStreamError(new Error("something unusual"))).toBe(false);
    expect(isTransientMidStreamError({})).toBe(false);
    expect(isTransientMidStreamError(null)).toBe(false);
  });

  it("never retries user aborts", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isTransientMidStreamError(abort)).toBe(false);
    expect(isTransientMidStreamError(new ChatTurnStoppedError())).toBe(false);

    const controller = new AbortController();
    controller.abort();
    expect(isTransientMidStreamError(connError("fetch failed"), controller.signal)).toBe(false);
  });
});

describe("withStreamRetry", () => {
  it("passes through a successful stream without retry", async () => {
    const invocations = { count: 0 };
    const factory = makeFactory(
      [{ events: [answerDelta("hello"), answerDelta(" world")], result: FINAL }],
      invocations
    );
    const { events, value } = await consume(withStreamRetry(factory));
    expect(events).toEqual([answerDelta("hello"), answerDelta(" world")]);
    expect(value).toBe(FINAL);
    expect(invocations.count).toBe(1);
  });

  it("retries a pre-output transient failure without emitting stream_retry", async () => {
    const invocations = { count: 0 };
    const factory = makeFactory(
      [
        { events: [], error: connError("fetch failed") },
        { events: [answerDelta("recovered")], result: FINAL }
      ],
      invocations
    );
    const { events, value } = await consume(withStreamRetry(factory));
    expect(events).toEqual([answerDelta("recovered")]);
    expect(value).toBe(FINAL);
    expect(invocations.count).toBe(2);
  });

  it("emits stream_retry and re-streams after a post-output transient failure", async () => {
    const invocations = { count: 0 };
    const factory = makeFactory(
      [
        { events: [answerDelta("partial")], error: connError("fetch failed") },
        { events: [answerDelta("full answer")], result: FINAL }
      ],
      invocations
    );
    const { events, value } = await consume(withStreamRetry(factory));
    expect(events).toEqual([
      answerDelta("partial"),
      { type: "stream_retry", attempt: 1 },
      answerDelta("full answer")
    ]);
    expect(value).toBe(FINAL);
    expect(invocations.count).toBe(2);
  });

  it("does not retry a non-transient error and rethrows the original", async () => {
    const invocations = { count: 0 };
    const original = statusError(400, "bad_request");
    const factory = alwaysFailingFactory(original, invocations);
    await expect(consume(withStreamRetry(factory))).rejects.toBe(original);
    expect(invocations.count).toBe(1);
  });

  it("does not retry when the signal is already aborted", async () => {
    const invocations = { count: 0 };
    const controller = new AbortController();
    controller.abort();
    const factory = alwaysFailingFactory(connError("fetch failed"), invocations);
    await expect(consume(withStreamRetry(factory, { signal: controller.signal }))).rejects.toBeInstanceOf(Error);
    expect(invocations.count).toBe(1);
  });

  it("exhausts the pre-output budget (2 retries) and rethrows the original", async () => {
    const invocations = { count: 0 };
    const original = connError("fetch failed");
    const factory = alwaysFailingFactory(original, invocations);
    await expect(consume(withStreamRetry(factory))).rejects.toBe(original);
    expect(invocations.count).toBe(3);
  });

  it("caps post-output retries at one", async () => {
    const invocations = { count: 0 };
    const factory = makeFactory(
      [
        { events: [answerDelta("a")], error: connError("fetch failed") },
        { events: [answerDelta("b")], error: connError("fetch failed") }
      ],
      invocations
    );
    await expect(consume(withStreamRetry(factory))).rejects.toThrow("fetch failed");
    expect(invocations.count).toBe(2);
  });

  it("throws ChatTurnStoppedError when aborted during the backoff sleep", async () => {
    const controller = new AbortController();
    const factory = makeFactory([
      { events: [], error: retryAfterError(0.05) },
      { events: [answerDelta("ok")], result: FINAL }
    ]);
    const promise = consume(withStreamRetry(factory, { signal: controller.signal }));
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toBeInstanceOf(ChatTurnStoppedError);
  });

  it("honors the Retry-After header for the backoff delay", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const factory = makeFactory([
      { events: [], error: retryAfterError(0.03) },
      { events: [answerDelta("ok")], result: FINAL }
    ]);
    const { value } = await consume(withStreamRetry(factory));
    const delays = spy.mock.calls
      .map((call) => call[1])
      .filter((delay): delay is number => typeof delay === "number");
    expect(delays).toContain(30);
    expect(value).toBe(FINAL);
    spy.mockRestore();
  });
});
