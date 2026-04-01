import fs from "node:fs";
import path from "node:path";

import { createAttachments } from "@/lib/attachments";
import {
  createConversation,
  deleteConversation,
  createMessageAction,
  createMessage,
  getConversation,
  getMessage,
  isVisibleMessage,
  listMessages,
  listVisibleMessages,
  markMessagesCompacted,
  maybeRetitleConversationFromFirstUserMessage,
  updateMessage,
  updateConversationProviderProfile,
  updateConversationToolExecutionMode,
  updateMessageAction
} from "@/lib/conversations";
import { getSettings, listProviderProfiles } from "@/lib/settings";

describe("conversation helpers", () => {
  it("creates conversations and retitles them from the first user message", () => {
    const conversation = createConversation();
    const defaultProfileId = getSettings().defaultProviderProfileId;

    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Build a small deployment checklist for me"
    });

    maybeRetitleConversationFromFirstUserMessage(conversation.id);

    expect(getConversation(conversation.id)?.title).toBe(
      "Build a small deployment checklist for me"
    );
    expect(getConversation(conversation.id)?.providerProfileId).toBe(defaultProfileId);
    expect(getConversation(conversation.id)?.toolExecutionMode).toBe("read_only");
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
      "Compacted older messages into memory.",
      "Visible user message"
    ]);
    expect(
      isVisibleMessage({
        role: "system",
        systemKind: null
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
    maybeRetitleConversationFromFirstUserMessage(conversation.id);
    expect(getConversation(conversation.id)?.title).toBe("New conversation");
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

  it("updates the conversation tool execution mode", () => {
    const conversation = createConversation();

    updateConversationToolExecutionMode(conversation.id, "read_write");

    expect(getConversation(conversation.id)?.toolExecutionMode).toBe("read_write");
  });

  it("creates conversations with explicit runtime settings", () => {
    const nextProfileId =
      listProviderProfiles().at(-1)?.id ?? getSettings().defaultProviderProfileId;

    const conversation = createConversation("Pinned runtime", null, {
      providerProfileId: nextProfileId,
      toolExecutionMode: "read_write"
    });

    expect(getConversation(conversation.id)?.providerProfileId).toBe(nextProfileId);
    expect(getConversation(conversation.id)?.toolExecutionMode).toBe("read_write");
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
    const attachmentDir = path.resolve(process.env.HERMES_DATA_DIR!, "attachments", conversation.id);

    deleteConversation(conversation.id);

    expect(getConversation(conversation.id)).toBeNull();
    expect(fs.existsSync(path.resolve(process.env.HERMES_DATA_DIR!, "attachments", attachment.relativePath))).toBe(
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
    const absolutePath = path.resolve(process.env.HERMES_DATA_DIR!, "attachments", attachment.relativePath);

    fs.unlinkSync(absolutePath);

    expect(() => deleteConversation(conversation.id)).not.toThrow();
    expect(getConversation(conversation.id)).toBeNull();
  });
});
