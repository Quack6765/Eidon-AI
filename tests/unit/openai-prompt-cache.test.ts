import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const create = vi.hoisted(() => vi.fn());
const responsesCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/provider-adapters/openai-message-formatting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-adapters/openai-message-formatting")>()),
  createOpenAIClient: () => ({
    chat: { completions: { create } },
    responses: { create: responsesCreate }
  })
}));

async function drain(stream: AsyncGenerator<unknown, { usage: Record<string, unknown> }>) {
  while (true) {
    const next = await stream.next();
    if (next.done) return next.value;
  }
}

describe("openai prompt caching", () => {
  beforeEach(() => {
    create.mockReset();
    responsesCreate.mockReset();
    create.mockImplementation(async () =>
      (async function* () {
        yield { choices: [{ delta: { content: "hi" } }] };
        yield { choices: [], usage: { prompt_tokens: 50, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 40 } } };
      })()
    );
    responsesCreate.mockImplementation(async () =>
      (async function* () {
        yield { type: "response.output_text.delta", delta: "hi" };
        yield {
          type: "response.completed",
          response: { usage: { input_tokens: 50, output_tokens: 2, input_tokens_details: { cached_tokens: 30 } } }
        };
      })()
    );
  });

  async function run(apiBaseUrl: string, apiMode: "responses" | "chat_completions", conversationId?: string) {
    const { streamOpenAiCompatibleResponse } = await import("@/lib/provider-adapters/openai-compatible");
    return drain(
      streamOpenAiCompatibleResponse({
        settings: createRuntimeProviderProfile({ providerConfig: { apiBaseUrl, apiMode } }),
        promptMessages: [{ role: "user", content: "hello" }],
        conversationId
      }) as never
    );
  }

  it("sends the conversation as prompt_cache_key to the official endpoint and reads cached tokens", async () => {
    const chat = await run("https://api.openai.com/v1", "chat_completions", "conv_1");
    expect(create.mock.calls[0][0].prompt_cache_key).toBe("conv_1");
    expect(chat.usage.cacheReadTokens).toBe(40);

    const responses = await run("https://api.openai.com/v1/", "responses", "conv_1");
    expect(responsesCreate.mock.calls[0][0].prompt_cache_key).toBe("conv_1");
    expect(responses.usage.cacheReadTokens).toBe(30);
  });

  it("omits prompt_cache_key for other endpoints and when there is no conversation", async () => {
    await run("https://api.example.com/v1", "chat_completions", "conv_1");
    await run("https://api.openai.com/v1", "chat_completions");
    await run("https://api.example.com/v1", "responses", "conv_1");

    expect(create.mock.calls[0][0]).not.toHaveProperty("prompt_cache_key");
    expect(create.mock.calls[1][0]).not.toHaveProperty("prompt_cache_key");
    expect(responsesCreate.mock.calls[0][0]).not.toHaveProperty("prompt_cache_key");
  });
});
