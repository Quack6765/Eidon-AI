import fs from "node:fs";
import path from "node:path";

import { createAttachments } from "@/lib/attachments";
import {
  claimConversationTitleGeneration,
  completeConversationTitleGeneration,
  createConversation,
  createMessageAction,
  createMessageTextSegment,
  createMessage,
  deleteConversation,
  deleteConversationIfEmpty,
  failConversationTitleGeneration,
  generateConversationTitleFromFirstUserMessage,
  getConversation,
  getMessage,
  isVisibleMessage,
  listMessages,
  listVisibleMessages,
  markMessagesCompacted,
  updateMessage,
  updateConversationProviderProfile,
  getConversationSnapshot,
  updateMessageAction
} from "@/lib/conversations";
import { getSettings, listProviderProfiles, updateSettings } from "@/lib/settings";

const { generateConversationTitle } = vi.hoisted(() => ({
  generateConversationTitle: vi.fn()
}));

vi.mock("@/lib/conversation-title-generator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/conversation-title-generator")>();

  return {
    ...actual,
    generateConversationTitle
  };
});

describe("conversation helpers", () => {
  beforeEach(() => {
    generateConversationTitle.mockReset();
    updateSettings({
      defaultProviderProfileId: "profile_default",
      skillsEnabled: true,
      providerProfiles: [
        {
          id: "profile_default",
          name: "Default",
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "gpt-5-mini",
          apiMode: "responses",
          systemPrompt: "Be exact.",
          temperature: 0.2,
          maxOutputTokens: 512,
          reasoningEffort: "medium",
          reasoningSummaryEnabled: true,
          modelContextLimit: 16000,
          compactionThreshold: 0.8,
          freshTailCount: 12
        }
      ]
    });
  });

  it("creates conversations with a pending placeholder title and generates it from the first user message", async () => {
    const conversation = createConversation();
    const defaultProfileId = getSettings().defaultProviderProfileId;

    expect(conversation.title).toBe("Conversation");
    expect(conversation.titleGenerationStatus).toBe("pending");

    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Build a small deployment checklist for me"
    });

    generateConversationTitle.mockResolvedValue("Deployment Checklist");

    await generateConversationTitleFromFirstUserMessage(conversation.id, message.id);

    expect(getConversation(conversation.id)?.title).toBe("Deployment Checklist");
    expect(getConversation(conversation.id)?.titleGenerationStatus).toBe("completed");
    expect(getConversation(conversation.id)?.providerProfileId).toBe(defaultProfileId);
  });

  it("stores messages in chronological order", () => {
    const conversation = createConversation();

    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "First"
    });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Second"
    });

    const messages = listMessages(conversation.id);

    expect(messages.map((message) => message.content)).toEqual(["First", "Second"]);
  });

  it("hides background system prompts from visible message lists", () => {
    const conversation = createConversation();

    createMessage({
      conversationId: conversation.id,
      role: "system",
      content: "Hidden prompt"
    });
    createMessage({
      conversationId: conversation.id,
      role: "system",
      content: "Compacted older messages into memory.",
      systemKind: "compaction_notice"
    });
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Visible user message"
    });

    expect(listMessages(conversation.id)).toHaveLength(3);
    expect(listVisibleMessages(conversation.id).map((message) => message.content)).toEqual([
      "Visible user message"
    ]);
    expect(
      isVisibleMessage({
        role: "system",
        systemKind: null
      })
    ).toBe(false);
  });

  it("hides compaction notices from visible message lists", () => {
    const conversation = createConversation();

    createMessage({
      conversationId: conversation.id,
      role: "system",
      content: "Compacted older messages into memory.",
      systemKind: "compaction_notice"
    });
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Visible user message"
    });

    expect(listMessages(conversation.id)).toHaveLength(2);
    expect(listVisibleMessages(conversation.id).map((message) => message.content)).toEqual([
      "Visible user message"
    ]);
    expect(
      isVisibleMessage({
        role: "system",
        systemKind: "compaction_notice"
      })
    ).toBe(false);
  });

  it("retrieves and compacts messages, and handles missing rows safely", () => {
    const conversation = createConversation();
    const message = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Reply",
      thinkingContent: "Reasoning"
    });

    expect(getConversation("missing")).toBeNull();
    expect(getMessage(message.id)?.thinkingContent).toBe("Reasoning");
    expect(getMessage("missing")).toBeNull();

    markMessagesCompacted([]);
    markMessagesCompacted([message.id]);

    expect(getMessage(message.id)?.compactedAt).not.toBeNull();
    expect(getConversation(conversation.id)?.title).toBe("Conversation");
    expect(getConversation(conversation.id)?.titleGenerationStatus).toBe("pending");
  });

  it("claims title generation only once for the first user message", () => {
    const conversation = createConversation();
    const firstMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "First prompt"
    });
    const secondMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Second prompt"
    });

    expect(claimConversationTitleGeneration(conversation.id, secondMessage.id)).toBe(false);
    expect(claimConversationTitleGeneration(conversation.id, firstMessage.id)).toBe(true);
    expect(claimConversationTitleGeneration(conversation.id, firstMessage.id)).toBe(false);
  });

  it("marks explicit conversation titles as completed", () => {
    const conversation = createConversation("Pinned runtime");

    expect(conversation.title).toBe("Pinned runtime");
    expect(conversation.titleGenerationStatus).toBe("completed");
  });

  it("deletes empty conversations only when they have no messages", () => {
    const emptyConversation = createConversation();
    const populatedConversation = createConversation();

    createMessage({
      conversationId: populatedConversation.id,
      role: "user",
      content: "Keep this thread"
    });

    expect(deleteConversationIfEmpty(populatedConversation.id)).toBe(false);
    expect(getConversation(populatedConversation.id)).not.toBeNull();

    expect(deleteConversationIfEmpty(emptyConversation.id)).toBe(true);
    expect(getConversation(emptyConversation.id)).toBeNull();
  });

  it("uses a deterministic title for attachment-only first turns", async () => {
    const conversation = createConversation();
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: ""
    });

    await generateConversationTitleFromFirstUserMessage(conversation.id, message.id);

    expect(getConversation(conversation.id)?.title).toBe("Files");
    expect(getConversation(conversation.id)?.titleGenerationStatus).toBe("completed");
    expect(generateConversationTitle).not.toHaveBeenCalled();
  });

  it("marks title generation as failed without changing updated_at when the provider errors", async () => {
    const conversation = createConversation();
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Build a checklist"
    });
    const before = getConversation(conversation.id);

    generateConversationTitle.mockRejectedValue(new Error("unreachable"));

    await generateConversationTitleFromFirstUserMessage(conversation.id, message.id);

    const after = getConversation(conversation.id);

    expect(after?.title).toBe("Conversation");
    expect(after?.titleGenerationStatus).toBe("failed");
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("can complete or fail title generation without bumping the conversation timestamp", () => {
    const conversation = createConversation();
    const before = getConversation(conversation.id);

    completeConversationTitleGeneration(conversation.id, "Deployment Checklist");
    const completed = getConversation(conversation.id);
    failConversationTitleGeneration(conversation.id);
    const failed = getConversation(conversation.id);

    expect(completed?.title).toBe("Deployment Checklist");
    expect(completed?.titleGenerationStatus).toBe("completed");
    expect(completed?.updatedAt).toBe(before?.updatedAt);
    expect(failed?.title).toBe("Conversation");
    expect(failed?.titleGenerationStatus).toBe("failed");
    expect(failed?.updatedAt).toBe(before?.updatedAt);
  });

  it("updates the conversation provider profile", () => {
    const conversation = createConversation();
    const nextProfileId = listProviderProfiles().at(-1)?.id ?? getSettings().defaultProviderProfileId;

    updateConversationProviderProfile(conversation.id, nextProfileId);

    expect(getConversation(conversation.id)?.providerProfileId).toBe(nextProfileId);
  });

  it("stores message actions on assistant turns and hydrates them from message reads", () => {
    const conversation = createConversation();
    const message = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Reply"
    });

    const action = createMessageAction({
      messageId: message.id,
      kind: "mcp_tool_call",
      serverId: "mcp_docs",
      toolName: "search_docs",
      label: "Search docs",
      detail: "query=MCP",
      arguments: { query: "MCP" },
      sortOrder: 0
    });

    const updated = updateMessageAction(action.id, {
      status: "completed",
      resultSummary: "Found docs",
      completedAt: new Date().toISOString()
    });

    expect(updated?.status).toBe("completed");
    expect(updated?.resultSummary).toBe("Found docs");
    expect(getMessage(message.id)?.actions).toEqual([
      expect.objectContaining({
        id: action.id,
        label: "Search docs",
        resultSummary: "Found docs",
        serverId: "mcp_docs",
        toolName: "search_docs",
        arguments: { query: "MCP" }
      })
    ]);
    expect(listMessages(conversation.id)[0]?.actions).toEqual([
      expect.objectContaining({
        id: action.id,
        status: "completed"
      })
    ]);
  });

  it("hydrates assistant text segments into a chronological timeline", () => {
    const conversation = createConversation();
    const message = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "FirstSecond"
    });

    createMessageTextSegment({
      messageId: message.id,
      content: "First",
      sortOrder: 0
    });

    createMessageAction({
      messageId: message.id,
      kind: "mcp_tool_call",
      serverId: "mcp_docs",
      toolName: "search_docs",
      label: "Search docs",
      detail: "query=MCP",
      arguments: { query: "MCP" },
      sortOrder: 1
    });

    createMessageTextSegment({
      messageId: message.id,
      content: "Second",
      sortOrder: 2
    });

    expect(getMessage(message.id)?.timeline).toEqual([
      expect.objectContaining({
        timelineKind: "text",
        content: "First",
        sortOrder: 0
      }),
      expect.objectContaining({
        timelineKind: "action",
        label: "Search docs",
        sortOrder: 1
      }),
      expect.objectContaining({
        timelineKind: "text",
        content: "Second",
        sortOrder: 2
      })
    ]);
  });

  it("updates message content and returns the refreshed message row", () => {
    const conversation = createConversation();
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Original prompt"
    });

    const updated = updateMessage(message.id, {
      content: "Revised prompt",
      estimatedTokens: 42
    });

    expect(updated?.content).toBe("Revised prompt");
    expect(updated?.estimatedTokens).toBe(42);
    expect(getMessage(message.id)?.content).toBe("Revised prompt");
  });

  it("creates conversations with explicit runtime settings", () => {
    const nextProfileId =
      listProviderProfiles().at(-1)?.id ?? getSettings().defaultProviderProfileId;

    const conversation = createConversation("Pinned runtime", null, {
      providerProfileId: nextProfileId
    });

    expect(getConversation(conversation.id)?.providerProfileId).toBe(nextProfileId);
  });

  it("deletes conversation attachment records and files together", () => {
    const conversation = createConversation();
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("hello", "utf8")
      }
    ]);
    const attachmentDir = path.resolve(process.env.EIDON_DATA_DIR!, "attachments", conversation.id);

    deleteConversation(conversation.id);

    expect(getConversation(conversation.id)).toBeNull();
    expect(fs.existsSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath))).toBe(
      false
    );
    expect(fs.existsSync(attachmentDir)).toBe(false);
  });

  it("still deletes a conversation when an attachment file is already missing", () => {
    const conversation = createConversation();
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("hello", "utf8")
      }
    ]);
    const absolutePath = path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath);

    fs.unlinkSync(absolutePath);

    expect(() => deleteConversation(conversation.id)).not.toThrow();
    expect(getConversation(conversation.id)).toBeNull();
  });

  it("returns a snapshot with messages, actions, and segments for an in-progress conversation", async () => {
    const {
      getConversation,
      createMessage,
      createMessageTextSegment,
      createMessageAction,
      getConversationSnapshot
    } = await import("@/lib/conversations");

    const conv = createConversation(undefined, undefined, { providerProfileId: null });
    const userMsg = createMessage({ conversationId: conv.id, role: "user", content: "Hello" });
    const assistantMsg = createMessage({ conversationId: conv.id, role: "assistant", content: "", status: "streaming" });
    createMessageTextSegment({ messageId: assistantMsg.id, content: "partial answer" });
    createMessageAction({ messageId: assistantMsg.id, kind: "mcp_tool_call", label: "Search", status: "running" });

    const snapshot = getConversationSnapshot(conv.id);

    expect(snapshot.conversation.id).toBe(conv.id);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[0].role).toBe("user");
    expect(snapshot.messages[1].status).toBe("streaming");
    expect(snapshot.messages[1].textSegments).toHaveLength(1);
    expect(snapshot.messages[1].textSegments![0].content).toBe("partial answer");
    expect(snapshot.messages[1].actions).toHaveLength(1);
  });
});
