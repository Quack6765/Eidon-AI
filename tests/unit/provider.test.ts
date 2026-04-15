import type { ChatStreamEvent, ProviderProfileWithApiKey } from "@/lib/types";

const responsesCreate = vi.fn();
const chatCreate = vi.fn();
const getAttachmentDataUrl = vi.fn(() => "data:image/png;base64,abc123");

vi.mock("@/lib/attachments", () => ({
  getAttachmentDataUrl
}));

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
    providerKind: "openai_compatible" | "github_copilot";
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
    githubUserAccessTokenEncrypted: string;
    githubRefreshTokenEncrypted: string;
    githubTokenExpiresAt: string | null;
    githubRefreshTokenExpiresAt: string | null;
    githubAccountLogin: string | null;
    githubAccountName: string | null;
    createdAt: string;
    updatedAt: string;
  }> = {}
): ProviderProfileWithApiKey {
  return {
    id: "profile_test",
    name: "Test profile",
    providerKind: "openai_compatible",
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
    tokenizerModel: "gpt-tokenizer" as const,
    safetyMarginTokens: 1200,
    leafSourceTokenLimit: 12000,
    leafMinMessageCount: 6,
    mergedMinNodeCount: 4,
    mergedTargetTokens: 1600,
    visionMode: "native" as const,
    visionMcpServerId: null,
    providerPresetId: null,
    githubUserAccessTokenEncrypted: "",
    githubRefreshTokenEncrypted: "",
    githubTokenExpiresAt: null,
    githubRefreshTokenExpiresAt: null,
    githubAccountLogin: null,
    githubAccountName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("provider integration", () => {
  beforeEach(() => {
    responsesCreate.mockReset();
    chatCreate.mockReset();
    getAttachmentDataUrl.mockClear();
  });

  it("routes github copilot profiles through the copilot client", async () => {
    const runGithubCopilotChat = vi.fn().mockResolvedValue("connected");

    vi.doMock("@/lib/github-copilot", () => ({
      runGithubCopilotChat,
      ensureFreshGithubAccessToken: vi.fn(async (profile) => profile),
      streamGithubCopilotChat: vi.fn(),
      buildGithubCopilotClient: vi.fn(),
      listGithubCopilotModels: vi.fn(),
      getGithubConnectionStatus: vi.fn(),
      shouldRefreshGithubToken: vi.fn(),
      clearGithubCopilotConnection: vi.fn(),
      createGithubOauthState: vi.fn(),
      verifyGithubOauthState: vi.fn(),
      getGithubAuthorizeUrl: vi.fn(),
      exchangeGithubCodeForTokens: vi.fn(),
      refreshGithubUserToken: vi.fn()
    }));

    const { callProviderText } = await import("@/lib/provider");

    await expect(
      callProviderText({
        settings: createSettings({
          providerKind: "github_copilot",
          apiKey: "",
          apiBaseUrl: ""
        }),
        prompt: "Reply with connected",
        purpose: "test"
      })
    ).resolves.toBe("connected");

    expect(runGithubCopilotChat).toHaveBeenCalledOnce();
    expect(responsesCreate).not.toHaveBeenCalled();
    expect(chatCreate).not.toHaveBeenCalled();

    vi.doUnmock("@/lib/github-copilot");
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

  it("returns chat completion text and uses disabled ollama reasoning when summaries are off", async () => {
    chatCreate.mockResolvedValue({
      choices: [{ message: { content: "connected" } }]
    });

    const { callProviderText } = await import("@/lib/provider");

    await expect(
      callProviderText({
        settings: createSettings({
          apiMode: "chat_completions",
          apiBaseUrl: "https://ollama.com/v1",
          model: "kimi-k2.5",
          reasoningSummaryEnabled: false
        }),
        prompt: "Reply with connected",
        purpose: "test"
      })
    ).resolves.toBe("connected");

    expect(chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        extra_body: {
          reasoning_effort: "none",
          reasoning: {
            effort: "none"
          }
        }
      })
    );
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

  it("streams response content_part deltas as answer text", async () => {
    responsesCreate.mockResolvedValue(
      createAsyncStream([
        { type: "response.content_part.delta", delta: "Hello " },
        { type: "response.content_part.delta", delta: "world" }
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
        expect(next.value.answer).toBe("Hello world");
        break;
      }

      events.push(next.value);
    }

    expect(events).toEqual([
      { type: "answer_delta", text: "Hello " },
      { type: "answer_delta", text: "world" },
      expect.objectContaining({
        type: "usage",
        inputTokens: expect.any(Number),
        outputTokens: undefined,
        reasoningTokens: undefined
      })
    ]);
  });

  it("recovers final responses message text from output items when earlier deltas were missed", async () => {
    responsesCreate.mockResolvedValue(
      createAsyncStream([
        { type: "response.output_text.delta", delta: "a short story. However" },
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "I don't have any tools that are relevant for writing a short story. However"
              }
            ]
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
        expect(next.value.answer).toBe("I don't have any tools that are relevant for writing a short story. However");
        break;
      }

      events.push(next.value);
    }

    expect(events).toEqual([
      { type: "answer_delta", text: "a short story. However" },
      expect.objectContaining({
        type: "usage",
        inputTokens: expect.any(Number),
        outputTokens: undefined,
        reasoningTokens: undefined
      })
    ]);
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

  it("updates streamed chat tool call names and arguments across chunks", async () => {
    chatCreate.mockResolvedValue(
      createAsyncStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: "search_docs",
                      arguments: "{\"query\":"
                    }
                  }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: "search_code",
                      arguments: "\"MCP\"}"
                    }
                  }
                ]
              }
            }
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1 }
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

    while (true) {
      const next = await stream.next();

      if (next.done) {
        expect(next.value.toolCalls).toEqual([
          {
            id: "call_0",
            name: "search_code",
            arguments: "{\"query\":\"MCP\"}"
          }
        ]);
        break;
      }
    }
  });

  it("serializes multimodal prompt parts for responses mode", async () => {
    responsesCreate.mockResolvedValue(
      createAsyncStream([{ type: "response.output_text.delta", delta: "done" }])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        model: "gpt-5-mini",
        apiMode: "responses"
      }),
      promptMessages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this file?" },
            {
              type: "image",
              attachmentId: "att_1",
              filename: "photo.png",
              mimeType: "image/png",
              relativePath: "conv_1/att_1_photo.png"
            }
          ]
        }
      ]
    });

    await stream.next();

    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "input_text",
                text: expect.stringContaining("Current date and time context")
              })
            ])
          }),
          {
            role: "user",
            content: [
              { type: "input_text", text: "What is in this file?" },
              { type: "input_image", image_url: "data:image/png;base64,abc123" }
            ]
          }
        ])
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("serializes tool outputs and assistant tool calls for responses mode streams", async () => {
    responsesCreate.mockResolvedValue(
      createAsyncStream([
        { type: "response.function_call_arguments.delta", delta: "{}" },
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            call_id: "call_1",
            name: "search_docs",
            arguments: "{\"query\":\"MCP\"}"
          }
        },
        {
          type: "response.output_item.done",
          item: {
            type: "reasoning",
            summary: [{ text: "Recovered" }, { text: " reasoning" }]
          }
        },
        { type: "response.output_text.delta", delta: "done" }
      ])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        apiMode: "responses"
      }),
      tools: [
        {
          type: "function",
          function: {
            name: "search_docs",
            description: "Search docs",
            parameters: { type: "object" }
          }
        }
      ],
      promptMessages: [
        {
          role: "assistant",
          content: "I searched already.",
          toolCalls: [
            {
              id: "call_0",
              name: "search_docs",
              arguments: "{\"query\":\"prior\"}"
            }
          ]
        },
        {
          role: "tool",
          toolCallId: "call_0",
          content: "previous result"
        }
      ]
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();

      if (next.done) {
        expect(next.value.answer).toBe("done");
        expect(next.value.thinking).toBe("Recovered reasoning");
        expect(next.value.toolCalls).toEqual([
          {
            id: "call_1",
            name: "search_docs",
            arguments: "{\"query\":\"MCP\"}"
          }
        ]);
        break;
      }

      events.push(next.value);
    }

    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          expect.objectContaining({
            role: "system",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "input_text",
                text: expect.stringContaining("Current date and time context")
              })
            ])
          }),
          {
            type: "function_call",
            id: "call_0",
            name: "search_docs",
            arguments: "{\"query\":\"prior\"}",
            call_id: "call_0"
          },
          {
            role: "assistant",
            content: [{ type: "input_text", text: "I searched already." }]
          },
          {
            type: "function_call_output",
            call_id: "call_0",
            output: "previous result"
          }
        ],
        tools: [
          {
            type: "function",
            name: "search_docs",
            description: "Search docs",
            parameters: { type: "object" },
            strict: true
          }
        ]
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );

    expect(events).toContainEqual({ type: "thinking_delta", text: "Recovered reasoning" });
    expect(events).toContainEqual({ type: "answer_delta", text: "done" });
  });

  it("serializes multimodal prompt parts for chat completions mode", async () => {
    chatCreate.mockResolvedValue(
      createAsyncStream([{ choices: [{ delta: { content: "done" } }] }])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        model: "gpt-4o-mini",
        apiMode: "chat_completions",
        reasoningSummaryEnabled: false
      }),
      promptMessages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            {
              type: "image",
              attachmentId: "att_1",
              filename: "photo.png",
              mimeType: "image/png",
              relativePath: "conv_1/att_1_photo.png"
            }
          ]
        }
      ]
    });

    await stream.next();

    expect(chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: "system",
            content: expect.any(String)
          }),
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image" },
              {
                type: "image_url",
                image_url: {
                  url: "data:image/png;base64,abc123"
                }
              }
            ]
          }
        ]
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
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
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );

    expect(events).toEqual([
      { type: "thinking_delta", text: "Thinking " },
      { type: "answer_delta", text: "Hi there" },
      expect.objectContaining({
        type: "usage",
        inputTokens: expect.any(Number),
        outputTokens: undefined
      })
    ]);
  });

  it("serializes assistant tool calls and accumulates streamed chat tool call chunks", async () => {
    chatCreate.mockResolvedValue(
      createAsyncStream([
        { choices: [{ delta: { reasoning: "Plan " } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: "search_docs",
                      arguments: "{\"query\":"
                    }
                  }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: "\"MCP\"}"
                    }
                  }
                ]
              }
            }
          ]
        },
        {
          choices: [{ delta: { content: "Done" } }],
          usage: { prompt_tokens: 7, completion_tokens: 3 }
        }
      ])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        apiMode: "chat_completions",
        model: "glm-5-turbo"
      }),
      tools: [
        {
          type: "function",
          function: {
            name: "search_docs",
            description: "Search docs",
            parameters: { type: "object" }
          }
        }
      ],
      promptMessages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_0",
              name: "search_docs",
              arguments: "{\"query\":\"prior\"}"
            }
          ]
        },
        {
          role: "tool",
          toolCallId: "call_0",
          content: "tool result"
        }
      ]
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();

      if (next.done) {
        expect(next.value.answer).toBe("Done");
        expect(next.value.thinking).toBe("Plan ");
        expect(next.value.toolCalls).toEqual([
          {
            id: "call_0",
            name: "search_docs",
            arguments: "{\"query\":\"MCP\"}"
          }
        ]);
        break;
      }

      events.push(next.value);
    }

    expect(chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            type: "function",
            function: {
              name: "search_docs",
              description: "Search docs",
              parameters: { type: "object" }
            }
          }
        ],
        messages: [
          expect.objectContaining({
            role: "system",
            content: expect.any(String)
          }),
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_0",
                type: "function",
                function: {
                  name: "search_docs",
                  arguments: "{\"query\":\"prior\"}"
                }
              }
            ]
          },
          {
            role: "tool",
            tool_call_id: "call_0",
            content: "tool result"
          }
        ]
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );

    expect(events).toContainEqual({ type: "thinking_delta", text: "Plan " });
    expect(events).toContainEqual({ type: "answer_delta", text: "Done" });
    expect(events).toContainEqual(expect.objectContaining({ type: "usage", inputTokens: expect.any(Number), outputTokens: 3 }));
  });

  it("uses ollama reasoning controls and parses thinking deltas", async () => {
    chatCreate.mockResolvedValue(
      createAsyncStream([
        { choices: [{ delta: { thinking: "Thinking " } }] },
        { choices: [{ delta: { content: "Hi there" } }] }
      ])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        name: "Ollama Cloud",
        apiBaseUrl: "https://ollama.com/v1",
        model: "kimi-k2.5",
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
          reasoning_effort: "medium",
          reasoning: {
            effort: "medium"
          }
        }
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );

    expect(events).toEqual([
      { type: "thinking_delta", text: "Thinking " },
      { type: "answer_delta", text: "Hi there" },
      expect.objectContaining({
        type: "usage",
        inputTokens: expect.any(Number),
        outputTokens: undefined
      })
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

  it("decodes double-escaped newline sequences from provider deltas", async () => {
    chatCreate.mockResolvedValue(
      createAsyncStream([
        { choices: [{ delta: { reasoning_content: "Plan:\\\\n\\\\n- step one" } }] },
        { choices: [{ delta: { content: "Hello\\\\n\\\\nWorld" } }] }
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

  it("passes strict: true for tool definitions in responses API", async () => {
    responsesCreate.mockResolvedValue(
      createAsyncStream([{ type: "response.output_text.delta", delta: "result" }])
    );

    const { streamProviderResponse } = await import("@/lib/provider");

    const stream = streamProviderResponse({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "test" }],
      tools: [
        {
          type: "function" as const,
          function: {
            name: "test_tool",
            description: "A test tool",
            parameters: {
              type: "object",
              properties: {
                choice: { type: "string", enum: ["a", "b"] }
              },
              required: ["choice"],
              additionalProperties: false
            } as unknown as { type: string; properties?: Record<string, unknown>; required?: string[] }
          }
        }
      ]
    });

    while (!(await stream.next()).done) {}

    const toolCall = responsesCreate.mock.calls[0][0];
    expect(toolCall.tools[0].strict).toBe(true);
  });

  it("does not emit duplicate action events for custom copilot tools", async () => {
    vi.resetModules();

    vi.doMock("@/lib/github-copilot", () => ({
      runGithubCopilotChat: vi.fn(),
      ensureFreshGithubAccessToken: vi.fn(async (profile) => profile),
      streamGithubCopilotChat: vi.fn(async (input: { onEvent: (event: unknown) => void }) => {
        input.onEvent({ type: "assistant.reasoning_delta", data: { deltaContent: "Thinking " } });
        input.onEvent({
          type: "tool.execution_start",
          data: {
            toolCallId: "tool_custom_1",
            toolName: "execute_shell_command",
            arguments: { command: "pwd" }
          }
        });
        input.onEvent({
          type: "tool.execution_complete",
          data: {
            toolCallId: "tool_custom_1",
            toolName: "execute_shell_command",
            success: true,
            result: { content: "ok" }
          }
        });
        input.onEvent({ type: "assistant.message_delta", data: { deltaContent: "Done" } });
      }),
      buildGithubCopilotClient: vi.fn(),
      listGithubCopilotModels: vi.fn(),
      getGithubConnectionStatus: vi.fn(),
      shouldRefreshGithubToken: vi.fn(),
      clearGithubCopilotConnection: vi.fn(),
      createGithubOauthState: vi.fn(),
      verifyGithubOauthState: vi.fn(),
      getGithubAuthorizeUrl: vi.fn(),
      exchangeGithubCodeForTokens: vi.fn(),
      refreshGithubUserToken: vi.fn()
    }));

    vi.doMock("@/lib/copilot-tools", () => ({
      buildCopilotTools: vi.fn(() => [
        {
          name: "execute_shell_command",
          description: "Run a command",
          handler: vi.fn(),
          skipPermission: true,
          overridesBuiltInTool: true
        }
      ])
    }));

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        providerKind: "github_copilot",
        apiKey: "",
        apiBaseUrl: "",
        model: "openai/gpt-4.1"
      }),
      promptMessages: [{ role: "user", content: "Hi" }],
      copilotToolContext: {
        mcpToolSets: [],
        skills: [],
        loadedSkillIds: new Set(),
        memoriesEnabled: false
      }
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();

      if (next.done) {
        expect(next.value.thinking).toBe("Thinking ");
        expect(next.value.answer).toBe("Done");
        break;
      }

      events.push(next.value);
    }

    expect(events).toEqual([
      { type: "thinking_delta", text: "Thinking " },
      { type: "answer_delta", text: "Done" }
    ]);

    vi.doUnmock("@/lib/copilot-tools");
    vi.doUnmock("@/lib/github-copilot");
    vi.resetModules();
  });

  it("maps built-in copilot tool results from the sdk result payload", async () => {
    vi.resetModules();

    vi.doMock("@/lib/github-copilot", () => ({
      runGithubCopilotChat: vi.fn(),
      ensureFreshGithubAccessToken: vi.fn(async (profile) => profile),
      streamGithubCopilotChat: vi.fn(async (input: { onEvent: (event: unknown) => void }) => {
        input.onEvent({
          type: "tool.execution_start",
          data: {
            toolCallId: "tool_builtin_1",
            toolName: "edit_file",
            arguments: { path: "plan.md" }
          }
        });
        input.onEvent({
          type: "tool.execution_complete",
          data: {
            toolCallId: "tool_builtin_1",
            toolName: "edit_file",
            success: true,
            result: {
              content: "patched",
              detailedContent: "Applied patch to plan.md"
            }
          }
        });
        input.onEvent({ type: "assistant.message_delta", data: { deltaContent: "Done" } });
      }),
      buildGithubCopilotClient: vi.fn(),
      listGithubCopilotModels: vi.fn(),
      getGithubConnectionStatus: vi.fn(),
      shouldRefreshGithubToken: vi.fn(),
      clearGithubCopilotConnection: vi.fn(),
      createGithubOauthState: vi.fn(),
      verifyGithubOauthState: vi.fn(),
      getGithubAuthorizeUrl: vi.fn(),
      exchangeGithubCodeForTokens: vi.fn(),
      refreshGithubUserToken: vi.fn()
    }));

    vi.doMock("@/lib/copilot-tools", () => ({
      buildCopilotTools: vi.fn(() => [
        {
          name: "execute_shell_command",
          description: "Run a command",
          handler: vi.fn(),
          skipPermission: true,
          overridesBuiltInTool: true
        }
      ])
    }));

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        providerKind: "github_copilot",
        apiKey: "",
        apiBaseUrl: "",
        model: "openai/gpt-4.1"
      }),
      promptMessages: [{ role: "user", content: "Hi" }],
      copilotToolContext: {
        mcpToolSets: [],
        skills: [],
        loadedSkillIds: new Set(),
        memoriesEnabled: false
      }
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();
      if (next.done) {
        break;
      }
      events.push(next.value);
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "action_start",
        action: expect.objectContaining({
          id: "tool_builtin_1",
          toolName: "edit_file",
          label: "edit_file",
          arguments: { path: "plan.md" }
        })
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "action_complete",
        action: expect.objectContaining({
          id: "tool_builtin_1",
          toolName: "edit_file",
          label: "edit_file",
          resultSummary: "Applied patch to plan.md"
        })
      })
    );

    vi.doUnmock("@/lib/copilot-tools");
    vi.doUnmock("@/lib/github-copilot");
    vi.resetModules();
  });

  it("maps built-in copilot tool errors without a prior start event", async () => {
    vi.resetModules();

    vi.doMock("@/lib/github-copilot", () => ({
      runGithubCopilotChat: vi.fn(),
      ensureFreshGithubAccessToken: vi.fn(async (profile) => profile),
      streamGithubCopilotChat: vi.fn(async (input: { onEvent: (event: unknown) => void }) => {
        input.onEvent({
          type: "tool.execution_complete",
          timestamp: "2026-04-10T13:00:00.000Z",
          data: {
            toolCallId: "tool_builtin_2",
            toolName: "load_skill",
            success: false,
            error: { message: "skill not found" }
          }
        });
      }),
      buildGithubCopilotClient: vi.fn(),
      listGithubCopilotModels: vi.fn(),
      getGithubConnectionStatus: vi.fn(),
      shouldRefreshGithubToken: vi.fn(),
      clearGithubCopilotConnection: vi.fn(),
      createGithubOauthState: vi.fn(),
      verifyGithubOauthState: vi.fn(),
      getGithubAuthorizeUrl: vi.fn(),
      exchangeGithubCodeForTokens: vi.fn(),
      refreshGithubUserToken: vi.fn()
    }));

    vi.doMock("@/lib/copilot-tools", () => ({
      buildCopilotTools: vi.fn(() => [
        {
          name: "execute_shell_command",
          description: "Run a command",
          handler: vi.fn(),
          skipPermission: true,
          overridesBuiltInTool: true
        }
      ])
    }));

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        providerKind: "github_copilot",
        apiKey: "",
        apiBaseUrl: "",
        model: "openai/gpt-4.1"
      }),
      promptMessages: [{ role: "user", content: "Hi" }],
      copilotToolContext: {
        mcpToolSets: [],
        skills: [],
        loadedSkillIds: new Set(),
        memoriesEnabled: false
      }
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();
      if (next.done) break;
      events.push(next.value);
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "action_error",
        action: expect.objectContaining({
          id: "tool_builtin_2",
          kind: "skill_load",
          toolName: "load_skill",
          label: "load_skill",
          resultSummary: "skill not found",
          startedAt: "2026-04-10T13:00:00.000Z",
          completedAt: "2026-04-10T13:00:00.000Z"
        })
      })
    );

    vi.doUnmock("@/lib/copilot-tools");
    vi.doUnmock("@/lib/github-copilot");
    vi.resetModules();
  });

  it("summarizes structured built-in copilot arguments and falls back to result.content", async () => {
    vi.resetModules();

    vi.doMock("@/lib/github-copilot", () => ({
      runGithubCopilotChat: vi.fn(),
      ensureFreshGithubAccessToken: vi.fn(async (profile) => profile),
      streamGithubCopilotChat: vi.fn(async (input: { onEvent: (event: unknown) => void }) => {
        input.onEvent({
          type: "tool.execution_start",
          data: {
            toolCallId: "tool_builtin_3",
            toolName: "edit_file",
            arguments: {
              payload: {
                lines: Array.from({ length: 40 }, (_, index) => `line-${index}`)
              }
            }
          }
        });
        input.onEvent({
          type: "tool.execution_complete",
          data: {
            toolCallId: "tool_builtin_3",
            toolName: "edit_file",
            success: true,
            result: { content: "updated file" }
          }
        });
      }),
      buildGithubCopilotClient: vi.fn(),
      listGithubCopilotModels: vi.fn(),
      getGithubConnectionStatus: vi.fn(),
      shouldRefreshGithubToken: vi.fn(),
      clearGithubCopilotConnection: vi.fn(),
      createGithubOauthState: vi.fn(),
      verifyGithubOauthState: vi.fn(),
      getGithubAuthorizeUrl: vi.fn(),
      exchangeGithubCodeForTokens: vi.fn(),
      refreshGithubUserToken: vi.fn()
    }));

    vi.doMock("@/lib/copilot-tools", () => ({
      buildCopilotTools: vi.fn(() => [
        {
          name: "execute_shell_command",
          description: "Run a command",
          handler: vi.fn(),
          skipPermission: true,
          overridesBuiltInTool: true
        }
      ])
    }));

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings({
        providerKind: "github_copilot",
        apiKey: "",
        apiBaseUrl: "",
        model: "openai/gpt-4.1"
      }),
      promptMessages: [{ role: "user", content: "Hi" }],
      copilotToolContext: {
        mcpToolSets: [],
        skills: [],
        loadedSkillIds: new Set(),
        memoriesEnabled: false
      }
    });

    const events: ChatStreamEvent[] = [];

    while (true) {
      const next = await stream.next();
      if (next.done) break;
      events.push(next.value);
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "action_start",
        action: expect.objectContaining({
          id: "tool_builtin_3",
          detail: expect.stringContaining("..."),
          arguments: {
            payload: {
              lines: Array.from({ length: 40 }, (_, index) => `line-${index}`)
            }
          }
        })
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "action_complete",
        action: expect.objectContaining({
          id: "tool_builtin_3",
          resultSummary: "updated file"
        })
      })
    );

    vi.doUnmock("@/lib/copilot-tools");
    vi.doUnmock("@/lib/github-copilot");
    vi.resetModules();
  });

  it("returns queued function calls from responses output items", async () => {
    responsesCreate.mockResolvedValueOnce(
      createAsyncStream([
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            call_id: "call_1",
            name: "search_docs",
            arguments: "{\"query\":\"MCP\"}"
          }
        },
        {
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 5,
              output_tokens: 2,
              output_tokens_details: { reasoning_tokens: 1 }
            }
          }
        }
      ])
    );

    const { streamProviderResponse } = await import("@/lib/provider");
    const stream = streamProviderResponse({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find MCP docs" }]
    });

    let result: Awaited<ReturnType<typeof stream.next>>["value"] | undefined;
    while (true) {
      const next = await stream.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }

    expect(result).toEqual(
      expect.objectContaining({
        toolCalls: [
          {
            id: "call_1",
            name: "search_docs",
            arguments: "{\"query\":\"MCP\"}"
          }
        ],
        usage: {
          inputTokens: 5,
          outputTokens: 2,
          reasoningTokens: 1
        }
      })
    );
  });
});
