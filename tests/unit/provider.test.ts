import type { ChatStreamEvent, ProviderProfileWithApiKey } from "@/lib/types";

const responsesCreate = vi.fn();
const chatCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      responses: {
        create: responsesCreate
      },
      chat: {
        completions: {
          create: chatCreate
        }
      }
    }))
  };
});

function createAsyncStream<T>(events: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    }
  };
}

function createSettings(
  overrides: Partial<{
    id: string;
    name: string;
    apiBaseUrl: string;
    apiKeyEncrypted: string;
    apiKey: string;
    model: string;
    apiMode: "responses" | "chat_completions";
    systemPrompt: string;
    temperature: number;
    maxOutputTokens: number;
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
    reasoningSummaryEnabled: boolean;
    modelContextLimit: number;
    compactionThreshold: number;
    freshTailCount: number;
    createdAt: string;
    updatedAt: string;
  }> = {}
): ProviderProfileWithApiKey {
  return {
    id: "profile_test",
    name: "Test profile",
    apiBaseUrl: "https://api.example.com/v1",
    apiKeyEncrypted: "",
    apiKey: "sk-test",
    model: "gpt-test",
    apiMode: "responses",
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    reasoningEffort: "medium",
    reasoningSummaryEnabled: true,
    modelContextLimit: 16000,
    compactionThreshold: 0.8,
    freshTailCount: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("provider integration", () => {
  beforeEach(() => {
    responsesCreate.mockReset();
    chatCreate.mockReset();
  });

  it("calls responses text generation and returns output text", async () => {
    responsesCreate.mockResolvedValue({
      output_text: "connected"
    });

    const { callProviderText } = await import("@/lib/provider");

    const result = await callProviderText({
      settings: createSettings({
        model: "gpt-5-mini",
        reasoningEffort: "xhigh"
      }),
      prompt: "Reply with connected",
      purpose: "test"
    });

    expect(result).toBe("connected");
    expect(responsesCreate).toHaveBeenCalledOnce();
    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: {
          effort: "high",
          summary: "auto"
        }
      })
    );
  });

  it("omits reasoning config for non-reasoning models", async () => {
    responsesCreate.mockResolvedValue({
      output_text: "connected"
    });

    const { callProviderText } = await import("@/lib/provider");

    await callProviderText({
      settings: createSettings({
        model: "gpt-4.1-mini"
      }),
      prompt: "Reply with connected",
      purpose: "test"
    });

    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4.1-mini",
        reasoning: undefined
      })
    );
  });

  it("reads responses text from output arrays and errors on empty chat completions", async () => {
    responsesCreate.mockResolvedValue({
      output: [
        {
          content: [{ text: "joined " }, { text: "response" }]
        }
      ]
    });

    const { callProviderText } = await import("@/lib/provider");

    await expect(
      callProviderText({
        settings: createSettings({
          reasoningSummaryEnabled: false
        }),
        prompt: "Reply with connected",
        purpose: "test"
      })
    ).resolves.toBe("joined response");

    responsesCreate.mockResolvedValue("");

    await expect(
      callProviderText({
        settings: createSettings({
          reasoningSummaryEnabled: false
        }),
        prompt: "Reply with connected",
        purpose: "test"
      })
    ).rejects.toThrow("Provider returned an empty response");

    chatCreate.mockResolvedValue({
      choices: [{ message: { content: "" } }]
    });

    await expect(
      callProviderText({
        settings: createSettings({
          apiMode: "chat_completions",
          reasoningSummaryEnabled: false
        }),
        prompt: "Reply with connected",
        purpose: "test"
      })
    ).rejects.toThrow("Provider returned an empty response");
  });

  it("streams responses events into normalized deltas", async () => {
    responsesCreate.mockResolvedValue(
      createAsyncStream([
        { type: "response.reasoning_summary_text.delta", delta: "Thinking " },
        { type: "response.output_text.delta", delta: "Hello " },
        { type: "response.output_text.delta", delta: "world" },
        {
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 10,
              output_tokens: 12,
              output_tokens_details: {
                reasoning_tokens: 3
              }
            }
          }
        }
      ])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        model: "gpt-5-mini",
        reasoningEffort: "high"
      }),
      promptMessages: [{ role: "user", content: "Hi" }]
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();

      if (next.done) {
        expect(next.value.answer).toBe("Hello world");
        expect(next.value.thinking).toBe("Thinking ");
        expect(next.value.usage.reasoningTokens).toBe(3);
        break;
      }

      events.push(next.value);
    }

    expect(events).toEqual([
      { type: "thinking_delta", text: "Thinking " },
      { type: "answer_delta", text: "Hello " },
      { type: "answer_delta", text: "world" },
      { type: "usage", inputTokens: 10, outputTokens: 12, reasoningTokens: 3 }
    ]);
  });

  it("uses output_item reasoning summaries when no direct reasoning delta arrives", async () => {
    responsesCreate.mockResolvedValue(
      createAsyncStream([
        {
          type: "response.output_item.done",
          item: {
            type: "reasoning",
            summary: [{ text: "Recovered reasoning" }]
          }
        }
      ])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Hi" }]
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();

      if (next.done) {
        break;
      }

      events.push(next.value);
    }

    expect(events).toContainEqual({
      type: "thinking_delta",
      text: "Recovered reasoning"
    });
  });

  it("accepts plain string responses and reasoning_text deltas", async () => {
    responsesCreate.mockResolvedValueOnce("plain text");

    const { callProviderText, streamProviderResponse } = await import("@/lib/provider");

    await expect(
      callProviderText({
        settings: createSettings({
          reasoningSummaryEnabled: false
        }),
        prompt: "Reply with connected",
        purpose: "test"
      })
    ).resolves.toBe("plain text");

    responsesCreate.mockResolvedValueOnce(
      createAsyncStream([{ type: "response.reasoning_text.delta", delta: "alternate" }])
    );

    const stream = streamProviderResponse({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Hi" }]
    });

    const first = await stream.next();

    expect(first.value).toEqual({ type: "thinking_delta", text: "alternate" });
  });

  it("streams chat completion deltas when using chat_completions mode", async () => {
    chatCreate.mockResolvedValue(
      createAsyncStream([
        { choices: [{ delta: { content: "Hi " } }] },
        {
          choices: [{ delta: { content: "there" } }],
          usage: { prompt_tokens: 4, completion_tokens: 2 }
        }
      ])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        apiMode: "chat_completions",
        reasoningSummaryEnabled: false
      }),
      promptMessages: [{ role: "user", content: "Hi" }]
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();

      if (next.done) {
        expect(next.value.answer).toBe("Hi there");
        break;
      }

      events.push(next.value);
    }

    expect(events.at(-1)).toEqual({
      type: "usage",
      inputTokens: 4,
      outputTokens: 2
    });
  });

  it("streams glm reasoning_content deltas when using chat_completions mode", async () => {
    chatCreate.mockResolvedValue(
      createAsyncStream([
        { choices: [{ delta: { reasoning_content: "Thinking " } }] },
        { choices: [{ delta: { content: "Hi there" } }] }
      ])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        model: "glm-5-turbo",
        apiMode: "chat_completions"
      }),
      promptMessages: [{ role: "user", content: "Hi" }]
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();

      if (next.done) {
        expect(next.value.thinking).toBe("Thinking ");
        expect(next.value.answer).toBe("Hi there");
        break;
      }

      events.push(next.value);
    }

    expect(chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        extra_body: {
          thinking: {
            type: "enabled"
          }
        }
      })
    );

    expect(events).toEqual([
      { type: "thinking_delta", text: "Thinking " },
      { type: "answer_delta", text: "Hi there" },
      { type: "usage", inputTokens: 1, outputTokens: undefined }
    ]);
  });

  it("decodes escaped newline sequences from provider deltas", async () => {
    chatCreate.mockResolvedValue(
      createAsyncStream([
        { choices: [{ delta: { reasoning_content: "Plan:\\n\\n- step one" } }] },
        { choices: [{ delta: { content: "Hello\\n\\nWorld" } }] }
      ])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        model: "glm-5-turbo",
        apiMode: "chat_completions"
      }),
      promptMessages: [{ role: "user", content: "Hi" }]
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();

      if (next.done) {
        expect(next.value.thinking).toBe("Plan:\n\n- step one");
        expect(next.value.answer).toBe("Hello\n\nWorld");
        break;
      }

      events.push(next.value);
    }

    expect(events).toContainEqual({
      type: "thinking_delta",
      text: "Plan:\n\n- step one"
    });
    expect(events).toContainEqual({
      type: "answer_delta",
      text: "Hello\n\nWorld"
    });
  });
});
