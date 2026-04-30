// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ChatView } from "@/components/chat-view";
import { ContextTokensProvider } from "@/lib/context-tokens-context";
import type { SpeechSessionSnapshot, SttEngine, SttLanguage } from "@/lib/speech/types";
import type { Message, MessageAttachment, MessageTimelineItem, QueuedMessage } from "@/lib/types";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    refresh
  })
}));

const wsMock = vi.hoisted(() => ({
  onMessage: null as ((msg: unknown) => void) | null,
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  connected: true,
  failed: false
}));

const bootstrapMock = vi.hoisted(() => ({
  readChatBootstrap: vi.fn(),
  clearChatBootstrap: vi.fn()
}));

const conversationEventMock = vi.hoisted(() => ({
  dispatchConversationActivityUpdated: vi.fn(),
  dispatchConversationTitleUpdated: vi.fn(),
  dispatchConversationRemoved: vi.fn()
}));

const speechMock = vi.hoisted(() => {
  const audioMonitor = {
    readLevel: vi.fn(() => 0.42),
    dispose: vi.fn()
  };

  const createAudioLevelMonitor = vi.fn(() => audioMonitor);

  const createSpeechEngine = vi.fn((engine: "browser" | "embedded") => ({
    isSupported: () => engine !== "embedded",
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => ({ transcript: "" })),
    dispose: vi.fn()
  }));

  const createSpeechController = vi.fn((input: { audioMonitor: typeof audioMonitor }) => {
    let snapshot: SpeechSessionSnapshot = {
      phase: "idle",
      engine: "browser",
      language: "en",
      level: 0,
      error: null
    };

    const controller = {
      getSnapshot: vi.fn(() => ({
        ...snapshot,
        level: snapshot.phase === "listening" ? input.audioMonitor.readLevel() : 0
      })),
      start: vi.fn(async ({ engine, language }: { engine: SttEngine; language: SttLanguage }) => {
        snapshot = {
          ...snapshot,
          phase: "requesting-permission",
          engine,
          language,
          error: null
        };
        snapshot = {
          ...snapshot,
          phase: "listening",
          engine,
          language,
          error: null
        };
      }),
      stop: vi.fn(async () => {
        snapshot = {
          ...snapshot,
          phase: "idle",
          level: 0,
          error: null
        };
        return { transcript: "mock transcript" };
      }),
      dispose: vi.fn()
    };

    return controller;
  });

  return {
    audioMonitor,
    createAudioLevelMonitor,
    createSpeechController,
    createSpeechEngine
  };
});

vi.mock("@/lib/ws-client", () => ({
  useWebSocket: (options: { onMessage?: (msg: unknown) => void }) => {
    wsMock.onMessage = options.onMessage ?? null;
    return wsMock;
  }
}));

vi.mock("@/lib/conversation-drafts", () => ({
  deleteConversationIfStillEmpty: vi.fn().mockResolvedValue(false)
}));

vi.mock("@/lib/chat-bootstrap", () => ({
  readChatBootstrap: bootstrapMock.readChatBootstrap,
  clearChatBootstrap: bootstrapMock.clearChatBootstrap
}));

vi.mock("@/lib/conversation-events", () => ({
  dispatchConversationRemoved: conversationEventMock.dispatchConversationRemoved,
  dispatchConversationActivityUpdated: conversationEventMock.dispatchConversationActivityUpdated,
  dispatchConversationTitleUpdated: conversationEventMock.dispatchConversationTitleUpdated
}));

vi.mock("@/lib/speech/audio-level-monitor", () => ({
  createAudioLevelMonitor: speechMock.createAudioLevelMonitor
}));

vi.mock("@/lib/speech/create-speech-engine", () => ({
  createSpeechEngine: speechMock.createSpeechEngine
}));

vi.mock("@/lib/speech/speech-controller", () => ({
  createSpeechController: speechMock.createSpeechController
}));

function createAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "att_1",
    conversationId: "conv_1",
    messageId: null,
    filename: "photo.png",
    mimeType: "image/png",
    byteSize: 128,
    sha256: "hash",
    relativePath: "conv_1/att_1_photo.png",
    kind: "image",
    extractedText: "",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function createQueuedMessage(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: "queue_1",
    conversationId: "conv_1",
    content: "Queued follow-up",
    status: "pending",
    sortOrder: 0,
    failureMessage: null,
    mode: "chat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processingStartedAt: null,
    ...overrides
  };
}

type ChatViewPayload = React.ComponentProps<typeof ChatView>["payload"];

