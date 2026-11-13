import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const { setActiveTokenizer, estimatePromptTokens } = vi.hoisted(() => ({
  setActiveTokenizer: vi.fn(),
  estimatePromptTokens: vi.fn((_messages: unknown[]) => 0)
}));

vi.mock("@/lib/tokenization", () => ({
  setActiveTokenizer,
  estimatePromptTokens
}));

import {
  adapterStream,
  normalizeAdapterPromptMessages,
  runAdapterText
} from "@/lib/provider-adapters/kit";
import type {
  ProviderStreamInput,
  ProviderStreamResult
} from "@/lib/provider-adapters/types";
import type { ChatStreamEvent } from "@/lib/types";

function profile(overrides: Record<string, unknown> = {}) {
  return createRuntimeProviderProfile({
    providerKind: "openai_compatible",
    reasoningEffort: "high",
    reasoningSummaryEnabled: true,
    ...overrides
  });
}

async function drain(stream: AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void>) {
  const events: ChatStreamEvent[] = [];
  let step = await stream.next();
  while (!step.done) {
    events.push(step.value);
    step = await stream.next();
  }
  return { events, result: step.value };
}

describe("runAdapterText", () => {
  it("downgrades low-effort purposes before invoking the vendor", async () => {
    const runs: Array<{ effort: unknown; summary: unknown }> = [];
    const text = await runAdapterText(
      { settings: profile(), prompt: "Name this chat", purpose: "title" },
      async (settings) => {
        runs.push({ effort: settings.reasoningEffort, summary: settings.reasoningSummaryEnabled });
        return "ok";
      }
    );

    expect(text).toBe("ok");
    expect(runs).toEqual([{ effort: "low", summary: false }]);
  });

  it("keeps reasoning disabled for low-effort purposes", async () => {
    const efforts: unknown[] = [];
    await runAdapterText(
      { settings: profile({ reasoningEffort: "none" }), prompt: "p", purpose: "speech_cleanup" },
      async (settings) => {
        efforts.push(settings.reasoningEffort);
        return "ok";
      }
    );

    expect(efforts).toEqual(["none"]);
  });

  it("passes settings through untouched for full-effort purposes", async () => {
    for (const purpose of ["compaction", "test"] as const) {
      const efforts: unknown[] = [];
      await runAdapterText(
        { settings: profile(), prompt: "p", purpose },
        async (settings) => {
          efforts.push(settings.reasoningEffort);
          return "ok";
        }
      );
      expect(efforts).toEqual(["high"]);
    }
  });

  it("strips thinking delimiters from the vendor text", async () => {
    await expect(
      runAdapterText(
        { settings: profile(), prompt: "p", purpose: "test" },
        async () => "<think>hidden</think>visible"
      )
    ).resolves.toBe("visible");
  });

  it("throws the shared empty-response error for empty, blank, and think-only text", async () => {
    for (const raw of ["", "   \n ", "<think>only reasoning</think>"]) {
      await expect(
        runAdapterText(
          { settings: profile(), prompt: "p", purpose: "test" },
          async () => raw
        )
      ).rejects.toThrow("Provider returned an empty response");
    }
  });
});

describe("normalizeAdapterPromptMessages", () => {
  it("appends the date context user message and demotes tool result images", () => {
    const messages = normalizeAdapterPromptMessages([
      {
        role: "tool",
        toolCallId: "t1",
        content: [
          { type: "text", text: "saved" },
          { type: "image", attachmentId: "a1", filename: "page.png", mimeType: "image/png", relativePath: "c/a1.png" }
        ]
      }
    ]);

    expect(messages[0]).toMatchObject({ role: "tool", content: "saved" });
    expect(messages[1]).toMatchObject({ role: "user" });
    expect((messages[1].content as Array<{ type: string; text?: string }>)[0].text)
      .toBe("Images returned by the tool calls above:");
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect(typeof last.content === "string" && last.content.startsWith("Current date and time context")).toBe(true);
  });
});

