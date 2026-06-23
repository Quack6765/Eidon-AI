import type { ChatStreamEvent } from "@/lib/types";
import { ChatTurnStoppedError } from "@/lib/chat-turn-control";
import {
  MAX_STREAM_RETRIES_POST,
  MAX_STREAM_RETRIES_PRE,
  STREAM_RETRY_BASE_DELAY_MS,
  STREAM_RETRY_TOTAL_TIMEOUT_MS
} from "@/lib/constants";

const CONNECTION_DROP_RE =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|fetch failed|terminated|abnormal|network|connection reset|premature/i;

const RETRY_AFTER_MAX_MS = 5_000;

export function isTransientMidStreamError(err: unknown, signal?: AbortSignal): boolean {
  if (!(err instanceof Error)) return false;
  if (signal?.aborted) return false;
  if (err.name === "AbortError" || err instanceof ChatTurnStoppedError) return false;

  const status = (err as { status?: number }).status;
  if (typeof status === "number") {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  return CONNECTION_DROP_RE.test(err.message ?? "");
}

function extractRetryAfterMs(err: unknown): number | null {
  const headers = (err as { headers?: unknown } | null)?.headers;
  if (!headers || typeof headers !== "object") return null;

  const headerObj = headers as { get?: (name: string) => string | null } & Record<string, string>;
  const get = typeof headerObj.get === "function"
    ? (name: string) => headerObj.get!(name)
    : (name: string) => headerObj[name.toLowerCase()] ?? null;

  const raw = get("retry-after");
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.min(Math.max(seconds, 0) * 1000, RETRY_AFTER_MAX_MS);
  }

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), RETRY_AFTER_MAX_MS);
  }

  return null;
}

function computeBackoffMs(retryIndex: number, err: unknown): number {
  const retryAfter = extractRetryAfterMs(err);
  if (retryAfter !== null) return retryAfter;

  const ceiling = STREAM_RETRY_BASE_DELAY_MS * 2 ** (retryIndex - 1);
  return Math.random() * ceiling;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new ChatTurnStoppedError());
      return;
    }

    const onAbort = () => {
      clearTimeout(handle);
      reject(new ChatTurnStoppedError());
    };
    const handle = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type StreamFactory<T> = () => AsyncGenerator<ChatStreamEvent, T, void>;

export async function* withStreamRetry<T>(
  factory: StreamFactory<T>,
  options: { signal?: AbortSignal } = {}
): AsyncGenerator<ChatStreamEvent, T, void> {
  const { signal } = options;
  const startedAt = Date.now();
  let preOutputRetries = 0;
  let postOutputRetries = 0;

  for (;;) {
    let emittedAny = false;
    const inner = factory();

    try {
      while (true) {
        const next = await inner.next();
        if (next.done) {
          return next.value;
        }
        emittedAny = true;
        yield next.value;
      }
    } catch (err) {
      if (!isTransientMidStreamError(err, signal)) {
        throw err;
      }

      const isPostOutput = emittedAny;
      const retriesUsed = isPostOutput ? postOutputRetries : preOutputRetries;
      const maxRetries = isPostOutput ? MAX_STREAM_RETRIES_POST : MAX_STREAM_RETRIES_PRE;

      if (retriesUsed >= maxRetries || Date.now() - startedAt >= STREAM_RETRY_TOTAL_TIMEOUT_MS) {
        console.warn(
          `[provider-retry] giving up after ${retriesUsed} ${isPostOutput ? "post" : "pre"}-output retries`,
          err instanceof Error ? err.message : err
        );
        throw err;
      }

      const retryIndex = retriesUsed + 1;
      const delay = computeBackoffMs(retryIndex, err);
      console.warn(
        `[provider-retry] transient mid-stream error, retry ${retryIndex}/${maxRetries} (${isPostOutput ? "post" : "pre"}-output) in ${Math.round(delay)}ms`,
        err instanceof Error ? err.message : err
      );

      if (isPostOutput) {
        yield { type: "stream_retry", attempt: retryIndex };
      }

      await sleep(delay, signal);

      if (isPostOutput) {
        postOutputRetries += 1;
      } else {
        preOutputRetries += 1;
      }
    }
  }
}
