import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ATTACHMENT_IDS_PER_MESSAGE, MAX_CHAT_MESSAGE_CHARS } from "@/lib/constants";
import { createConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";
import { createProviderProfileInput } from "@/tests/provider-fixtures";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/assistant-runtime", () => ({
  resolveAssistantTurn: vi.fn(async (input: { onAnswerSegment?: (segment: string) => Promise<void> | void }) => {
    await input.onAnswerSegment?.("Route acknowledged.");
    return { answer: "Route acknowledged.", thinking: "", usage: {} };
  })
}));

vi.mock("@/lib/mcp-client", () => ({
  gatherAllMcpTools: vi.fn().mockResolvedValue([])
}));

vi.mock("@/lib/compaction", () => ({
  ensureCompactedContext: vi.fn().mockResolvedValue({
    promptMessages: [],
    compactionNoticeEvent: null
  }),
  getConversationContextUsage: vi.fn().mockReturnValue({
    contextTokens: 512,
    compactionLimit: 8192
  })
}));

vi.mock("@/lib/conversation-title-generator", () => ({
  generateConversationTitle: vi.fn(),
  sanitizeGeneratedTitle: vi.fn(),
  buildConversationTitlePrompt: vi.fn(),
  DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE: "Files",
  DEFAULT_CONVERSATION_TITLE: "Conversation",
  MAX_CONVERSATION_TITLE_LENGTH: 48
}));

function setupProviderProfile() {
  const profileId = "profile_body_limit_test";
  const profile = createProviderProfileInput({
    id: profileId,
    name: "Body limit",
    model: "gpt-test",
    systemPrompt: "Be exact.",
    temperature: 0.4,
    maxOutputTokens: 512,
    modelContextLimit: 16384,
    freshTailCount: 12,
    visionMode: "native"
  });
  return { profileId, profile };
}

async function createRouteUser(username: string) {
  const user = await createLocalUser({
    username,
    password: "Password123!",
    role: "user"
  });
  requireUserMock.mockResolvedValue(user);
  return user;
}

async function createRouteUserWithConversation(username: string, title: string) {
  const user = await createRouteUser(username);
  const { updateProviderCatalog } = await import("@/lib/settings");
  const { profileId, profile } = setupProviderProfile();
  updateProviderCatalog({
    defaultProviderProfileId: profileId,
    skillsEnabled: false,
    providerProfiles: [profile]
  });
  const conversation = createConversation(title, null, { providerProfileId: profileId }, user.id);
  return { user, conversation };
}

describe("request body limit routes", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("rejects chat messages over the shared content limit", async () => {
    const { conversation } = await createRouteUserWithConversation(
      "chat-body-limit-message-user",
      "Chat body limit message"
    );

    const { POST } = await import("@/app/api/conversations/[conversationId]/chat/route");
    const response = await POST(
      new Request(`http://localhost/api/conversations/${conversation.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "a".repeat(MAX_CHAT_MESSAGE_CHARS + 1), attachmentIds: [] })
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: `Message exceeds the maximum length of ${MAX_CHAT_MESSAGE_CHARS} characters`
    });
  });

  it("rejects chat messages referencing more than the shared attachment id limit", async () => {
    const { conversation } = await createRouteUserWithConversation(
      "chat-body-limit-attachments-user",
      "Chat body limit attachments"
    );
    const attachmentIds = Array.from(
      { length: MAX_ATTACHMENT_IDS_PER_MESSAGE + 1 },
      (_value, index) => `att-${index}`
    );

    const { POST } = await import("@/app/api/conversations/[conversationId]/chat/route");
    const response = await POST(
      new Request(`http://localhost/api/conversations/${conversation.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello", attachmentIds })
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: `A maximum of ${MAX_ATTACHMENT_IDS_PER_MESSAGE} attachments may be sent per message`
    });
  });

  it("rejects chat request bodies over the transport cap while streaming", async () => {
    const { conversation } = await createRouteUserWithConversation(
      "chat-body-limit-bytes-user",
      "Chat body limit bytes"
    );

    const { POST } = await import("@/app/api/conversations/[conversationId]/chat/route");
    const response = await POST(
      new Request(`http://localhost/api/conversations/${conversation.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello", padding: "a".repeat(2 * 1024 * 1024) })
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body exceeds 1048576 bytes"
    });
  });

  it("accepts a small valid chat request end to end", async () => {
    const { conversation } = await createRouteUserWithConversation(
      "chat-body-limit-valid-user",
      "Chat body limit valid"
    );

    const { POST } = await import("@/app/api/conversations/[conversationId]/chat/route");
    const response = await POST(
      new Request(`http://localhost/api/conversations/${conversation.id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello", attachmentIds: [] })
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(200);
    const streamText = await response.text();
    expect(streamText.startsWith(": ")).toBe(true);

    const { listVisibleMessages } = await import("@/lib/conversations");
    const assistant = listVisibleMessages(conversation.id).find(
      (message) => message.role === "assistant"
    );
    expect(assistant?.status).toBe("completed");
    expect(assistant?.content).toBe("Route acknowledged.");
  });

  it("rejects uploads whose declared content length exceeds the upload cap", async () => {
    await createRouteUser("upload-body-limit-header-user");

    const { POST } = await import("@/app/api/attachments/route");
    const response = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data",
          "content-length": String(100 * 1024 * 1024 + 1)
        },
        body: "declared-large-upload"
      })
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body exceeds 104857600 bytes"
    });
  });

  it("rejects chunked uploads exceeding the upload cap without a content length", async () => {
    await createRouteUser("upload-body-limit-stream-user");
    const chunk = new Uint8Array(16 * 1024 * 1024);
    let enqueued = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (enqueued >= 7) {
          controller.close();
          return;
        }
        enqueued += 1;
        controller.enqueue(chunk);
      }
    });

    const { POST } = await import("@/app/api/attachments/route");
    const response = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        headers: { "content-type": "multipart/form-data" },
        body,
        duplex: "half"
      } as RequestInit)
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body exceeds 104857600 bytes"
    });
  });

  it("returns a client error when the upload body is empty", async () => {
    await createRouteUser("upload-body-limit-empty-user");

    const { POST } = await import("@/app/api/attachments/route");
    const response = await POST(new Request("http://localhost/api/attachments", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid attachment upload"
    });
  });

  it("accepts a small valid upload end to end", async () => {
    const { conversation } = await createRouteUserWithConversation(
      "upload-body-limit-valid-user",
      "Upload body limit valid"
    );
    const formData = new FormData();
    formData.set("conversationId", conversation.id);
    formData.append("files", new File(["hello upload"], "notes.txt", { type: "text/plain" }));

    const { POST } = await import("@/app/api/attachments/route");
    const response = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        body: formData
      })
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0]).toMatchObject({ filename: "notes.txt" });
  });
});