function createPayload(overrides: Partial<ChatViewPayload> = {}): ChatViewPayload {
  return {
    conversation: {
      id: "conv_1",
      title: "Test conversation",
      titleGenerationStatus: "completed" as const,
      folderId: null,
      providerProfileId: "profile_default",
      automationId: null,
      automationRunId: null,
      conversationOrigin: "manual",
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: false
    },
    messages: [] as Message[],
    queuedMessages: [],
    settings: {
      sttEngine: "browser",
      sttLanguage: "en"
    },
    providerProfiles: [
      {
        id: "profile_default",
        name: "Default",
        apiBaseUrl: "https://api.example.com/v1",
        model: "gpt-5-mini",
        apiMode: "responses" as const,
        systemPrompt: "Be exact",
        temperature: 0.2,
        maxOutputTokens: 512,
        reasoningEffort: "medium" as const,
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
        providerKind: "openai_compatible" as "openai_compatible" | "github_copilot",
        githubTokenExpiresAt: null,
        githubRefreshTokenExpiresAt: null,
        githubAccountLogin: null,
        githubAccountName: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hasApiKey: true,
        githubConnectionStatus: "disconnected" as "disconnected" | "connected" | "expired"
      }
    ],
    defaultProviderProfileId: "profile_default",
    debug: {
      rawTurnCount: 0,
      memoryNodeCount: 0,
      latestCompactionAt: null
    },
    ...overrides
  };
}

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    conversationId: "conv_1",
    role: "assistant",
    content: "Assistant reply",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 3,
    systemKind: null,
    compactedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function createMemoryProposalMessage(
  overrides: Partial<Message> = {},
  actionOverrides: Partial<Extract<MessageTimelineItem, { timelineKind: "action" }>> = {}
): Message {
  return {
    id: "msg_assistant_memory",
    conversationId: "conv_1",
    role: "assistant",
    content: "I can remember that.",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0,
    systemKind: null,
    compactedAt: null,
    createdAt: new Date().toISOString(),
    timeline: [
      {
        id: "act_memory",
        messageId: "msg_assistant_memory",
        timelineKind: "action",
        kind: "create_memory",
        status: "pending",
        serverId: null,
        skillId: null,
        toolName: "create_memory",
        label: "Create memory proposal",
        detail: "TypeScript preference",
        arguments: {
          content: "TypeScript preference",
          category: "preference"
        },
        resultSummary: "",
        sortOrder: 0,
        startedAt: new Date().toISOString(),
        completedAt: null,
        proposalState: "pending",
        proposalPayload: {
          operation: "create",
          targetMemoryId: null,
          proposedMemory: {
            content: "TypeScript preference",
            category: "preference"
          }
        },
        proposalUpdatedAt: new Date().toISOString(),
        ...actionOverrides
      }
    ],
    ...overrides
  };
}

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("chat view", () => {
  const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints");
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  const originalAudioContext = Object.getOwnPropertyDescriptor(window, "AudioContext");

  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    wsMock.onMessage = null;
    wsMock.connected = true;
    wsMock.failed = false;
    wsMock.send.mockReset();
    wsMock.subscribe.mockReset();
    wsMock.unsubscribe.mockReset();
    bootstrapMock.readChatBootstrap.mockReset();
    bootstrapMock.readChatBootstrap.mockReturnValue(null);
    bootstrapMock.clearChatBootstrap.mockReset();
    conversationEventMock.dispatchConversationActivityUpdated.mockReset();
    conversationEventMock.dispatchConversationTitleUpdated.mockReset();
    speechMock.createAudioLevelMonitor.mockClear();
    speechMock.createSpeechController.mockClear();
    speechMock.createSpeechEngine.mockClear();
    speechMock.audioMonitor.readLevel.mockReturnValue(0.42);
    speechMock.audioMonitor.dispose.mockReset();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [
            {
              stop: vi.fn()
            }
          ]
        })
      }
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class {
        createMediaStreamSource() {
          return {
            connect: vi.fn(),
            disconnect: vi.fn()
          };
        }

        createAnalyser() {
          return {
            fftSize: 0,
            getByteTimeDomainData: vi.fn()
          };
        }

        resume() {
          return Promise.resolve();
        }

        close() {
          return Promise.resolve();
        }
      }
    });
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ personas: [] })
    } as Response);
    window.history.pushState({}, "", "/chat/conv_1");
  });

  afterEach(() => {
    if (originalMaxTouchPoints) {
      Object.defineProperty(navigator, "maxTouchPoints", originalMaxTouchPoints);
    } else {
      Object.defineProperty(navigator, "maxTouchPoints", {
        configurable: true,
        value: 0
      });
    }

    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined
      });
    }

    if (originalAudioContext) {
      Object.defineProperty(window, "AudioContext", originalAudioContext);
    } else {
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: undefined
      });
    }
  });

  function renderWithProvider(ui: React.ReactElement) {
    return render(React.createElement(ContextTokensProvider, null, ui));
  }

  function renderWithProviderStrict(ui: React.ReactElement) {
    return render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(ContextTokensProvider, null, ui)
      )
    );
  }

  it("uploads an attachment from the file input and removes it from the pending list", async () => {
    const attachment = createAttachment();
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ attachments: [attachment] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      } as Response);

    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["binary"], "photo.png", { type: "image/png" });

    fireEvent.change(input, {
      target: {
        files: [file]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("photo.png")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove photo.png" }));

    await waitFor(() => {
      expect(screen.queryByText("photo.png")).toBeNull();
    });
  });

  it("focuses the composer textarea when the conversation loads", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
  });

  it("does not autofocus the composer on touch devices", () => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 1
    });

    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    expect(
      screen.getByPlaceholderText(
        "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
      )
    ).not.toHaveFocus();
  });

  it("shows a drop overlay and uploads dropped files", async () => {
    const attachment = createAttachment({
      id: "att_2",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "hello"
    });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ attachments: [attachment] })
      } as Response);

    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const root = container.querySelector(".contents") as HTMLElement;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    fireEvent.dragEnter(root, {
      dataTransfer: {
        types: ["Files"]
      }
    });

    fireEvent.drop(root, {
      dataTransfer: {
        files: [file],
        types: ["Files"]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });

    expect(screen.queryByText("Drop files to attach")).toBeNull();
  });

  it("approves a memory proposal and updates the assistant timeline in place", async () => {
    const payload = createPayload();
    payload.messages = [createMemoryProposalMessage()];

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: {
            id: "act_memory",
            messageId: "msg_assistant_memory",
            kind: "create_memory",
            status: "completed",
            serverId: null,
            skillId: null,
            toolName: "create_memory",
            label: "Create memory proposal",
            detail: "Prefers strict TypeScript",
            arguments: {
              content: "Prefers strict TypeScript",
              category: "work"
            },
            resultSummary: "",
            sortOrder: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            proposalState: "approved",
            proposalPayload: {
              operation: "create",
              targetMemoryId: null,
              proposedMemory: {
                content: "Prefers strict TypeScript",
                category: "work"
              }
            },
            proposalUpdatedAt: new Date().toISOString()
          }
        })
      } as Response);

    renderWithProvider(React.createElement(ChatView, { payload }));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("TypeScript preference"), {
      target: { value: "Prefers strict TypeScript" }
    });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "work" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        "/api/message-actions/act_memory/approve",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            content: "Prefers strict TypeScript",
            category: "work"
          })
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Memory saved")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("dismisses a memory proposal and updates the assistant timeline in place", async () => {
    const payload = createPayload();
    payload.messages = [createMemoryProposalMessage()];

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: {
            id: "act_memory",
            messageId: "msg_assistant_memory",
            kind: "create_memory",
            status: "completed",
            serverId: null,
            skillId: null,
            toolName: "create_memory",
            label: "Create memory proposal",
            detail: "TypeScript preference",
            arguments: {
              content: "TypeScript preference",
              category: "preference"
            },
            resultSummary: "",
            sortOrder: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            proposalState: "dismissed",
            proposalPayload: {
              operation: "create",
              targetMemoryId: null,
              proposedMemory: {
                content: "TypeScript preference",
                category: "preference"
              }
            },
            proposalUpdatedAt: new Date().toISOString()
          }
        })
      } as Response);

    renderWithProvider(React.createElement(ChatView, { payload }));

    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        "/api/message-actions/act_memory/dismiss",
        expect.objectContaining({
          method: "POST"
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Memory ignored")).toBeInTheDocument();
    });
  });

  it("surfaces memory approval failures without breaking the conversation view", async () => {
    const payload = createPayload();
    payload.messages = [createMemoryProposalMessage()];

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Unable to approve memory proposal" })
      } as Response);

    renderWithProvider(React.createElement(ChatView, { payload }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        screen.getAllByText("Unable to approve memory proposal").length
      ).toBeGreaterThan(0);
    });

    expect(screen.getByText("TypeScript preference")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("renders resolved update proposals as specialized cards after mutation", async () => {
    const payload = createPayload();
    payload.messages = [
      createMemoryProposalMessage(
        {},
        {
          kind: "update_memory",
          toolName: "update_memory",
          label: "Update memory proposal",
          detail: "Prefers strict TypeScript",
          arguments: {
            id: "mem_1",
            content: "Prefers strict TypeScript",
            category: "work"
          },
          proposalPayload: {
            operation: "update",
            targetMemoryId: "mem_1",
            currentMemory: {
              id: "mem_1",
              content: "TypeScript preference",
              category: "preference"
            },
            proposedMemory: {
              content: "Prefers strict TypeScript",
              category: "work"
            }
          }
        }
      )
    ];

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: {
            id: "act_memory",
            messageId: "msg_assistant_memory",
            kind: "update_memory",
            status: "completed",
            serverId: null,
            skillId: null,
            toolName: "update_memory",
            label: "Update memory proposal",
            detail: "Prefers strict TypeScript",
            arguments: {
              id: "mem_1",
              content: "Prefers strict TypeScript",
              category: "work"
            },
            resultSummary: "",
            sortOrder: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            proposalState: "approved",
            proposalPayload: {
              operation: "update",
              targetMemoryId: "mem_1",
              currentMemory: {
                id: "mem_1",
                content: "TypeScript preference",
                category: "preference"
              },
              proposedMemory: {
                content: "Prefers strict TypeScript",
                category: "work"
              }
            },
            proposalUpdatedAt: new Date().toISOString()
          }
        })
      } as Response);

    renderWithProvider(React.createElement(ChatView, { payload }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Memory updated")).toBeInTheDocument();
    });

    expect(screen.getByText("Prefers strict TypeScript")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update memory proposal" })).toBeNull();
  });

  it("sends a message via WebSocket when the user submits", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "Hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "message",
        conversationId: "conv_1",
        content: "Hello world",
        attachmentIds: []
      });
    });
  });

  it("queues a follow-up over WebSocket when the conversation already has an active turn", async () => {
    renderWithProvider(
      React.createElement(ChatView, {
        payload: createPayload({
          conversation: {
            ...createPayload().conversation,
            isActive: true
          }
        })
      })
    );

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "Queued follow-up" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "queue_message",
        conversationId: "conv_1",
        content: "Queued follow-up"
      });
    });

    expect(wsMock.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "message"
      })
    );
  });

  it("shows an error instead of queuing a message when the websocket transport is unavailable", async () => {
    wsMock.connected = false;
    wsMock.failed = true;

    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "Hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(
        screen.getByText("Realtime chat connection is unavailable. Restart Eidon with the websocket server enabled.")
      ).toBeInTheDocument();
    });

    expect(wsMock.send).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".animate-slide-up")).toHaveLength(1);
    expect(textarea).toHaveValue("Hello world");
  });

  it("appends dictated text into the draft without sending a message", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );
    expect(screen.queryByRole("combobox", { name: "Speech language" })).toBeNull();

    fireEvent.change(textarea, { target: { value: "Existing draft   " } });
    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop voice input" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop voice input" }));

    await waitFor(() => {
      expect(textarea).toHaveValue("Existing draft\nmock transcript");
    });

    expect(wsMock.send).not.toHaveBeenCalled();
  });

  it("does not submit when Enter is pressed during active voice input", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop voice input" })).toBeInTheDocument();
    });

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(wsMock.send).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("Keep this draft");
  });

  it("shows an inline error when the selected speech engine is unsupported", async () => {
    renderWithProvider(
      React.createElement(ChatView, {
        payload: createPayload({
          settings: {
            sttEngine: "embedded",
            sttLanguage: "en"
          }
        })
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));

    await waitFor(() => {
      expect(screen.getByText("Selected speech engine is unavailable.")).toBeInTheDocument();
    });

    expect(wsMock.send).not.toHaveBeenCalled();
  });

  it("submits the bootstrapped home prompt once the WebSocket is connected", async () => {
    bootstrapMock.readChatBootstrap.mockReturnValue({
      message: "Bootstrapped prompt",
      attachments: []
    });

    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "message",
        conversationId: "conv_1",
        content: "Bootstrapped prompt",
        attachmentIds: []
      });
    });

    expect(bootstrapMock.clearChatBootstrap).toHaveBeenCalledWith("conv_1");
  });

  it("forwards bootstrapped message with persona once the websocket is connected", async () => {
    bootstrapMock.readChatBootstrap.mockReturnValue({
      message: "Generate a matte painting",
      attachments: [],
      personaId: "persona_1"
    });

    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "message",
        conversationId: "conv_1",
        content: "Generate a matte painting",
        attachmentIds: [],
        personaId: "persona_1"
      });
    });
  });

  it("submits the bootstrapped home prompt once under strict mode remounts", async () => {
    let storedBootstrapPayload: { message: string; attachments: MessageAttachment[] } | null = {
      message: "Strict prompt",
      attachments: []
    };
    bootstrapMock.readChatBootstrap.mockImplementation(() => storedBootstrapPayload);
    bootstrapMock.clearChatBootstrap.mockImplementation(() => {
      storedBootstrapPayload = null;
    });

    render(
      React.createElement(
        ContextTokensProvider,
        null,
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(ChatView, { payload: createPayload() })
        )
      )
    );

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "message",
        conversationId: "conv_1",
        content: "Strict prompt",
        attachmentIds: []
      });
    });

    expect(wsMock.send).toHaveBeenCalledTimes(1);
    expect(bootstrapMock.clearChatBootstrap).toHaveBeenCalledWith("conv_1");
  });

  it("reconciles a bootstrapped home submission with attachments from polling", async () => {
    const imageAttachment = createAttachment({
      id: "att_image",
      filename: "photo.png",
      mimeType: "image/png",
      kind: "image"
    });
    const textAttachment = createAttachment({
      id: "att_text",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "hello"
    });
    let conversationFetchCount = 0;

    bootstrapMock.readChatBootstrap.mockReturnValue({
      message: "Bootstrapped prompt",
      attachments: [imageAttachment, textAttachment]
    });

    vi.mocked(global.fetch).mockImplementation((input) => {
      if (input === "/api/personas") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ personas: [] })
        } as Response);
      }

      if (input === "/api/conversations/conv_1") {
        conversationFetchCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            conversation: {
              ...createPayload().conversation,
              isActive: false
            },
            messages: [
              createMessage({
                id: "msg_user_server",
                role: "user",
                content: "Bootstrapped prompt",
                attachments: [imageAttachment, textAttachment]
              }),
              createMessage({
                id: "msg_assistant",
                role: "assistant",
                content: "Attachment received",
                status: "completed"
              })
            ]
          })
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });

    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "message",
        conversationId: "conv_1",
        content: "Bootstrapped prompt",
        attachmentIds: ["att_image", "att_text"]
      });
    });

    await waitFor(() => {
      expect(conversationFetchCount).toBeGreaterThan(0);
    });

    await waitFor(
      () => {
        expect(screen.getAllByText("Bootstrapped prompt")).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: "Preview photo.png" })).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: "Preview notes.txt" })).toHaveLength(1);
      },
      { timeout: 2500 }
    );
  });

  it("removes an orphaned local duplicate when polling confirms the server user message", async () => {
    const imageAttachment = createAttachment({
      id: "att_image",
      filename: "photo.png",
      mimeType: "image/png",
      kind: "image"
    });
    const textAttachment = createAttachment({
      id: "att_text",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "hello"
    });
    const serverUserMessage = createMessage({
      id: "msg_user_server",
      role: "user",
      content: "Bootstrapped prompt",
      attachments: [imageAttachment, textAttachment]
    });
    const orphanedLocalMessage = createMessage({
      id: "local_orphan",
      role: "user",
      content: "Bootstrapped prompt",
      attachments: [imageAttachment, textAttachment]
    });
    const assistantStreamingMessage = createMessage({
      id: "msg_assistant",
      role: "assistant",
      content: "",
      status: "streaming"
    });
    let conversationFetchCount = 0;

    vi.mocked(global.fetch).mockImplementation((input) => {
      if (input === "/api/personas") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ personas: [] })
        } as Response);
      }

      if (input === "/api/conversations/conv_1") {
        conversationFetchCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            conversation: {
              ...createPayload().conversation,
              isActive: false
            },
            messages: [
              serverUserMessage,
              {
                ...assistantStreamingMessage,
                content: "Attachment received",
                status: "completed"
              }
            ]
          })
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });

    renderWithProvider(
      React.createElement(ChatView, {
        payload: createPayload({
          conversation: {
            ...createPayload().conversation,
            isActive: true
          },
          messages: [serverUserMessage, assistantStreamingMessage, orphanedLocalMessage]
        })
      })
    );

    await waitFor(() => {
      expect(conversationFetchCount).toBeGreaterThan(0);
    });

    await waitFor(
      () => {
        expect(screen.getAllByText("Bootstrapped prompt")).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: "Preview photo.png" })).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: "Preview notes.txt" })).toHaveLength(1);
      },
      { timeout: 2500 }
    );
  });

  it("deletes an empty conversation when navigating away before sending a message", async () => {
    const { deleteConversationIfStillEmpty } = await import("@/lib/conversation-drafts");

    const view = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    window.history.pushState({}, "", "/");
    view.unmount();

    await waitFor(() => {
      expect(deleteConversationIfStillEmpty).toHaveBeenCalledWith("conv_1");
    });
  });

  it("keeps an empty conversation when the chat view remounts on the same route", async () => {
    const { deleteConversationIfStillEmpty } = await import("@/lib/conversation-drafts");

    const view = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    view.unmount();

    expect(deleteConversationIfStillEmpty).not.toHaveBeenCalled();
  });

  it("processes a WebSocket snapshot to update messages", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "snapshot",
      conversationId: "conv_1",
      messages: [
        {
          id: "msg_user",
          conversationId: "conv_1",
          role: "user",
          content: "Hello",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 5,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        },
        {
          id: "msg_assistant",
          conversationId: "conv_1",
          role: "assistant",
          content: "Hi there!",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 3,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        }
      ]
    });

    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
      expect(screen.getByText("Hi there!")).toBeInTheDocument();
    });
  });

  it("hydrates running action rows for an active streaming message from snapshot state", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_streaming_image" }
      });
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "thinking_delta", text: "Preparing image prompt" }
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Thinking ..." })).toBeInTheDocument();
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          createMessage({
            id: "msg_streaming_image",
            role: "assistant",
            content: "",
            thinkingContent: "Preparing image prompt",
            status: "streaming",
            estimatedTokens: 0,
            timeline: [
              {
                id: "act_streaming_image",
                messageId: "msg_streaming_image",
                timelineKind: "action",
                kind: "image_generation",
                status: "running",
                serverId: null,
                skillId: null,
                toolName: null,
                label: "Generate image",
                detail: "Generate an image of a blue circle",
                arguments: null,
                resultSummary: "",
                sortOrder: 0,
                startedAt: new Date().toISOString(),
                completedAt: null,
                proposalState: null,
                proposalPayload: null,
                proposalUpdatedAt: null
              }
            ]
          })
        ]
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Generate image")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Thought" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thinking ..." })).toBeNull();
  });

  it("shows a provisional generate image row immediately after message_start for image requests", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "Generate an image of a yellow star" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Generate an image of a yellow star")).toBeInTheDocument();
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_streaming_image_local" }
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Generate image")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Thinking ..." })).toBeNull();
  });

  it("hydrates queued messages from a WebSocket snapshot", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "snapshot",
      conversationId: "conv_1",
      messages: [],
      queuedMessages: [createQueuedMessage()]
    });

    await waitFor(() => {
      expect(screen.getByText("Queued follow-up")).toBeInTheDocument();
    });
  });

  it("hydrates queued messages from queue updates", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "queue_updated",
      conversationId: "conv_1",
      queuedMessages: [
        createQueuedMessage({
          id: "queue_2",
          content: "Second queued follow-up"
        })
      ]
    });

    await waitFor(() => {
      expect(screen.getByText("Second queued follow-up")).toBeInTheDocument();
    });
  });

  it("forks from an assistant message and redirects to the new conversation", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conversation: { id: "conv_forked" } })
      } as Response);

    renderWithProvider(
      React.createElement(ChatView, {
        payload: {
          ...createPayload(),
          messages: [
            createMessage({
              id: "msg_assistant",
              content: "Fork me"
            })
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Fork conversation from message" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/messages/msg_assistant/fork", {
        method: "POST"
      });
    });

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/chat/conv_forked");
    });
  });

  it("restarts the conversation from an edited user message and trims later turns", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversation: {
            ...createPayload().conversation,
            id: "conv_1"
          },
          messages: [
            createMessage({
              id: "msg_user",
              role: "user",
              content: "Edited prompt"
            })
          ]
        })
      } as Response);

    renderWithProvider(
      React.createElement(ChatView, {
        payload: {
          ...createPayload(),
          messages: [
            createMessage({
              id: "msg_user",
              role: "user",
              content: "Original prompt"
            }),
            createMessage({
              id: "msg_assistant_old",
              content: "Old answer"
            })
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.change(screen.getByDisplayValue("Original prompt"), {
      target: { value: "Edited prompt" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/messages/msg_user/edit-restart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content: "Edited prompt" })
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Edited prompt")).toBeInTheDocument();
    });
    expect(screen.queryByText("Old answer")).toBeNull();
  });

  it("keeps the existing transcript visible when edit restart fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Restart denied" })
      } as Response);

    renderWithProvider(
      React.createElement(ChatView, {
        payload: {
          ...createPayload(),
          messages: [
            createMessage({
              id: "msg_user",
              role: "user",
              content: "Original prompt"
            }),
            createMessage({
              id: "msg_assistant_old",
              content: "Old answer"
            })
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.change(screen.getByDisplayValue("Original prompt"), {
      target: { value: "Edited prompt" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    await waitFor(() => {
      expect(screen.getByText("Restart denied")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Edited prompt")).toBeInTheDocument();
    expect(screen.getByText("Old answer")).toBeInTheDocument();
  });

  it("shows a local fork error and does not navigate when the fork request fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Fork denied" })
      } as Response);

    renderWithProvider(
      React.createElement(ChatView, {
        payload: {
          ...createPayload(),
          messages: [
            createMessage({
              id: "msg_assistant",
              content: "Fork me"
            })
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Fork conversation from message" }));

    await waitFor(() => {
      expect(screen.getByText("Fork denied")).toBeInTheDocument();
    });

    expect(push).not.toHaveBeenCalled();
  });

  it("prevents duplicate fork requests while a fork is already in flight", async () => {
    let resolveForkResponse: ((value: Response) => void) | undefined;
    const forkResponse = new Promise<Response>((resolve) => {
      resolveForkResponse = resolve;
    });

    vi.mocked(global.fetch).mockImplementation((input) => {
      if (input === "/api/personas") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ personas: [] })
        } as Response);
      }

      if (input === "/api/messages/msg_assistant/fork") {
        return forkResponse;
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({})
      } as Response);
    });

    renderWithProvider(
      React.createElement(ChatView, {
        payload: {
          ...createPayload(),
          messages: [
            createMessage({
              id: "msg_assistant",
              content: "Fork me"
            })
          ]
        }
      })
    );

    const forkButton = screen.getByRole("button", { name: "Fork conversation from message" });

    fireEvent.click(forkButton);
    fireEvent.click(forkButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/messages/msg_assistant/fork", {
        method: "POST"
      });
    });

    expect(
      vi
        .mocked(global.fetch)
        .mock.calls.filter(([input]) => input === "/api/messages/msg_assistant/fork")
    ).toHaveLength(1);

    expect(resolveForkResponse).toBeDefined();
    resolveForkResponse?.({
      ok: true,
      json: async () => ({ conversation: { id: "conv_forked" } })
    } as Response);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/chat/conv_forked");
    });
  });

  it("ignores stale empty snapshots after a local send has started", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("hello")).toBeInTheDocument();
    });

    wsMock.onMessage!({
      type: "snapshot",
      conversationId: "conv_1",
      messages: []
    });

    await waitFor(() => {
      expect(screen.getByText("hello")).toBeInTheDocument();
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant" }
      });
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "answer_delta", text: "Hello!" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "done", messageId: "msg_assistant" }
    });

    await waitFor(() => {
      expect(screen.getByText("Hello!")).toBeInTheDocument();
    });
  });

  it("keeps an optimistic user message visible when an unrelated server user message arrives first", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "keep this attachment" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("keep this attachment")).toBeInTheDocument();
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          createMessage({
            id: "msg_other_user",
            role: "user",
            content: "server-side note"
          })
        ]
      });
    });

    await waitFor(() => {
      expect(screen.getByText("keep this attachment")).toBeInTheDocument();
      expect(screen.getByText("server-side note")).toBeInTheDocument();
    });
  });

  it("reconciles a multi-attachment optimistic message after partial then complete server snapshots", async () => {
    const imageAttachment = createAttachment({
      id: "att_image",
      filename: "photo.png",
      mimeType: "image/png",
      kind: "image"
    });
    const textAttachment = createAttachment({
      id: "att_text",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "hello"
    });

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ attachments: [imageAttachment, textAttachment] })
      } as Response);

    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(input, {
      target: {
        files: [
          new File(["binary"], "photo.png", { type: "image/png" }),
          new File(["hello"], "notes.txt", { type: "text/plain" })
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove photo.png" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove notes.txt" })).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "message",
        conversationId: "conv_1",
        content: "hello",
        attachmentIds: ["att_image", "att_text"]
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          createMessage({
            id: "msg_user_server",
            role: "user",
            content: "hello",
            attachments: [imageAttachment]
          })
        ]
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          createMessage({
            id: "msg_user_server",
            role: "user",
            content: "hello",
            attachments: [imageAttachment, textAttachment]
          })
        ]
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText("hello")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Preview photo.png" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Preview notes.txt" })).toHaveLength(1);
    });
  });

  it("reconciles a multi-attachment optimistic message after an empty then complete server snapshot", async () => {
    const imageAttachment = createAttachment({
      id: "att_image",
      filename: "photo.png",
      mimeType: "image/png",
      kind: "image"
    });
    const textAttachment = createAttachment({
      id: "att_text",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "hello"
    });

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ attachments: [imageAttachment, textAttachment] })
      } as Response);

    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(input, {
      target: {
        files: [
          new File(["binary"], "photo.png", { type: "image/png" }),
          new File(["hello"], "notes.txt", { type: "text/plain" })
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("photo.png")).toBeInTheDocument();
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "message",
        conversationId: "conv_1",
        content: "hello",
        attachmentIds: ["att_image", "att_text"]
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          createMessage({
            id: "msg_user_server",
            role: "user",
            content: "hello",
            attachments: []
          })
        ]
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          createMessage({
            id: "msg_user_server",
            role: "user",
            content: "hello",
            attachments: [imageAttachment, textAttachment]
          })
        ]
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText("hello")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Preview photo.png" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Preview notes.txt" })).toHaveLength(1);
    });
  });

  it("keeps polling after assistant done until a pending optimistic user message reconciles", async () => {
    const imageAttachment = createAttachment({
      id: "att_image",
      filename: "photo.png",
      mimeType: "image/png",
      kind: "image"
    });
    const textAttachment = createAttachment({
      id: "att_text",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "hello"
    });
    const baseConversation = createPayload().conversation;
    let conversationFetchCount = 0;

    vi.mocked(global.fetch).mockImplementation((input) => {
      if (input === "/api/personas") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ personas: [] })
        } as Response);
      }

      if (input === "/api/attachments") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ attachments: [imageAttachment, textAttachment] })
        } as Response);
      }

      if (input === "/api/conversations/conv_1") {
        conversationFetchCount += 1;

        if (conversationFetchCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              conversation: {
                ...baseConversation,
                isActive: true
              },
              messages: [
                createMessage({
                  id: "msg_user_server",
                  role: "user",
                  content: "hello",
                  attachments: []
                }),
                createMessage({
                  id: "msg_assistant",
                  role: "assistant",
                  content: "",
                  status: "streaming"
                })
              ]
            })
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({
            conversation: {
              ...baseConversation,
              isActive: false
            },
            messages: [
              createMessage({
                id: "msg_user_server",
                role: "user",
                content: "hello",
                attachments: [imageAttachment, textAttachment]
              }),
              createMessage({
                id: "msg_assistant",
                role: "assistant",
                content: "Attachment received",
                status: "completed"
              })
            ]
          })
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });

    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(input, {
      target: {
        files: [
          new File(["binary"], "photo.png", { type: "image/png" }),
          new File(["hello"], "notes.txt", { type: "text/plain" })
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("photo.png")).toBeInTheDocument();
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(conversationFetchCount).toBe(1);
    });

    await waitFor(() => {
      expect(screen.getAllByText("hello")).toHaveLength(1);
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "answer_delta", text: "Attachment received" }
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "done", messageId: "msg_assistant" }
      });
    });

    await waitFor(
      () => {
        expect(conversationFetchCount).toBe(1);
        expect(screen.getAllByText("hello")).toHaveLength(1);
        expect(screen.queryByRole("button", { name: "Preview photo.png" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Preview notes.txt" })).toBeNull();
      },
      { timeout: 2500 }
    );

    await waitFor(
      () => {
        expect(conversationFetchCount).toBe(2);
        expect(screen.getAllByText("hello")).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: "Preview photo.png" })).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: "Preview notes.txt" })).toHaveLength(1);
      },
      { timeout: 2500 }
    );
  });

  it("does not replay a retired optimistic attachment message in strict mode", async () => {
    const imageAttachment = createAttachment({
      id: "att_image",
      filename: "photo.png",
      mimeType: "image/png",
      kind: "image"
    });
    const textAttachment = createAttachment({
      id: "att_text",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "hello"
    });
    const baseConversation = createPayload().conversation;
    let conversationFetchCount = 0;

    vi.mocked(global.fetch).mockImplementation((input) => {
      if (input === "/api/personas") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ personas: [] })
        } as Response);
      }

      if (input === "/api/attachments") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ attachments: [imageAttachment, textAttachment] })
        } as Response);
      }

      if (input === "/api/conversations/conv_1") {
        conversationFetchCount += 1;

        return Promise.resolve({
          ok: true,
          json: async () => ({
            conversation: {
              ...baseConversation,
              isActive: true
            },
            messages: [
              createMessage({
                id: "msg_user_server",
                role: "user",
                content: "hello",
                attachments: [imageAttachment, textAttachment]
              }),
              createMessage({
                id: "msg_assistant",
                role: "assistant",
                content: "",
                status: "streaming"
              })
            ]
          })
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });

    const { container } = renderWithProviderStrict(
      React.createElement(ChatView, { payload: createPayload() })
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(input, {
      target: {
        files: [
          new File(["binary"], "photo.png", { type: "image/png" }),
          new File(["hello"], "notes.txt", { type: "text/plain" })
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("photo.png")).toBeInTheDocument();
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(conversationFetchCount).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getAllByText("hello")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Preview photo.png" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Preview notes.txt" })).toHaveLength(1);
    });
  });

  it("keeps a later identical submission optimistic until its own server message arrives", async () => {
    const imageAttachment = createAttachment({
      id: "att_image",
      filename: "photo.png",
      mimeType: "image/png",
      kind: "image"
    });
    const textAttachment = createAttachment({
      id: "att_text",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "hello"
    });

    vi.mocked(global.fetch).mockImplementation((input) => {
      if (input === "/api/personas") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ personas: [] })
        } as Response);
      }

      if (typeof input === "string" && input === "/api/attachments") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ attachments: [imageAttachment, textAttachment] })
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });

    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(input, {
      target: {
        files: [
          new File(["binary"], "photo.png", { type: "image/png" }),
          new File(["hello"], "notes.txt", { type: "text/plain" })
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove photo.png" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove notes.txt" })).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "message",
        conversationId: "conv_1",
        content: "hello",
        attachmentIds: ["att_image", "att_text"]
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant_first" }
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "done", messageId: "msg_assistant_first" }
      });
    });

    fireEvent.change(input, {
      target: {
        files: [
          new File(["binary"], "photo.png", { type: "image/png" }),
          new File(["hello"], "notes.txt", { type: "text/plain" })
        ]
      }
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove photo.png" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove notes.txt" })).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenNthCalledWith(2, {
        type: "message",
        conversationId: "conv_1",
        content: "hello",
        attachmentIds: ["att_image", "att_text"]
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          createMessage({
            id: "msg_user_server_first",
            role: "user",
            content: "hello",
            attachments: [imageAttachment]
          })
        ]
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          createMessage({
            id: "msg_user_server_first",
            role: "user",
            content: "hello",
            attachments: [imageAttachment, textAttachment]
          })
        ]
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText("hello")).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Preview photo.png" })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Preview notes.txt" })).toHaveLength(2);
    });
  });

  it("keeps the attachment preview open when a local message is replaced by the persisted server message", async () => {
    const attachment = createAttachment({
      id: "att_text",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "preview content"
    });

    vi.mocked(global.fetch).mockImplementation((input) => {
      if (input === "/api/personas") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ personas: [] })
        } as Response);
      }

      if (input === "/api/attachments") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ attachments: [attachment] })
        } as Response);
      }

      if (input === "/api/attachments/att_text?format=text") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "att_text",
            filename: "notes.txt",
            mimeType: "text/plain",
            content: "preview content"
          })
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });

    const { container } = renderWithProvider(
      React.createElement(ChatView, { payload: createPayload() })
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(input, {
      target: {
        files: [new File(["preview content"], "notes.txt", { type: "text/plain" })]
      }
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove notes.txt" })).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: "Keep these notes" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "message",
        conversationId: "conv_1",
        content: "Keep these notes",
        attachmentIds: ["att_text"]
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeInTheDocument();
      expect(screen.getByText("preview content")).toBeInTheDocument();
    });

    const persistedPayload = createPayload({
      messages: [
        createMessage({
          id: "msg_user",
          role: "user",
          content: "Keep these notes",
          attachments: [attachment]
        })
      ]
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: persistedPayload.messages
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeInTheDocument();
      expect(screen.getByText("preview content")).toBeInTheDocument();
    });
  });

  it("closes the attachment preview when the active conversation changes", async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      if (input === "/api/personas") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ personas: [] })
        } as Response);
      }

      if (input === "/api/attachments/att_text?format=text") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "att_text",
            filename: "notes.txt",
            mimeType: "text/plain",
            content: "preview content"
          })
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });

    const attachment = createAttachment({
      id: "att_text",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "preview content"
    });

    const firstPayload = createPayload({
      messages: [
        createMessage({
          id: "msg_user",
          role: "user",
          content: "Keep these notes",
          attachments: [attachment]
        })
      ]
    });

    const view = renderWithProvider(React.createElement(ChatView, { payload: firstPayload }));

    fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeInTheDocument();
      expect(screen.getByText("preview content")).toBeInTheDocument();
    });

    const secondPayload = createPayload({
      conversation: {
        ...firstPayload.conversation,
        id: "conv_2",
        title: "Another conversation"
      },
      messages: []
    });

    view.rerender(
      React.createElement(
        ContextTokensProvider,
        null,
        React.createElement(ChatView, { payload: secondPayload })
      )
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Attachment preview" })).toBeNull();
    });
  });

  it("does not append duplicate assistant placeholders for the same stream message", async () => {
    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant" }
      });
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".animate-slide-up")).toHaveLength(1);
    });
  });

  it("receives streamed answer via WebSocket deltas and renders it", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "answer_delta", text: "Done" }
    });

    await waitFor(() => {
      expect(screen.getByText("Done")).toBeInTheDocument();
    });
  });

  it("jumps back to the latest messages when a scrolled-up user queues another prompt", async () => {
    const { container } = renderWithProvider(
      React.createElement(ChatView, {
        payload: createPayload({
          conversation: {
            ...createPayload().conversation,
            isActive: true
          }
        })
      })
    );
    const queue = container.querySelector(".no-scrollbar.overflow-y-auto") as HTMLDivElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    let scrollTop = 700;
    const scrollTo = vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") {
        scrollTop = top;
      }
    });

    Object.defineProperty(queue, "clientHeight", {
      configurable: true,
      get: () => 300
    });
    Object.defineProperty(queue, "scrollHeight", {
      configurable: true,
      get: () => 1000
    });
    Object.defineProperty(queue, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      }
    });
    Object.defineProperty(queue, "scrollTo", {
      configurable: true,
      value: scrollTo
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant" }
      });
    });

    await flushAnimationFrame();

    scrollTop = 120;
    fireEvent.scroll(queue);
    scrollTo.mockClear();

    fireEvent.change(textarea, { target: { value: "Queued follow-up" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "queue_message",
        conversationId: "conv_1",
        content: "Queued follow-up"
      });
    });

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1000 }));
    expect(scrollTop).toBe(1000);
  });

  it("does not force-scroll streaming updates when the user has scrolled away from the bottom", async () => {
    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const queue = container.querySelector(".no-scrollbar.overflow-y-auto") as HTMLDivElement;

    let scrollTop = 700;
    const scrollTo = vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") {
        scrollTop = top;
      }
    });

    Object.defineProperty(queue, "clientHeight", {
      configurable: true,
      get: () => 300
    });
    Object.defineProperty(queue, "scrollHeight", {
      configurable: true,
      get: () => 1000
    });
    Object.defineProperty(queue, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      }
    });
    Object.defineProperty(queue, "scrollTo", {
      configurable: true,
      value: scrollTo
    });

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });

    await flushAnimationFrame();

    scrollTop = 120;
    fireEvent.scroll(queue);
    scrollTo.mockClear();

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "answer_delta", text: "Still working" }
      });
    });

    await flushAnimationFrame();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollTop).toBe(120);
  });

  it("hides the scroll-to-newest pill when the user sends from a scrolled-up conversation", async () => {
    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const queue = container.querySelector(".no-scrollbar.overflow-y-auto") as HTMLDivElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    let scrollTop = 700;
    const scrollTo = vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") {
        scrollTop = top;
      }
    });

    Object.defineProperty(queue, "clientHeight", {
      configurable: true,
      get: () => 300
    });
    Object.defineProperty(queue, "scrollHeight", {
      configurable: true,
      get: () => 1000
    });
    Object.defineProperty(queue, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      }
    });
    Object.defineProperty(queue, "scrollTo", {
      configurable: true,
      value: scrollTo
    });

    await flushAnimationFrame();

    scrollTop = 120;
    fireEvent.scroll(queue);
    scrollTo.mockClear();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Scroll to newest messages" })).toBeInTheDocument();
    });

    fireEvent.change(textarea, { target: { value: "Follow the latest reply" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await flushAnimationFrame();

    expect(wsMock.send).toHaveBeenCalledWith({
      type: "message",
      conversationId: "conv_1",
      content: "Follow the latest reply",
      attachmentIds: [],
      personaId: undefined
    });
    await flushAnimationFrame();
    await flushAnimationFrame();
    expect(screen.queryByRole("button", { name: "Scroll to newest messages" })).toBeNull();
  });

  it("scrolls to anchor the user message near the top after sending", async () => {
    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const queue = container.querySelector(".no-scrollbar.overflow-y-auto") as HTMLDivElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    let scrollTop = 500;
    const scrollTo = vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") {
        scrollTop = top;
      }
    });

    Object.defineProperty(queue, "clientHeight", { configurable: true, get: () => 300 });
    Object.defineProperty(queue, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(queue, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; }
    });
    Object.defineProperty(queue, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.change(textarea, { target: { value: "Hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    await flushAnimationFrame();
    await flushAnimationFrame();

    expect(scrollTo).toHaveBeenCalled();
    const allTops = scrollTo.mock.calls.map((call) => call[0].top);
    expect(allTops).not.toContain(1000);
  });

  it("scrolls to bottom when queuing a follow-up during an active turn", async () => {
    const { container } = renderWithProvider(
      React.createElement(ChatView, {
        payload: createPayload({
          conversation: {
            ...createPayload().conversation,
            isActive: true
          }
        })
      })
    );
    const queue = container.querySelector(".no-scrollbar.overflow-y-auto") as HTMLDivElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    let scrollTop = 120;
    const scrollTo = vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") {
        scrollTop = top;
      }
    });

    Object.defineProperty(queue, "clientHeight", { configurable: true, get: () => 300 });
    Object.defineProperty(queue, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(queue, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; }
    });
    Object.defineProperty(queue, "scrollTo", { configurable: true, value: scrollTo });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant" }
      });
    });

    await flushAnimationFrame();

    scrollTo.mockClear();

    fireEvent.change(textarea, { target: { value: "Queued follow-up" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(wsMock.send).toHaveBeenCalledWith({
        type: "queue_message",
        conversationId: "conv_1",
        content: "Queued follow-up"
      });
    });

    await flushAnimationFrame();

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1000 }));
  });

  it("returns to idle when the user manually scrolls during anchored mode", async () => {
    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const queue = container.querySelector(".no-scrollbar.overflow-y-auto") as HTMLDivElement;
    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    let scrollHeight = 200;
    let scrollTop = 0;
    const scrollTo = vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") {
        scrollTop = top;
      }
    });

    Object.defineProperty(queue, "clientHeight", { configurable: true, get: () => 300 });
    Object.defineProperty(queue, "scrollHeight", { configurable: true, get: () => scrollHeight });
    Object.defineProperty(queue, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; }
    });
    Object.defineProperty(queue, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
    });

    await flushAnimationFrame();
    await flushAnimationFrame();

    scrollTo.mockClear();

    scrollTop = 10;
    fireEvent.scroll(queue);

    scrollHeight = 700;
    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant" }
      });
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "answer_delta", text: "Streaming content" }
      });
    });

    await flushAnimationFrame();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("transitions to following mode when streaming content fills the viewport", async () => {
    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    const queue = container.querySelector(".no-scrollbar.overflow-y-auto") as HTMLDivElement;

    let scrollHeight = 700;
    let scrollTop = 0;
    const scrollTo = vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") {
        scrollTop = top;
      }
    });

    Object.defineProperty(queue, "clientHeight", { configurable: true, get: () => 300 });
    Object.defineProperty(queue, "scrollHeight", { configurable: true, get: () => scrollHeight });
    Object.defineProperty(queue, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; }
    });
    Object.defineProperty(queue, "scrollTo", { configurable: true, value: scrollTo });

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "Hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
    });

    await flushAnimationFrame();
    await flushAnimationFrame();

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant" }
      });
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "answer_delta", text: "A very long response that fills the viewport" }
      });
    });

    await flushAnimationFrame();
    await flushAnimationFrame();

    expect(screen.queryByRole("button", { name: "Scroll to newest messages" })).toBeNull();
  });

  it("anchors to the edited message after edit-retry", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversation: {
            ...createPayload().conversation,
            id: "conv_1"
          },
          messages: [
            createMessage({
              id: "msg_user",
              role: "user",
              content: "Edited prompt"
            })
          ]
        })
      } as Response);

    const { container } = renderWithProvider(
      React.createElement(ChatView, {
        payload: {
          ...createPayload(),
          messages: [
            createMessage({
              id: "msg_user",
              role: "user",
              content: "Original prompt"
            }),
            createMessage({
              id: "msg_assistant_old",
              content: "Old answer"
            })
          ]
        }
      })
    );
    const queue = container.querySelector(".no-scrollbar.overflow-y-auto") as HTMLDivElement;

    const scrollTo = vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") {
        // noop
      }
    });
    Object.defineProperty(queue, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.change(screen.getByDisplayValue("Original prompt"), {
      target: { value: "Edited prompt" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/messages/msg_user/edit-restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Edited prompt" })
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Edited prompt")).toBeInTheDocument();
    });

    await flushAnimationFrame();
    await flushAnimationFrame();

    expect(scrollTo).toHaveBeenCalled();
  });

  it("renders tool actions and answer text while streaming", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "thinking_delta", text: "Thinking" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: {
        type: "action_start",
        action: {
          id: "act_live",
          messageId: "msg_assistant",
          kind: "mcp_tool_call",
          status: "running",
          serverId: "exa",
          skillId: null,
          toolName: "web_search_exa",
          label: "web_search_exa",
          detail: "query=booking",
          arguments: { query: "booking" },
          resultSummary: "",
          sortOrder: 0,
          startedAt: new Date().toISOString(),
          completedAt: null,
          proposalState: null,
          proposalPayload: null,
          proposalUpdatedAt: null
        }
      }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "answer_delta", text: "Working on it" }
    });

    await waitFor(() => {
      expect(screen.getByTestId("assistant-actions-shell")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Thought/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /^Thinking$/i })).toBeNull();

    await waitFor(() => {
      expect(screen.getByText("Working on it")).toBeInTheDocument();
    });
  });

  it("ignores stale inactive sync results once streamed thinking has started", async () => {
    let resolveFetch:
      | ((value: Response) => void)
      | null = null;

    vi.mocked(global.fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    await act(async () => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant" }
      });
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "thinking_delta", text: "Thinking through the tool result" }
      });
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: {
          type: "action_complete",
          action: {
            id: "act_live",
            messageId: "msg_assistant",
            kind: "mcp_tool_call",
            status: "completed",
            serverId: "exa",
            skillId: null,
            toolName: "web_search_exa",
            label: "web_search_exa",
            detail: "query=booking",
            arguments: { query: "booking" },
            resultSummary: "Found booking details",
            sortOrder: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            proposalState: null,
            proposalPayload: null,
            proposalUpdatedAt: null
          }
        }
      });

      resolveFetch?.({
        ok: true,
        json: async () => ({
          conversation: {
            ...createPayload().conversation,
            isActive: false
          },
          messages: [
            {
              id: "msg_assistant",
              conversationId: "conv_1",
              role: "assistant",
              content: "",
              thinkingContent: "",
              status: "streaming",
              estimatedTokens: 0,
              systemKind: null,
              compactedAt: null,
              createdAt: new Date().toISOString(),
              timeline: [
                {
                  id: "act_live",
                  messageId: "msg_assistant",
                  timelineKind: "action",
                  kind: "mcp_tool_call",
                  status: "completed",
                  serverId: "exa",
                  skillId: null,
                  toolName: "web_search_exa",
                  label: "web_search_exa",
                  detail: "query=booking",
                  arguments: { query: "booking" },
                  resultSummary: "Found booking details",
                  sortOrder: 0,
                  startedAt: new Date().toISOString(),
                  completedAt: new Date().toISOString(),
                  proposalState: null,
                  proposalPayload: null,
                  proposalUpdatedAt: null
                }
              ]
            }
          ],
          debug: createPayload().debug
        })
      } as Response);
    });

    await waitFor(() => {
      expect(screen.getByTestId("assistant-thinking-shell")).toBeInTheDocument();
    });
  });

  it("keeps the streaming assistant row mounted during streaming", async () => {
    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "answer_delta", text: "Done" }
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".animate-slide-up")).toHaveLength(1);
    });

    const assistantWrapper = container.querySelector(".animate-slide-up");

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "done", messageId: "msg_assistant" }
    });

    await waitFor(() => {
      expect(screen.getByText("Done")).toBeInTheDocument();
    });

    const wrappersAfterDone = container.querySelectorAll(".animate-slide-up");
    expect(wrappersAfterDone).toHaveLength(1);
    expect(wrappersAfterDone[0]).toBe(assistantWrapper);
  });

  it("keeps the final answer when answer and done arrive back to back", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "answer_delta", text: "Connected" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "done", messageId: "msg_assistant" }
    });

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
  });

  it("keeps a late-joined streaming answer in a single bubble until a new boundary appears", async () => {
    const { container } = renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          {
            id: "msg_assistant",
            conversationId: "conv_1",
            role: "assistant",
            content: "",
            thinkingContent: "",
            status: "streaming",
            estimatedTokens: 0,
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString(),
            timeline: [
              {
                id: "txt_1",
                timelineKind: "text",
                sortOrder: 0,
                createdAt: new Date().toISOString(),
                content: "Already"
              },
              {
                id: "txt_2",
                timelineKind: "text",
                sortOrder: 1,
                createdAt: new Date().toISOString(),
                content: " streamed"
              }
            ]
          }
        ]
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Already streamed")).toBeInTheDocument();
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "answer_delta", text: " and still typing" }
      });
    });

    await waitFor(() => {
      const bubbles = container.querySelectorAll('[data-testid="assistant-message-bubble"]');
      expect(bubbles).toHaveLength(1);
      expect(bubbles[0]?.textContent).toContain("Already streamed and still typing");
    });
  });

  it("renders answer text without duplication around tool actions during streaming", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "answer_delta", text: "Checking the official site.\n\n" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: {
        type: "action_start",
        action: {
          id: "act_live",
          messageId: "msg_assistant",
          kind: "mcp_tool_call",
          status: "running",
          serverId: "exa",
          skillId: null,
          toolName: "web_search_exa",
          label: "web_search_exa",
          detail: "query=booking",
          arguments: { query: "booking" },
          resultSummary: "",
          sortOrder: 1,
          startedAt: new Date().toISOString(),
          completedAt: null
        }
      }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "answer_delta", text: "The first available slot is Saturday at 9:00 AM." }
    });

    await waitFor(() => {
      expect(screen.getByTestId("assistant-actions-shell")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("web_search_exa")).toBeInTheDocument();
    });
  });

  it("keeps a pending memory proposal visible when action_start and done arrive back to back", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    const actionStartedAt = new Date().toISOString();

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant" }
      });
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "answer_delta", text: "Nice, DevOps is a solid background." }
      });
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: {
          type: "action_start",
          action: {
            id: "act_memory_live",
            messageId: "msg_assistant",
            kind: "create_memory",
            status: "pending",
            serverId: null,
            skillId: null,
            toolName: "create_memory",
            label: "Create memory proposal",
            detail: "User works as a DevOps Engineer",
            arguments: {
              content: "User works as a DevOps Engineer",
              category: "work"
            },
            resultSummary: "",
            sortOrder: 0,
            startedAt: actionStartedAt,
            completedAt: null,
            proposalState: "pending",
            proposalPayload: {
              operation: "create",
              targetMemoryId: null,
              proposedMemory: {
                content: "User works as a DevOps Engineer",
                category: "work"
              }
            },
            proposalUpdatedAt: actionStartedAt
          }
        }
      });
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "done", messageId: "msg_assistant" }
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Save")).toBeInTheDocument();
      expect(screen.getByText("Ignore")).toBeInTheDocument();
      expect(screen.getByText("Edit")).toBeInTheDocument();
    });
  });

  it("dedupes repeated action_start events for the same action id", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "thinking_delta", text: "Thinking" }
    });

    const action = {
      id: "act_live",
      messageId: "msg_assistant",
      kind: "mcp_tool_call" as const,
      status: "running" as const,
      serverId: "exa",
      skillId: null,
      toolName: "web_search_exa",
      label: "web_search_exa",
      detail: "query=booking",
      arguments: { query: "booking" },
      resultSummary: "",
      sortOrder: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      proposalState: null,
      proposalPayload: null,
      proposalUpdatedAt: null
    };

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: {
        type: "action_start",
        action
      }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: {
        type: "action_start",
        action
      }
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("assistant-actions-shell")).toHaveLength(1);
    });
  });

  it("collapses retried tool actions with the same tool and detail into one live row", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "thinking_delta", text: "Thinking" }
    });

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: {
        type: "action_start",
        action: {
          id: "act_error",
          messageId: "msg_assistant",
          kind: "mcp_tool_call",
          status: "error",
          serverId: "exa",
          skillId: null,
          toolName: "web_search_exa",
          label: "web_search_exa",
          detail: "query=weather",
          arguments: { query: "weather" },
          resultSummary: "validation failed",
          sortOrder: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          proposalState: null,
          proposalPayload: null,
          proposalUpdatedAt: null
        }
      }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: {
        type: "action_start",
        action: {
          id: "act_retry",
          messageId: "msg_assistant",
          kind: "mcp_tool_call",
          status: "running",
          serverId: "exa",
          skillId: null,
          toolName: "web_search_exa",
          label: "web_search_exa",
          detail: "query=weather",
          arguments: { query: "weather" },
          resultSummary: "",
          sortOrder: 1,
          startedAt: new Date().toISOString(),
          completedAt: null,
          proposalState: null,
          proposalPayload: null,
          proposalUpdatedAt: null
        }
      }
    });

    await waitFor(() => {
      expect(screen.getAllByText("web_search_exa")).toHaveLength(1);
    });
  });

  it("shows the transient compaction indicator and clears it when compaction ends", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "compaction_start" }
    });

    await waitFor(() => {
      expect(screen.getByText("Compacting")).toBeInTheDocument();
    });

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "compaction_end" }
    });

    await waitFor(() => {
      expect(screen.queryByText("Compacting")).toBeNull();
    });
  });

  it("clears the transient compaction indicator on the first downstream assistant activity", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "compaction_start" }
    });

    await waitFor(() => {
      expect(screen.getByText("Compacting")).toBeInTheDocument();
    });

    wsMock.onMessage!({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "thinking_delta", text: "Thinking through the answer" }
    });

    await waitFor(() => {
      expect(screen.queryByText("Compacting")).toBeNull();
    });
  });

  it("filters legacy persisted compaction notices from initial payload rendering", () => {
    const payload = createPayload();
    payload.messages = [
      {
        id: "msg_notice",
        conversationId: "conv_1",
        role: "system",
        content: "Older context compacted to stay within model limits.",
        thinkingContent: "",
        status: "completed",
        estimatedTokens: 0,
        systemKind: "compaction_notice",
        compactedAt: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "msg_user",
        conversationId: "conv_1",
        role: "user",
        content: "Hello",
        thinkingContent: "",
        status: "completed",
        estimatedTokens: 0,
        systemKind: null,
        compactedAt: null,
        createdAt: new Date().toISOString()
      }
    ];

    renderWithProvider(React.createElement(ChatView, { payload }));

    expect(screen.queryByText("Older context compacted to stay within model limits.")).toBeNull();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("sends a websocket stop message when the active-turn button is clicked", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    await act(async () => {
      wsMock.onMessage?.({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant_1" }
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop response" }));

    expect(wsMock.send).toHaveBeenCalledWith({
      type: "stop",
      conversationId: "conv_1"
    });
  });

  it("keeps the active stream running when a queued-message websocket error arrives", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    await act(async () => {
      wsMock.onMessage?.({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant_queued_error" }
      });
      wsMock.onMessage?.({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "answer_delta", text: "Still streaming" }
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop response" })).toBeInTheDocument();
    });

    await act(async () => {
      wsMock.onMessage?.({
        type: "error",
        message: "Queued message not found"
      });
    });

    expect(screen.getByText("Queued message not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop response" })).toBeInTheDocument();
    expect(screen.getByText("Agent working - send still queues")).toBeInTheDocument();
  });

  it("reuses the primary action as queue follow-up while drafting during an active turn", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    await act(async () => {
      wsMock.onMessage?.({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant_draft_stop" }
      });
    });

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    fireEvent.change(textarea, { target: { value: "Queued while streaming" } });

    expect(screen.getByRole("button", { name: "Queue follow-up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop response" })).toBeNull();
    expect(screen.getByText("Agent working - send still queues")).toBeInTheDocument();
  });

  it("centers the composer controls against the textarea body", async () => {
    await act(async () => {
      renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));
    });

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );
    const composerRow = textarea.parentElement?.parentElement;

    expect(composerRow).toHaveClass("items-center");
    expect(composerRow).not.toHaveClass("items-end");
  });

  it("updates token usage gauge when usage event arrives", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    await waitFor(() => {
      expect(screen.getByText("Test conversation")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_1",
        messages: [
          {
            id: "msg_user",
            conversationId: "conv_1",
            role: "user",
            content: "Hello",
            thinkingContent: "",
            status: "completed",
            estimatedTokens: 5,
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString()
          }
        ]
      });
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant" }
      });
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "usage", inputTokens: 50000 }
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("keeps the context label hidden until usage data arrives", async () => {
    const payload = createPayload();
    payload.conversation.id = "conv_no_usage";
    renderWithProvider(React.createElement(ChatView, { payload }));

    await waitFor(() => {
      expect(screen.getByText("Test conversation")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Hello")).toBeInTheDocument();
    });

    act(() => {
      wsMock.onMessage!({
        type: "snapshot",
        conversationId: "conv_no_usage",
        messages: [
          {
            id: "msg_user",
            conversationId: "conv_no_usage",
            role: "user",
            content: "Hello",
            thinkingContent: "",
            status: "completed",
            estimatedTokens: 5,
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString()
          }
        ]
      });
    });

    expect(screen.queryByText("Context")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("replaces the assistant message with the finalized message from a done event", async () => {
    renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: { type: "message_start", messageId: "msg_assistant_image" }
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Generated")).toBeNull();
    });

    act(() => {
      wsMock.onMessage!({
        type: "delta",
        conversationId: "conv_1",
        event: {
          type: "done",
          messageId: "msg_assistant_image",
          message: {
            id: "msg_assistant_image",
            conversationId: "conv_1",
            role: "assistant",
            content: "Here is a first pass.",
            thinkingContent: "",
            status: "completed",
            estimatedTokens: 0,
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString(),
            attachments: [
              {
                id: "att_generated",
                conversationId: "conv_1",
                messageId: "msg_assistant_image",
                filename: "generated-1.png",
                mimeType: "image/png",
                byteSize: 3,
                sha256: "sha",
                relativePath: "conv_1/generated-1.png",
                kind: "image" as const,
                extractedText: "",
                createdAt: new Date().toISOString()
              }
            ]
          }
        }
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Here is a first pass.")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Preview generated-1.png" })
    ).toBeInTheDocument();

    expect(wsMock.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "message" })
    );
  });
});
