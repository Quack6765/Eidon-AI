import { describe, expect, it } from "vitest";

vi.mock("@/lib/attachments", () => ({
  getAttachmentDataUrl: vi.fn(() => "data:image/png;base64,IMGDATA")
}));

import {
  buildAnthropicRequest,
  callAnthropicText,
  extractSystemPrompt,
  mapReasoningEffortToAnthropic,
  streamAnthropicResponse,
  toAnthropicMessages,
  toAnthropicTools
} from "@/lib/anthropic";
import { estimatePromptTokens } from "@/lib/tokenization";
import type { ChatStreamEvent, ProviderProfileWithApiKey, PromptMessage, ToolDefinition } from "@/lib/types";

function baseSettings(overrides: Partial<ProviderProfileWithApiKey> = {}): ProviderProfileWithApiKey {
  return {
    id: "p1",
    providerKind: "anthropic",
    name: "A",
    apiBaseUrl: "https://api.anthropic.com",
    apiKeyEncrypted: "",
    apiKey: "sk-ant-test",
    model: "claude-opus-4-8",
    apiMode: "chat_completions",
    systemPrompt: "",
    temperature: 0.7,
    maxOutputTokens: 8000,
    reasoningEffort: "medium",
    reasoningSummaryEnabled: true,
    modelContextLimit: 200000,
    compactionThreshold: 0.8,
    freshTailCount: 28,
    tokenizerModel: "gpt-tokenizer",
    safetyMarginTokens: 1200,
    leafSourceTokenLimit: 12000,
    leafMinMessageCount: 6,
    mergedMinNodeCount: 4,
    mergedTargetTokens: 1600,
    visionMode: "native",
    providerPresetId: "anthropic_official",
    githubUserAccessTokenEncrypted: "",
    githubRefreshTokenEncrypted: "",
    githubTokenExpiresAt: null,
    githubRefreshTokenExpiresAt: null,
    githubAccountLogin: null,
    githubAccountName: null,
    createdAt: "",
    updatedAt: "",
    ...overrides
  };
}

describe("mapReasoningEffortToAnthropic", () => {
  it("maps none to null", () => {
    expect(mapReasoningEffortToAnthropic("none")).toBeNull();
  });

  it("maps xhigh to max", () => {
    expect(mapReasoningEffortToAnthropic("xhigh")).toBe("max");
  });

  it("maps low/medium/high directly", () => {
    expect(mapReasoningEffortToAnthropic("low")).toBe("low");
    expect(mapReasoningEffortToAnthropic("medium")).toBe("medium");
    expect(mapReasoningEffortToAnthropic("high")).toBe("high");
  });
});

describe("extractSystemPrompt", () => {
  it("joins system messages and ignores others", () => {
    const messages: PromptMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" }
    ];
    expect(extractSystemPrompt(messages)).toBe("You are helpful.");
  });
});

describe("toAnthropicMessages", () => {
  it("converts user text and skips system", () => {
    const messages: PromptMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" }
    ];
    expect(toAnthropicMessages(messages)).toEqual([{ role: "user", content: "hello" }]);
  });

  it("converts assistant tool calls into tool_use blocks", () => {
    const messages: PromptMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "search", arguments: '{"q":"x"}' }]
      },
      { role: "tool", toolCallId: "t1", content: "result" }
    ];
    const result = toAnthropicMessages(messages);
    expect(result[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "search", input: { q: "x" } }]
    });
    expect(result[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "result" }]
    });
  });

  it("emits a signed thinking block before tool_use when signature present", () => {
    const messages: PromptMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        reasoningContent: "thinking...",
        reasoningSignature: "SIG",
        toolCalls: [{ id: "t1", name: "search", arguments: "{}" }]
      }
    ];
    const result = toAnthropicMessages(messages);
    expect(result[1].content[0]).toEqual({ type: "thinking", thinking: "thinking...", signature: "SIG" });
  });

  it("converts image content parts into base64 image blocks", () => {
    const messages: PromptMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", attachmentId: "a1", filename: "x.png", mimeType: "image/png", relativePath: "x.png" }
        ]
      }
    ];
    const result = toAnthropicMessages(messages);
    expect(result[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "IMGDATA" } }
      ]
    });
  });
});

describe("toAnthropicTools", () => {
  it("maps tool definitions to anthropic tool shape", () => {
    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "search",
          description: "search the web",
          parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] }
        }
      }
    ];
    expect(toAnthropicTools(tools)).toEqual([
      {
        name: "search",
        description: "search the web",
        input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] }
      }
    ]);
  });
});