describe("adapterStream", () => {
  const baseInput: ProviderStreamInput = {
    settings: profile({ tokenizerModel: "test-tokenizer" }),
    promptMessages: [{ role: "user", content: "hi" }]
  };

  function vendorStream(
    events: ChatStreamEvent[],
    result: ProviderStreamResult,
    onInput?: (input: ProviderStreamInput) => void
  ) {
    return vi.fn((input: ProviderStreamInput) => {
      onInput?.(input);
      return (async function* () {
        for (const event of events) {
          yield event;
        }
        return result;
      })();
    });
  }

  beforeEach(() => {
    setActiveTokenizer.mockClear();
    estimatePromptTokens.mockClear();
    estimatePromptTokens.mockReturnValue(0);
  });

  it("activates the tokenizer and normalizes messages before the vendor runs", async () => {
    const vendor = vendorStream(
      [{ type: "answer_delta", text: "ok" }],
      { answer: "ok", thinking: "", usage: {} },
      (input) => {
        expect(input.promptMessages.length).toBe(2);
        expect(input.promptMessages[0]).toEqual({ role: "user", content: "hi" });
      }
    );

    await drain(adapterStream(
      { normalizePromptMessages: true, usageEvents: "vendor" },
      vendor
    )(baseInput));

    expect(setActiveTokenizer).toHaveBeenCalledWith("test-tokenizer");
    expect(vendor).toHaveBeenCalledOnce();
    const vendorInput = vendor.mock.calls[0][0] as ProviderStreamInput;
    const last = vendorInput.promptMessages[vendorInput.promptMessages.length - 1];
    expect(typeof last.content === "string" && last.content.startsWith("Current date and time context")).toBe(true);
  });

  it("passes raw messages through when normalization is disabled", async () => {
    const vendor = vendorStream([], { answer: "", thinking: "", usage: {} });
    const input = {
      ...baseInput,
      settings: { ...baseInput.settings, tokenizerModel: undefined as unknown as "gpt-tokenizer" }
    };

    await drain(adapterStream(
      { normalizePromptMessages: false, usageEvents: "none" },
      vendor
    )(input));

    expect(vendor.mock.calls[0][0].promptMessages).toEqual([{ role: "user", content: "hi" }]);
    expect(setActiveTokenizer).toHaveBeenCalledWith("gpt-tokenizer");
  });

  it("emits exactly one usage event with the estimated input tokens when the vendor emits none", async () => {
    estimatePromptTokens.mockReturnValue(42);
    const vendor = vendorStream(
      [{ type: "answer_delta", text: "ok" }],
      { answer: "ok", thinking: "", usage: { outputTokens: 3 } }
    );

    const { events, result } = await drain(adapterStream(
      { normalizePromptMessages: true, usageEvents: "kit" },
      vendor
    )(baseInput));

    const usageEvents = events.filter((event) => event.type === "usage");
    expect(usageEvents).toEqual([{
      type: "usage",
      inputTokens: 42,
      outputTokens: 3,
      reasoningTokens: undefined,
      cacheReadTokens: undefined,
      cacheCreationTokens: undefined
    }]);
    expect(estimatePromptTokens).toHaveBeenCalledOnce();
    const estimated = estimatePromptTokens.mock.calls[0][0] as Array<{ role: string }>;
    expect(estimated[estimated.length - 1].role).toBe("user");
    expect(result.usage.inputTokens).toBe(42);
  });

  it("keeps a vendor-reported usage event as the only one", async () => {
    estimatePromptTokens.mockReturnValue(42);
    const vendorEvent = {
      type: "usage" as const,
      inputTokens: 7,
      outputTokens: 2
    };
    const vendor = vendorStream(
      [{ type: "answer_delta", text: "ok" }, vendorEvent],
      { answer: "ok", thinking: "", usage: { inputTokens: 7, outputTokens: 2 } }
    );

    const { events, result } = await drain(adapterStream(
      { normalizePromptMessages: true, usageEvents: "kit" },
      vendor
    )(baseInput));

    expect(events.filter((event) => event.type === "usage")).toEqual([vendorEvent]);
    expect(estimatePromptTokens).not.toHaveBeenCalled();
    expect(result.usage.inputTokens).toBe(7);
  });

  it("never emits a usage event for vendor and none policies", async () => {
    for (const usageEvents of ["vendor", "none"] as const) {
      const vendor = vendorStream(
        [{ type: "answer_delta", text: "ok" }],
        { answer: "ok", thinking: "", usage: {} }
      );

      const { events } = await drain(adapterStream(
        { normalizePromptMessages: true, usageEvents },
        vendor
      )(baseInput));

      expect(events.some((event) => event.type === "usage")).toBe(false);
      expect(estimatePromptTokens).not.toHaveBeenCalled();
    }
  });

  it("passes vendor events through in order and returns the vendor result", async () => {
    const expectedResult: ProviderStreamResult = {
      answer: "done",
      thinking: "quiet",
      toolCalls: [{ id: "t1", name: "search", arguments: "{}" }],
      usage: { inputTokens: 5 }
    };
    const vendor = vendorStream(
      [
        { type: "thinking_delta", text: "quiet" },
        { type: "answer_delta", text: "done" }
      ],
      expectedResult
    );

    const { events, result } = await drain(adapterStream(
      { normalizePromptMessages: true, usageEvents: "vendor" },
      vendor
    )(baseInput));

    expect(events).toEqual([
      { type: "thinking_delta", text: "quiet" },
      { type: "answer_delta", text: "done" }
    ]);
    expect(result).toBe(expectedResult);
  });

  it("propagates early consumer return into the vendor stream", async () => {
    let vendorReturned = false;
    const vendor = () => (async function* () {
      try {
        yield { type: "answer_delta" as const, text: "partial" };
      } finally {
        vendorReturned = true;
      }
      return { answer: "", thinking: "", usage: {} };
    })();

    const stream = adapterStream(
      { normalizePromptMessages: false, usageEvents: "none" },
      vendor
    )(baseInput);

    await stream.next();
    await stream.return({ answer: "", thinking: "", usage: {} });

    expect(vendorReturned).toBe(true);
  });
});
