import fs from "node:fs";
import path from "node:path";

import { createAttachments } from "@/lib/attachments";
import { createAutomation, createAutomationRun } from "@/lib/automations";
import { createFolder } from "@/lib/folders";
import {
  claimConversationTitleGeneration,
  completeConversationTitleGeneration,
  createConversation,
  bindAttachmentsToMessage,
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
  forkConversationFromMessage,
  rewriteConversationFromEditedUserMessage,
  setConversationActive,
  listConversations,
  listConversationsPage,
  listMessages,
  listVisibleMessages,
  markMessagesCompacted,
  updateMessage,
  updateConversationProviderProfile,
  getConversationSnapshot,
  updateMessageAction
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getSettings, listProviderProfiles, updateSettings } from "@/lib/settings";
import { estimateMessageTokens } from "@/lib/tokenization";
import { createLocalUser } from "@/lib/users";

const { generateConversationTitle } = vi.hoisted(() => ({
  generateConversationTitle: vi.fn()
}));

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/conversation-title-generator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/conversation-title-generator")>();

  return {
    ...actual,
    generateConversationTitle
  };
});

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

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
    expect(conversation.automationId).toBeNull();
    expect(conversation.automationRunId).toBeNull();
    expect(conversation.conversationOrigin).toBe("manual");

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
    expect(getConversation(conversation.id)?.automationId).toBeNull();
    expect(getConversation(conversation.id)?.automationRunId).toBeNull();
    expect(getConversation(conversation.id)?.conversationOrigin).toBe("manual");
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

  it("sorts a newly forked conversation above its source in the sidebar", () => {
    const db = getDb();
    const sourceConversation = createConversation("Source thread");
    const userMessage = createMessage({
      conversationId: sourceConversation.id,
      role: "user",
      content: "Explore approach A"
    });
    const branchAssistantMessage = createMessage({
      conversationId: sourceConversation.id,
      role: "assistant",
      content: "Approach A details"
    });
    createMessage({
      conversationId: sourceConversation.id,
      role: "assistant",
      content: "Later continuation"
    });

    db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(
      "2026-04-11T10:00:00.000Z",
      userMessage.id
    );
    db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(
      "2026-04-11T10:01:00.000Z",
      branchAssistantMessage.id
    );
    db.prepare(
      "UPDATE messages SET created_at = ? WHERE conversation_id = ? AND content = ?"
    ).run("2026-04-11T10:02:00.000Z", sourceConversation.id, "Later continuation");
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
      "2026-04-11T10:02:00.000Z",
      sourceConversation.id
    );

    const forkConversation = forkConversationFromMessage(branchAssistantMessage.id);
    const conversationIds = listConversationsPage().conversations.map((conversation) => conversation.id);

    expect(conversationIds.slice(0, 2)).toEqual([forkConversation.id, sourceConversation.id]);
  });

  it("retrieves messages only for the requested user", async () => {
    const userA = await createLocalUser({
      username: "message-owner-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "message-owner-b",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Owned chat", null, undefined, userA.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Private message"
    });

    expect(getMessage(message.id, userA.id)?.content).toBe("Private message");
    expect(getMessage(message.id, userB.id)).toBeNull();
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

  it("excludes automation conversations from the manual chat page", () => {
    const automation = createAutomation({
      name: "Automation",
      prompt: "Run automatically",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 5,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });
    const automationRun = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-04-09T00:00:00.000Z",
      triggerSource: "schedule"
    });

    createConversation("Manual thread");
    createConversation("Automation thread", null, {
      providerProfileId: "profile_default",
      origin: "automation",
      automationId: automation.id,
      automationRunId: automationRun.id
    });

    expect(listConversationsPage().conversations.map((conversation) => conversation.title)).toEqual([
      "Manual thread"
    ]);
  });

  it("returns only the current owner's manual conversations", async () => {
    const userA = await createLocalUser({
      username: "conversation-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "conversation-b",
      password: "Password123!",
      role: "user"
    });

    createConversation("Admin thread", null, undefined, userA.id);
    createConversation("Member thread", null, undefined, userB.id);

    expect(listConversations(userA.id)).toHaveLength(1);
    expect(listConversations(userB.id)).toHaveLength(1);
    expect(listConversations(userA.id)[0]?.id).not.toBe(listConversations(userB.id)[0]?.id);
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
    const nextProfileId =
      listProviderProfiles().at(-1)?.id ?? getSettings().defaultProviderProfileId ?? "";

    updateConversationProviderProfile(conversation.id, nextProfileId);

    expect(getConversation(conversation.id)?.providerProfileId).toBe(nextProfileId);
  });

  it("updates the conversation provider profile only for the requested user", async () => {
    updateSettings({
      ...getSettings(),
      providerProfiles: [
        ...listProviderProfiles(),
        {
          id: "profile_secondary",
          name: "Secondary",
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "sk-secondary",
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
    const nextProfileId = "profile_secondary";
    const userA = await createLocalUser({
      username: "provider-profile-owner-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "provider-profile-owner-b",
      password: "Password123!",
      role: "user"
    });
    const ownedConversation = createConversation("Owned", null, undefined, userA.id);
    const otherConversation = createConversation("Other", null, undefined, userB.id);

    updateConversationProviderProfile(ownedConversation.id, nextProfileId, userA.id);
    updateConversationProviderProfile(otherConversation.id, nextProfileId, userA.id);

    expect(getConversation(ownedConversation.id)?.providerProfileId).toBe(nextProfileId);
    expect(getConversation(otherConversation.id)?.providerProfileId).not.toBe(nextProfileId);
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

  it("persists proposal metadata on message actions", async () => {
    const conversation = createConversation();

    const message = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0
    });

    const created = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Save memory",
      proposalState: "pending",
      proposalPayload: {
        operation: "create",
        targetMemoryId: null,
        proposedMemory: { content: "User prefers TypeScript", category: "preference" }
      }
    });

    expect(created.proposalState).toBe("pending");
    expect(created.proposalPayload?.operation).toBe("create");
    expect(getMessage(message.id)?.actions?.[0]?.proposalPayload).toEqual(created.proposalPayload);
    expect(listMessages(conversation.id)[0]?.actions?.[0]?.proposalPayload).toEqual(created.proposalPayload);

    const updated = updateMessageAction(created.id, {
      status: "completed",
      proposalState: "dismissed",
      proposalUpdatedAt: "2026-04-11T12:00:00.000Z"
    });

    expect(updated?.proposalState).toBe("dismissed");
    expect(updated?.proposalUpdatedAt).toBe("2026-04-11T12:00:00.000Z");
    expect(getMessage(message.id)?.actions?.[0]).toEqual(
      expect.objectContaining({
        proposalState: "dismissed",
        proposalUpdatedAt: "2026-04-11T12:00:00.000Z",
        proposalPayload: created.proposalPayload
      })
    );
    expect(listMessages(conversation.id)[0]?.actions?.[0]).toEqual(
      expect.objectContaining({
        proposalState: "dismissed",
        proposalUpdatedAt: "2026-04-11T12:00:00.000Z",
        proposalPayload: created.proposalPayload
      })
    );
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

  it("forks a conversation from an assistant message and clones the retained prefix", async () => {
    const user = await createLocalUser({
      username: "fork-owner",
      password: "Password123!",
      role: "user"
    });
    const folder = createFolder("Source folder", user.id);
    const sourceConversation = createConversation("Source thread", folder.id, {
      providerProfileId: "profile_default"
    }, user.id);
    const userMessage = createMessage({
      conversationId: sourceConversation.id,
      role: "user",
      content: "First prompt"
    });
    const assistantMessage = createMessage({
      conversationId: sourceConversation.id,
      role: "assistant",
      content: "First reply",
      thinkingContent: "Reasoning kept"
    });
    const sourceMessageTimes = {
      user: "2026-04-11T10:00:00.000Z",
      assistant: "2026-04-11T10:00:30.000Z",
      laterAssistant: "2026-04-11T10:01:30.000Z"
    };
    const sourceActionTimes = {
      startedAt: "2026-04-11T10:00:45.000Z",
      completedAt: "2026-04-11T10:01:00.000Z"
    };
    const sourceTextSegmentTime = "2026-04-11T10:00:40.000Z";
    const db = getDb();

    createMessageAction({
      messageId: assistantMessage.id,
      kind: "mcp_tool_call",
      serverId: "mcp_docs",
      toolName: "search_docs",
      label: "Search docs",
      detail: "query=forking",
      arguments: { query: "forking" },
      status: "completed",
      resultSummary: "Found docs",
      sortOrder: 0
    });
    createMessageTextSegment({
      messageId: assistantMessage.id,
      content: "Partial answer",
      sortOrder: 0
    });
    db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(sourceMessageTimes.user, userMessage.id);
    db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(
      sourceMessageTimes.assistant,
      assistantMessage.id
    );
    db.prepare("UPDATE message_actions SET started_at = ?, completed_at = ?, status = ? WHERE message_id = ?").run(
      sourceActionTimes.startedAt,
      sourceActionTimes.completedAt,
      "completed",
      assistantMessage.id
    );
    db.prepare("UPDATE message_text_segments SET created_at = ? WHERE message_id = ?").run(
      sourceTextSegmentTime,
      assistantMessage.id
    );
    const [attachment] = createAttachments(sourceConversation.id, [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("source attachment", "utf8")
      }
    ]);
    bindAttachmentsToMessage(sourceConversation.id, assistantMessage.id, [attachment.id]);
    const laterAssistantMessage = createMessage({
      conversationId: sourceConversation.id,
      role: "assistant",
      content: "Later tail"
    });
    db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(
      sourceMessageTimes.laterAssistant,
      laterAssistantMessage.id
    );

    const sourceAssistantMessage = getMessage(assistantMessage.id);
    const sourceAssistantAction = sourceAssistantMessage?.actions?.[0];
    const sourceAssistantTextSegment = sourceAssistantMessage?.textSegments?.[0];

    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "mem_prefix",
      sourceConversation.id,
      "leaf_summary",
      0,
      "Prefix memory",
      userMessage.id,
      assistantMessage.id,
      20,
      10,
      JSON.stringify([]),
      "2026-04-11T10:00:10.000Z"
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "mem_superseding",
      sourceConversation.id,
      "leaf_summary",
      0,
      "Superseding memory",
      assistantMessage.id,
      assistantMessage.id,
      10,
      5,
      JSON.stringify([]),
      "2026-04-11T10:00:20.000Z"
    );
    db.prepare("UPDATE memory_nodes SET superseded_by_node_id = ? WHERE id = ?").run(
      "mem_superseding",
      "mem_prefix"
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "mem_noticeful",
      sourceConversation.id,
      "leaf_summary",
      0,
      "Notice memory",
      userMessage.id,
      assistantMessage.id,
      30,
      15,
      JSON.stringify([]),
      "2026-04-11T10:00:30.000Z"
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "mem_partial_child",
      sourceConversation.id,
      "leaf_summary",
      0,
      "Partial child memory",
      userMessage.id,
      assistantMessage.id,
      15,
      8,
      JSON.stringify(["mem_external_child"]),
      "2026-04-11T10:00:40.000Z"
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "mem_retained_with_tail_superseder",
      sourceConversation.id,
      "leaf_summary",
      0,
      "Retained memory with tail superseder",
      userMessage.id,
      assistantMessage.id,
      18,
      9,
      JSON.stringify([]),
      "mem_external_superseder",
      "2026-04-11T10:00:45.000Z"
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "mem_external_child",
      sourceConversation.id,
      "leaf_summary",
      0,
      "External child memory",
      laterAssistantMessage.id,
      laterAssistantMessage.id,
      5,
      3,
      JSON.stringify([]),
      "2026-04-11T10:00:50.000Z"
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "mem_external_superseder",
      sourceConversation.id,
      "leaf_summary",
      0,
      "External superseder",
      laterAssistantMessage.id,
      laterAssistantMessage.id,
      6,
      3,
      JSON.stringify([]),
      "2026-04-11T10:00:55.000Z"
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "mem_spanning",
      sourceConversation.id,
      "leaf_summary",
      0,
      "Tail memory",
      userMessage.id,
      laterAssistantMessage.id,
      40,
      20,
      JSON.stringify([]),
      "2026-04-11T10:01:00.000Z"
    );
    db.prepare(
      `INSERT INTO compaction_events (
        id,
        conversation_id,
        node_id,
        source_start_message_id,
        source_end_message_id,
        notice_message_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "cmp_prefix",
      sourceConversation.id,
      "mem_prefix",
      userMessage.id,
      assistantMessage.id,
      null,
      "2026-04-11T10:02:00.000Z"
    );
    db.prepare(
      `INSERT INTO compaction_events (
        id,
        conversation_id,
        node_id,
        source_start_message_id,
        source_end_message_id,
        notice_message_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "cmp_notice",
      sourceConversation.id,
      "mem_noticeful",
      userMessage.id,
      assistantMessage.id,
      laterAssistantMessage.id,
      "2026-04-11T10:02:30.000Z"
    );

    const forkConversation = forkConversationFromMessage(assistantMessage.id, user.id);

    expect(forkConversation.id).not.toBe(sourceConversation.id);
    expect(forkConversation.folderId).toBe(sourceConversation.folderId);
    expect(forkConversation.providerProfileId).toBe(sourceConversation.providerProfileId);
    expect(forkConversation.title).toBe("Fork Source thread");
    expect(forkConversation.titleGenerationStatus).toBe("completed");

    const forkMessages = listMessages(forkConversation.id);
    const [forkUserMessage, forkAssistantMessage] = forkMessages;
    const forkAttachment = forkAssistantMessage?.attachments?.[0];
    const forkAction = forkAssistantMessage?.actions?.[0];
    const forkTextSegment = forkAssistantMessage?.textSegments?.[0];

    expect(forkMessages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(forkMessages.map((message) => message.content)).toEqual(["First prompt", "First reply"]);
    expect(forkUserMessage?.createdAt).toBe(sourceMessageTimes.user);
    expect(forkAssistantMessage?.createdAt).toBe(sourceMessageTimes.assistant);
    expect(forkAssistantMessage?.thinkingContent).toBe("Reasoning kept");
    expect(forkAction).toEqual(expect.objectContaining({
      messageId: forkAssistantMessage?.id,
      label: "Search docs",
      toolName: "search_docs",
      resultSummary: "Found docs"
    }));
    expect(forkAction?.startedAt).toBe(sourceAssistantAction?.startedAt);
    expect(forkAction?.completedAt).toBe(sourceAssistantAction?.completedAt);
    expect(forkTextSegment).toEqual(expect.objectContaining({
      messageId: forkAssistantMessage?.id,
      content: "Partial answer"
    }));
    expect(forkTextSegment?.createdAt).toBe(sourceAssistantTextSegment?.createdAt);
    expect(forkAttachment).toEqual(expect.objectContaining({
      conversationId: forkConversation.id,
      messageId: forkAssistantMessage?.id,
      filename: "notes.txt",
      extractedText: "source attachment"
    }));
    expect(forkUserMessage?.id).not.toBe(userMessage.id);
    expect(forkAssistantMessage?.id).not.toBe(assistantMessage.id);
    expect(forkAttachment?.id).not.toBe(attachment.id);
    expect(forkAttachment?.relativePath).not.toBe(attachment.relativePath);

    const forkMemoryNodes = db
      .prepare(
        `SELECT id, content, source_start_message_id, source_end_message_id, superseded_by_node_id, child_node_ids
         FROM memory_nodes
         WHERE conversation_id = ?
         ORDER BY created_at ASC`
      )
      .all(forkConversation.id) as Array<{
      id: string;
      content: string;
      source_start_message_id: string;
      source_end_message_id: string;
      superseded_by_node_id: string | null;
      child_node_ids: string;
    }>;
    const forkCompactionEvents = db
      .prepare(
        `SELECT id, node_id, source_start_message_id, source_end_message_id, notice_message_id
         FROM compaction_events
         WHERE conversation_id = ?
         ORDER BY created_at ASC`
      )
      .all(forkConversation.id) as Array<{
      id: string;
      node_id: string;
      source_start_message_id: string;
      source_end_message_id: string;
      notice_message_id: string | null;
    }>;

    expect(forkMemoryNodes).toHaveLength(4);
    expect(forkMemoryNodes[0]).toEqual(expect.objectContaining({
      content: "Prefix memory",
      source_start_message_id: forkUserMessage?.id,
      source_end_message_id: forkAssistantMessage?.id
    }));
    expect(forkMemoryNodes[1]).toEqual(expect.objectContaining({
      content: "Superseding memory",
      source_start_message_id: forkAssistantMessage?.id,
      source_end_message_id: forkAssistantMessage?.id,
      superseded_by_node_id: null
    }));
    expect(forkMemoryNodes[0].superseded_by_node_id).toBe(forkMemoryNodes[1].id);
    expect(forkMemoryNodes.find((node) => node.content === "Notice memory")).toBeDefined();
    expect(
      forkMemoryNodes.find((node) => node.content === "Retained memory with tail superseder")
    ).toEqual(
      expect.objectContaining({
        source_start_message_id: forkUserMessage?.id,
        source_end_message_id: forkAssistantMessage?.id,
        superseded_by_node_id: null
      })
    );
    expect(forkMemoryNodes.find((node) => node.content === "Partial child memory")).toBeUndefined();
    expect(forkCompactionEvents).toHaveLength(1);
    expect(forkCompactionEvents[0]).toEqual(expect.objectContaining({
      source_start_message_id: forkUserMessage?.id,
      source_end_message_id: forkAssistantMessage?.id
    }));
    expect(forkMemoryNodes[0].id).toBe(forkCompactionEvents[0].node_id);
    expect(forkCompactionEvents[0].notice_message_id).toBeNull();

    expect(
      db
        .prepare("SELECT id FROM memory_nodes WHERE conversation_id = ? AND id = ?")
        .get(forkConversation.id, "mem_spanning")
    ).toBeUndefined();
    expect(
      db
        .prepare("SELECT id FROM compaction_events WHERE conversation_id = ? AND id = ?")
        .get(forkConversation.id, "cmp_prefix")
    ).toBeUndefined();

    deleteConversation(sourceConversation.id);
    expect(
      fs.existsSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath))
    ).toBe(false);
    expect(
      fs.existsSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments", forkAttachment?.relativePath ?? ""))
    ).toBe(true);
  });

  it("forks text attachments even when the source file is missing", async () => {
    const user = await createLocalUser({
      username: "fork-missing-text-attachment-owner",
      password: "Password123!",
      role: "user"
    });
    const sourceConversation = createConversation("Source thread", null, {
      providerProfileId: "profile_default"
    }, user.id);
    createMessage({
      conversationId: sourceConversation.id,
      role: "user",
      content: "First prompt"
    });
    const assistantMessage = createMessage({
      conversationId: sourceConversation.id,
      role: "assistant",
      content: "First reply"
    });
    const [attachment] = createAttachments(sourceConversation.id, [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("source attachment", "utf8")
      }
    ]);

    bindAttachmentsToMessage(sourceConversation.id, assistantMessage.id, [attachment.id]);
    fs.unlinkSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath));

    const forkConversation = forkConversationFromMessage(assistantMessage.id, user.id);
    const forkAssistantMessage = listMessages(forkConversation.id)[1];
    const forkAttachment = forkAssistantMessage?.attachments?.[0];
    const forkAttachmentPath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      forkAttachment?.relativePath ?? ""
    );

    expect(forkAttachment?.filename).toBe("notes.txt");
    expect(forkAttachment?.extractedText).toBe("source attachment");
    expect(fs.existsSync(forkAttachmentPath)).toBe(true);
    expect(fs.readFileSync(forkAttachmentPath, "utf8")).toBe("source attachment");
  });

  it("rewrites a user message, deletes later turns, and preserves the edited message attachment", () => {
    const conversation = createConversation("Rewrite target");
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Original prompt"
    });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "First answer"
    });
    const editedUser = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Need a deployment checklist"
    });
    const trailingAssistant = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Old checklist"
    });
    const [tailAttachment] = createAttachments(conversation.id, [
      {
        filename: "old-checklist.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("delete this attachment file", "utf8")
      }
    ]);

    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "context.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("retain this attachment", "utf8")
      }
    ]);
    bindAttachmentsToMessage(conversation.id, editedUser.id, [attachment.id]);
    bindAttachmentsToMessage(conversation.id, trailingAssistant.id, [tailAttachment.id]);
    setConversationActive(conversation.id, true);

    const tailAttachmentPath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      tailAttachment.relativePath
    );

    const rewritten = rewriteConversationFromEditedUserMessage(editedUser.id, {
      content: "Need a deployment checklist with rollback steps"
    });

    expect(rewritten.messages.map((message) => message.content)).toEqual([
      "Original prompt",
      "First answer",
      "Need a deployment checklist with rollback steps"
    ]);
    expect(rewritten.messages.at(-1)?.attachments?.map((item) => item.filename)).toEqual([
      "context.txt"
    ]);
    expect(rewritten.messages.at(-1)?.estimatedTokens).toBe(
      estimateMessageTokens(rewritten.messages.at(-1)!)
    );
    expect(rewritten.conversation.isActive).toBe(false);
    expect(
      rewritten.messages.some((message) => message.id === trailingAssistant.id)
    ).toBe(false);
    expect(fs.existsSync(tailAttachmentPath)).toBe(false);
    expect(getConversationSnapshot(conversation.id)?.messages).toHaveLength(3);
  });

  it("keeps tail attachment files and rows when rewrite rolls back", () => {
    const conversation = createConversation("Rewrite rollback");
    const editedUser = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Original prompt"
    });
    const trailingAssistant = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Tail answer"
    });
    const [tailAttachment] = createAttachments(conversation.id, [
      {
        filename: "tail.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("rollback-safe file", "utf8")
      }
    ]);
    bindAttachmentsToMessage(conversation.id, trailingAssistant.id, [tailAttachment.id]);

    const tailAttachmentPath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      tailAttachment.relativePath
    );
    const db = getDb();
    const originalPrepare = db.prepare.bind(db);
    const prepareSpy = vi.spyOn(db, "prepare");

    prepareSpy.mockImplementation(((sql: string) => {
      if (sql === "UPDATE conversations SET is_active = ?, updated_at = ? WHERE id = ?") {
        throw new Error("force rollback");
      }

      return originalPrepare(sql);
    }) as typeof db.prepare);

    expect(() =>
      rewriteConversationFromEditedUserMessage(editedUser.id, { content: "Edited prompt" })
    ).toThrow("force rollback");

    prepareSpy.mockRestore();

    expect(fs.existsSync(tailAttachmentPath)).toBe(true);
    expect(getMessage(editedUser.id)?.content).toBe("Original prompt");
    expect(getMessage(trailingAssistant.id)).not.toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) as count FROM message_attachments WHERE id = ?").get(tailAttachment.id)
    ).toEqual({ count: 1 });
  });

  it("removes compaction artifacts that depend on deleted tail messages", () => {
    const conversation = createConversation("Compaction cleanup");
    const firstUser = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "First request"
    });
    const firstAssistant = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "First answer"
    });
    const editedUser = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Second request"
    });
    const tailAssistant = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Later answer"
    });

    const db = getDb();
    db.prepare(
      `INSERT INTO memory_nodes (
        id, conversation_id, type, depth, content,
        source_start_message_id, source_end_message_id,
        source_token_count, summary_token_count, child_node_ids,
        superseded_by_node_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "mem_tail",
      conversation.id,
      "leaf_summary",
      0,
      "Summary reaching into deleted history",
      firstUser.id,
      tailAssistant.id,
      90,
      20,
      "[]",
      null,
      new Date().toISOString()
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id, conversation_id, type, depth, content,
        source_start_message_id, source_end_message_id,
        source_token_count, summary_token_count, child_node_ids,
        superseded_by_node_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "mem_retained",
      conversation.id,
      "leaf_summary",
      0,
      "Retained summary",
      firstUser.id,
      firstAssistant.id,
      40,
      10,
      "[]",
      "mem_edited",
      new Date().toISOString()
    );
    db.prepare(
      `INSERT INTO memory_nodes (
        id, conversation_id, type, depth, content,
        source_start_message_id, source_end_message_id,
        source_token_count, summary_token_count, child_node_ids,
        superseded_by_node_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "mem_edited",
      conversation.id,
      "leaf_summary",
      0,
      "Summary ending on edited message",
      firstUser.id,
      editedUser.id,
      60,
      15,
      "[]",
      null,
      new Date().toISOString()
    );

    db.prepare(
      `INSERT INTO compaction_events (
        id, conversation_id, node_id, source_start_message_id,
        source_end_message_id, notice_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "cmp_tail",
      conversation.id,
      "mem_tail",
      firstUser.id,
      tailAssistant.id,
      null,
      new Date().toISOString()
    );
    db.prepare(
      `INSERT INTO compaction_events (
        id, conversation_id, node_id, source_start_message_id,
        source_end_message_id, notice_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "cmp_edited",
      conversation.id,
      "mem_edited",
      firstUser.id,
      editedUser.id,
      null,
      new Date().toISOString()
    );

    rewriteConversationFromEditedUserMessage(editedUser.id, {
      content: "Edited second request"
    });

    expect(
      db
        .prepare(
          "SELECT id, superseded_by_node_id FROM memory_nodes WHERE conversation_id = ? ORDER BY id ASC"
        )
        .all(conversation.id)
    ).toEqual([
      {
        id: "mem_retained",
        superseded_by_node_id: null
      }
    ]);
    expect(
      db.prepare("SELECT COUNT(*) as count FROM compaction_events WHERE conversation_id = ?").get(conversation.id)
    ).toEqual({ count: 0 });
  });

  it("rejects rewriting a non-user message", () => {
    const conversation = createConversation("Assistant immutable");
    const assistant = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Cannot edit me"
    });

    expect(() =>
      rewriteConversationFromEditedUserMessage(assistant.id, { content: "changed" })
    ).toThrow("Only user messages can be edited");
  });

  it("rejects forking a missing message", () => {
    expect(() => forkConversationFromMessage("msg_missing")).toThrow("Message not found");
  });

  it("rejects forking a non-assistant message", async () => {
    const conversation = createConversation();
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Nope"
    });

    expect(() => forkConversationFromMessage(message.id)).toThrow(
      "Only assistant messages can be forked"
    );
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
    expect(snapshot).not.toBeNull();

    expect(snapshot!.conversation.id).toBe(conv.id);
    expect(snapshot!.messages).toHaveLength(2);
    expect(snapshot!.messages[0].role).toBe("user");
    expect(snapshot!.messages[1].status).toBe("streaming");
    expect(snapshot!.messages[1].textSegments).toHaveLength(1);
    expect(snapshot!.messages[1].textSegments![0].content).toBe("partial answer");
    expect(snapshot!.messages[1].actions).toHaveLength(1);
  });
});