describe("buildAnthropicRequest", () => {
  it("includes adaptive thinking and effort when reasoning enabled, and omits temperature", () => {
    const params = buildAnthropicRequest({
      settings: baseSettings({ reasoningEffort: "high" }),
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" }
      ]
    });
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.effort).toBe("high");
    expect(params.temperature).toBeUndefined();
    expect(params.model).toBe("claude-opus-4-8");
  });

  it("omits thinking/effort and sets temperature when reasoning is none", () => {
    const params = buildAnthropicRequest({
      settings: baseSettings({ reasoningEffort: "none" }),
      messages: [{ role: "user", content: "hi" }]
    });
    expect(params.thinking).toBeUndefined();
    expect(params.effort).toBeUndefined();
    expect(params.temperature).toBe(0.7);
  });

  it("omits thinking for a non-reasoning model even if effort is set", () => {
    const params = buildAnthropicRequest({
      settings: baseSettings({ model: "qwen3.7-max", reasoningEffort: "high" }),
      messages: [{ role: "user", content: "hi" }]
    });
    expect(params.thinking).toBeUndefined();
    expect(params.effort).toBeUndefined();
  });

  it("marks the system prompt with cache_control", () => {
    const params = buildAnthropicRequest({
      settings: baseSettings(),
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" }
      ]
    });
    expect(params.system).toEqual([
      { type: "text", text: "sys", cache_control: { type: "ephemeral" } }
    ]);
  });

  it("includes converted tools when provided", () => {
    const params = buildAnthropicRequest({
      settings: baseSettings(),
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", function: { name: "t", description: "d", parameters: { type: "object" } } }
      ]
    });
    expect(Array.isArray(params.tools)).toBe(true);
    expect((params.tools as Array<{ name: string }>)[0].name).toBe("t");
  });
});

function fakeStreamClient(events: unknown[]) {
  return {
    messages: {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) {
              yield event;
            }
          }
        };
      }
    }
  } as never;
}

function fakeCreateClient(content: Array<{ type: string; text?: string }>) {
  return {
    messages: {
      async create() {
        return { content };
      }
    }
  } as never;
}

