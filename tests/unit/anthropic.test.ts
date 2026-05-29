import { describe, expect, it } from "vitest";

vi.mock("@/lib/attachments", () => ({
  getAttachmentDataUrl: vi.fn(() => "data:image/png;base64,IMGDATA")
}));

import {
  buildAnthropicRequest,
  extractSystemPrompt,
  mapReasoningEffortToAnthropic,
  toAnthropicMessages,
  toAnthropicTools
} from "@/lib/anthropic";
import type { ProviderProfileWithApiKey, PromptMessage, ToolDefinition } from "@/lib/types";

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
    visionMcpServerId: null,
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