describe("message fork routes", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue({
      id: "user_fork_route",
      username: "fork-route-user",
      role: "user",
      authSource: "local",
      passwordManagedBy: "local",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z"
    });
  });

  it("creates a forked conversation from an assistant message", async () => {
    const user = await createLocalUser({
      username: "fork-route-owner",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValueOnce(user);

    const conversation = createConversation("Forkable thread", null, undefined, user.id);
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Start here"
    });
    const assistantMessage = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Selected answer"
    });
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Later follow-up"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/fork/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${assistantMessage.id}/fork`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: assistantMessage.id }) }
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as { conversation: { id: string; title: string } };
    expect(body.conversation.id).toBeTruthy();
    expect(body.conversation.title).toBe("Fork Forkable thread");
    expect(listVisibleMessages(body.conversation.id).map((message) => message.content)).toEqual([
      "Start here",
      "Selected answer"
    ]);
  });

  it("rejects forks for user messages", async () => {
    const user = await createLocalUser({
      username: "fork-route-rejector",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValueOnce(user);

    const conversation = createConversation("Forkable thread", null, undefined, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Do not fork me"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/fork/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${userMessage.id}/fork`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: userMessage.id }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Only assistant messages can be forked"
    });
  });

  it("returns 404 for a missing message", async () => {
    const user = await createLocalUser({
      username: "fork-route-missing",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValueOnce(user);

    const { POST } = await import("@/app/api/messages/[messageId]/fork/route");
    const response = await POST(
      new Request("http://localhost/api/messages/msg_missing/fork", {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: "msg_missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Message not found"
    });
  });
});