describe("streamAnthropicResponse", () => {
  it("yields answer/thinking/usage and returns toolCalls + signature", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 11 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reason" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "SIG" } },
      { type: "content_block_start", index: 1, content_block: { type: "text" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: "search" } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"q":"x"}' } },
      { type: "message_delta", usage: { output_tokens: 5 } }
    ];

    const gen = streamAnthropicResponse({
      settings: baseSettings({ apiKey: "k" }),
      promptMessages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" }
      ],
      client: fakeStreamClient(events)
    });

    const collected: ChatStreamEvent[] = [];
    let next = await gen.next();
    while (!next.done) {
      collected.push(next.value);
      next = await gen.next();
    }

    expect(collected).toContainEqual({ type: "answer_delta", text: "hello" });
    expect(collected).toContainEqual({ type: "thinking_delta", text: "reason" });
    expect(next.value.answer).toBe("hello");
    expect(next.value.thinking).toBe("reason");
    expect(next.value.reasoningSignature).toBe("SIG");
    expect(next.value.toolCalls).toEqual([{ id: "t1", name: "search", arguments: '{"q":"x"}' }]);
    expect(next.value.usage.outputTokens).toBe(5);
  });

  it("sums cached prompt tokens into inputTokens usage", async () => {
    const events = [
      {
        type: "message_start",
        message: { usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } }
      },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
      { type: "message_delta", usage: { output_tokens: 3 } }
    ];

    const gen = streamAnthropicResponse({
      settings: baseSettings({ apiKey: "k" }),
      promptMessages: [{ role: "user", content: "hi" }],
      client: fakeStreamClient(events)
    });

    let next = await gen.next();
    while (!next.done) {
      next = await gen.next();
    }

    expect(next.value.usage.inputTokens).toBe(115);
    expect(next.value.usage.outputTokens).toBe(3);
  });

  it("floors inputTokens with the prompt estimate when the API under-reports (no cache fields)", async () => {
    const promptMessages: PromptMessage[] = [
      {
        role: "user",
        content:
          "Please write a detailed multi-paragraph essay about the history of computing, covering the abacus, mechanical calculators, vacuum tubes, transistors, integrated circuits, and modern processors, with concrete examples and dates throughout."
      }
    ];
    const expectedFloor = estimatePromptTokens(promptMessages);

    const events = [
      { type: "message_start", message: { usage: { input_tokens: 5 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "message_delta", usage: { output_tokens: 4 } }
    ];

    const gen = streamAnthropicResponse({
      settings: baseSettings({ apiKey: "k" }),
      promptMessages,
      client: fakeStreamClient(events)
    });

    const usageEvents: Array<{ inputTokens?: number }> = [];
    let next = await gen.next();
    while (!next.done) {
      if (next.value.type === "usage") usageEvents.push(next.value as { inputTokens?: number });
      next = await gen.next();
    }

    expect(expectedFloor).toBeGreaterThanOrEqual(50);
    expect(usageEvents.at(-1)?.inputTokens).toBe(expectedFloor);
    expect(next.value.usage.inputTokens).toBe(expectedFloor);
  });

  it("suppresses thinking deltas when reasoningSummaryEnabled is false", async () => {
    const events = [
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret" } },
      { type: "content_block_start", index: 1, content_block: { type: "text" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hi" } }
    ];

    const gen = streamAnthropicResponse({
      settings: baseSettings({ apiKey: "k", reasoningSummaryEnabled: false }),
      promptMessages: [{ role: "user", content: "hi" }],
      client: fakeStreamClient(events)
    });

    const collected: ChatStreamEvent[] = [];
    let next = await gen.next();
    while (!next.done) {
      collected.push(next.value);
      next = await gen.next();
    }

    expect(collected.some((e) => e.type === "thinking_delta")).toBe(false);
    expect(next.value.thinking).toBe("secret");
  });
});

describe("callAnthropicText", () => {
  it("concatenates text blocks from the response", async () => {
    const text = await callAnthropicText({
      settings: baseSettings({ apiKey: "k" }),
      messages: [{ role: "user", content: "hi" }],
      client: fakeCreateClient([
        { type: "text", text: "con" },
        { type: "text", text: "nected" }
      ])
    });

    expect(text).toBe("connected");
  });
});

describe("anthropic conversion branch coverage", () => {
  it("includes assistant text alongside tool_use blocks", () => {
    const result = toAnthropicMessages([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "Let me check.",
        toolCalls: [{ id: "t1", name: "search", arguments: "{}" }]
      }
    ]);

    expect(result[1].content).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool_use", id: "t1", name: "search", input: {} }
    ]);
  });

  it("falls back to an empty object for invalid tool-call arguments", () => {
    const result = toAnthropicMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "x", arguments: "not json" }] }
    ]);

    expect((result[0].content as Array<{ type: string; input?: unknown }>)[0].input).toEqual({});
  });

  it("merges consecutive tool results into a single user message", () => {
    const result = toAnthropicMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "t1", name: "a", arguments: "{}" },
          { id: "t2", name: "b", arguments: "{}" }
        ]
      },
      { role: "tool", toolCallId: "t1", content: "r1" },
      { role: "tool", toolCallId: "t2", content: "r2" }
    ]);

    const last = result[result.length - 1];
    expect(last.role).toBe("user");
    expect(Array.isArray(last.content)).toBe(true);
    expect((last.content as unknown[]).length).toBe(2);
  });

  it("applies cache_control to the last block of the second-to-last message", () => {
    const params = buildAnthropicRequest({
      settings: baseSettings({ reasoningEffort: "none" }),
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "first" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "second" }
      ]
    });

    const messages = params.messages as Array<{ role: string; content: unknown }>;
    const secondToLast = messages[messages.length - 2];
    const blocks = secondToLast.content as Array<{ cache_control?: { type: string } }>;

    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks[blocks.length - 1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("keeps non-final blocks unmarked when caching a multi-block message", () => {
    const params = buildAnthropicRequest({
      settings: baseSettings({ reasoningEffort: "none" }),
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "thinking out loud",
          toolCalls: [{ id: "t1", name: "a", arguments: "{}" }]
        },
        { role: "tool", toolCallId: "t1", content: "res" }
      ]
    });

    const messages = params.messages as Array<{ role: string; content: unknown }>;
    const cached = messages[messages.length - 2];
    const blocks = cached.content as Array<{ type: string; cache_control?: unknown }>;

    expect(blocks.length).toBe(2);
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("merges consecutive user text messages, normalizing prior string content", () => {
    const result = toAnthropicMessages([
      { role: "user", content: "one" },
      { role: "user", content: "two" }
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual([
      { type: "text", text: "one" },
      { type: "text", text: "two" }
    ]);
  });

  it("joins system messages with array content and drops empty ones", () => {
    const text = extractSystemPrompt([
      { role: "system", content: "  " },
      { role: "system", content: [{ type: "text", text: "rules" }] },
      { role: "user", content: "hi" }
    ]);

    expect(text).toBe("rules");
  });

  it("handles an abort signal, empty tool json, and orphan json deltas", async () => {
    const events = [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t9", name: "noop" } },
      { type: "content_block_delta", index: 5, delta: { type: "input_json_delta", partial_json: "{}" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }
    ];
    const controller = new AbortController();

    const gen = streamAnthropicResponse({
      settings: baseSettings({ apiKey: "k" }),
      promptMessages: [{ role: "user", content: "hi" }],
      abortSignal: controller.signal,
      client: fakeStreamClient(events)
    });

    let next = await gen.next();
    while (!next.done) {
      next = await gen.next();
    }

    expect(next.value.answer).toBe("ok");
    expect(next.value.toolCalls).toEqual([{ id: "t9", name: "noop", arguments: "{}" }]);
    expect(next.value.usage.inputTokens).toBeGreaterThanOrEqual(0);
  });

  it("returns an empty string when the text response has no content", async () => {
    const text = await callAnthropicText({
      settings: baseSettings({ apiKey: "k" }),
      messages: [{ role: "user", content: "hi" }],
      client: { messages: { async create() { return {}; } } } as never
    });

    expect(text).toBe("");
  });
});
