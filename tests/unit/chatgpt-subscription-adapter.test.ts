import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const { openAiConstructor, responsesCreate, ensureFreshMock } = vi.hoisted(() => ({
  openAiConstructor: vi.fn(),
  responsesCreate: vi.fn(),
  ensureFreshMock: vi.fn()
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation((options: unknown) => {
    openAiConstructor(options);
    return { responses: { create: responsesCreate } };
  })
}));

vi.mock("@/lib/provider-oauth-refresh", () => ({
  ensureFreshOAuthAccessToken: ensureFreshMock
}));

import {
  buildChatgptInput,
  callChatgptSubscriptionText,
  streamChatgptSubscriptionResponse
} from "@/lib/provider-adapters/chatgpt-subscription";

function fakeJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

const accessToken = fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } });

function chatgptProfile(overrides: Parameters<typeof createRuntimeProviderProfile>[0] = {}) {
  return createRuntimeProviderProfile({
    id: "profile_chatgpt",
    providerKind: "chatgpt_subscription",
    providerConfig: {},
    model: "gpt-6-luna",
    reasoningEffort: "high",
    reasoningSummaryEnabled: true,
    temperature: 0.4,
    maxOutputTokens: 4096,
    credentials: { accessToken, refreshToken: "refresh_1" },
    ...overrides
  });
}

function streamOf(events: unknown[]) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

async function drain<T, R>(generator: AsyncGenerator<T, R>) {
  const events: T[] = [];
  let step = await generator.next();
  while (!step.done) {
    events.push(step.value);
    step = await generator.next();
  }
  return { events, result: step.value };
}

describe("ChatGPT subscription adapter", () => {
  beforeEach(() => {
    openAiConstructor.mockReset();
    responsesCreate.mockReset();
    ensureFreshMock.mockReset();
    ensureFreshMock.mockImplementation(async (profile) => profile);
  });

  it("moves system prompts into instructions and replays stored items statelessly", () => {
    const { instructions, input } = buildChatgptInput([
      { role: "system", content: "Be brief." },
      { role: "system", content: [{ type: "text", text: "Recall: likes tea." }] },
      { role: "user", content: "Hi" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "search", arguments: "{}" }],
        responseItems: [
          { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" },
          { type: "reasoning", id: "rs_2", summary: [] },
          { type: "function_call", id: "fc_1", call_id: "call_1", name: "search", arguments: "{}" }
        ]
      },
      { role: "tool", toolCallId: "call_1", content: "result" }
    ]);

    expect(instructions).toBe("Be brief.\n\nRecall: likes tea.");
    expect(input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Hi" }] },
      { type: "reasoning", summary: [], encrypted_content: "opaque" },
      { type: "function_call", call_id: "call_1", name: "search", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "result" }
    ]);
    expect(buildChatgptInput([{ role: "user", content: "Hi" }]).instructions)
      .toBe("You are a helpful assistant.");
  });

  it("streams through the subscription backend with stateless request parameters", async () => {
    responsesCreate.mockResolvedValue(streamOf([
      { type: "response.reasoning_summary_text.delta", delta: "Thinking" },
      { type: "response.output_text.delta", delta: "Hello" },
      {
        type: "response.output_item.done",
        item: { type: "function_call", call_id: "call_9", name: "lookup", arguments: "{\"q\":1}" }
      },
      {
        type: "response.completed",
        response: { usage: { input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } } }
      }
    ]));

    const { events, result } = await drain(streamChatgptSubscriptionResponse({
      settings: chatgptProfile(),
      promptMessages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hi" }
      ],
      tools: [{
        type: "function",
        function: { name: "lookup", description: "Look up", parameters: { type: "object" } }
      }],
      conversationId: "conv_1"
    }));

    expect(openAiConstructor).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: accessToken,
      baseURL: "https://chatgpt.com/backend-api/codex",
      defaultHeaders: expect.objectContaining({
        "ChatGPT-Account-Id": "acct_1",
        originator: "eidon",
        "session-id": "conv_1"
      })
    }));
    const params = responsesCreate.mock.calls[0][0];
    expect(params).toMatchObject({
      model: "gpt-6-luna",
      instructions: "Be brief.",
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "high", summary: "auto" },
      prompt_cache_key: "conv_1",
      tool_choice: "auto",
      tools: [{ type: "function", name: "lookup", description: "Look up", parameters: { type: "object" }, strict: false }]
    });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("max_output_tokens");
    expect(params).not.toHaveProperty("service_tier");
    expect(params.input.some((item: { role?: string }) => item.role === "system")).toBe(false);

    expect(events).toEqual(expect.arrayContaining([
      { type: "thinking_delta", text: "Thinking" },
      { type: "answer_delta", text: "Hello" },
      expect.objectContaining({ type: "usage", inputTokens: 12, outputTokens: 3, cacheReadTokens: 4 })
    ]));
    expect(result.toolCalls).toEqual([{ id: "call_9", name: "lookup", arguments: "{\"q\":1}" }]);
  });

  it("refreshes the session before calling and keeps xhigh reasoning", async () => {
    ensureFreshMock.mockImplementation(async (profile) => ({
      ...profile,
      credentials: { accessToken, refreshToken: "refresh_2" }
    }));
    responsesCreate.mockResolvedValue(streamOf([{ type: "response.output_text.delta", delta: "ok" }]));

    await drain(streamChatgptSubscriptionResponse({
      settings: chatgptProfile({ reasoningEffort: "max", reasoningSummaryEnabled: false }),
      promptMessages: [{ role: "user", content: "Hi" }]
    }));

    expect(ensureFreshMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "profile_chatgpt" }),
      expect.objectContaining({ label: "ChatGPT" }),
      undefined
    );
    const params = responsesCreate.mock.calls[0][0];
    expect(params.reasoning).toEqual({ effort: "xhigh" });
    expect(params).not.toHaveProperty("prompt_cache_key");
    expect(params).not.toHaveProperty("tools");
  });

  it("collects one-shot text from the stream with low reasoning effort", async () => {
    responsesCreate.mockResolvedValue(streamOf([
      { type: "response.output_text.delta", delta: "Trip " },
      { type: "response.output_text.delta", delta: "Planning" }
    ]));

    await expect(callChatgptSubscriptionText({
      settings: chatgptProfile(),
      prompt: "Name this chat",
      purpose: "title",
      conversationId: "conv_2"
    })).resolves.toBe("Trip Planning");
    expect(responsesCreate.mock.calls[0][0].reasoning).toEqual({ effort: "low" });

    responsesCreate.mockResolvedValue(streamOf([]));
    await expect(callChatgptSubscriptionText({
      settings: chatgptProfile({ reasoningEffort: "none" }),
      prompt: "Name this chat",
      purpose: "test"
    })).rejects.toThrow("empty response");
  });
});
