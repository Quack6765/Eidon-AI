import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

import { bindAttachmentsToMessage, createAttachments, listAttachmentsForConversation } from "@/lib/attachments";
import { claimChatTurnStart, hasActiveChatTurn, releaseChatTurnStart } from "@/lib/chat-turn-control";
import {
  createConversation,
  createMessage,
  forkConversationFromMessage,
  listMessages,
  rewindConversationToMessage,
  setConversationActive
} from "@/lib/conversations";
import { describeRewind, planConversationRewind } from "@/lib/conversation-rewind";
import { getDb } from "@/lib/db";
import { updateProviderCatalog } from "@/lib/settings";
import { createLocalUser } from "@/lib/users";
import { getConversationManager } from "@/lib/ws-singleton";
import { createProviderProfileInput } from "@/tests/provider-fixtures";

function attachmentPath(relativePath: string) {
  return path.resolve(process.env.EIDON_DATA_DIR!, "attachments", relativePath);
}

function insertLeafSummary(input: {
  id: string;
  conversationId: string;
  startMessageId: string;
  endMessageId: string;
}) {
  getDb().prepare(
    `INSERT INTO memory_nodes (
      id, conversation_id, type, depth, content,
      source_start_message_id, source_end_message_id,
      source_token_count, summary_token_count, child_node_ids,
      superseded_by_node_id, created_at
    ) VALUES (?, ?, 'leaf_summary', 0, ?, ?, ?, 40, 10, '[]', NULL, ?)`
  ).run(
    input.id,
    input.conversationId,
    `Summary ${input.id}`,
    input.startMessageId,
    input.endMessageId,
    new Date().toISOString()
  );
}

function listMemoryNodeIds(conversationId: string) {
  return (
    getDb()
      .prepare("SELECT id FROM memory_nodes WHERE conversation_id = ? ORDER BY id")
      .all(conversationId) as Array<{ id: string }>
  ).map((row) => row.id);
}

async function seedThread(userId?: string) {
  const conversation = createConversation("Rewind target", null, undefined, userId);
  const firstUser = createMessage({ conversationId: conversation.id, role: "user", content: "First question" });
  const firstAssistant = createMessage({ conversationId: conversation.id, role: "assistant", content: "First answer" });
  const secondUser = createMessage({ conversationId: conversation.id, role: "user", content: "Second question" });
  const secondAssistant = createMessage({ conversationId: conversation.id, role: "assistant", content: "Second answer" });
  const [userAttachment, assistantAttachment] = await createAttachments(conversation.id, [
    { filename: "brief.txt", mimeType: "text/plain", bytes: Buffer.from("user brief", "utf8") },
    { filename: "report.txt", mimeType: "text/plain", bytes: Buffer.from("assistant report", "utf8") }
  ]);
  bindAttachmentsToMessage(conversation.id, secondUser.id, [userAttachment.id]);
  bindAttachmentsToMessage(conversation.id, secondAssistant.id, [assistantAttachment.id]);

  return {
    conversation,
    firstUser,
    firstAssistant,
    secondUser,
    secondAssistant,
    userAttachment,
    assistantAttachment
  };
}

describe("planConversationRewind", () => {
  const messages = [
    { id: "u1", role: "user" as const },
    { id: "a1", role: "assistant" as const },
    { id: "s1", role: "system" as const },
    { id: "u2", role: "user" as const }
  ];

  it("keeps an assistant reply and removes what follows it", () => {
    expect(planConversationRewind(messages, "a1")).toEqual({
      message: messages[1],
      removedMessages: [messages[2], messages[3]],
      restoresDraft: false
    });
  });

  it("removes a user message itself and restores it as a draft", () => {
    expect(planConversationRewind(messages, "u2")).toEqual({
      message: messages[3],
      removedMessages: [messages[3]],
      restoresDraft: true
    });
  });

  it("does not plan a rewind for system or unknown messages", () => {
    expect(planConversationRewind(messages, "s1")).toBeNull();
    expect(planConversationRewind(messages, "missing")).toBeNull();
  });

  it("describes how many messages were rewound", () => {
    expect(describeRewind(1)).toBe("Rewound 1 message");
    expect(describeRewind(3)).toBe("Rewound 3 messages");
  });
});

describe("rewindConversationToMessage", () => {
  it("keeps an assistant reply and discards everything after it", async () => {
    const thread = await seedThread();

    const result = rewindConversationToMessage(thread.firstAssistant.id);

    expect(result.draft).toBeNull();
    expect(result.deletedMessageIds).toEqual([thread.secondUser.id, thread.secondAssistant.id]);
    expect(result.snapshot.messages.map((message) => message.content)).toEqual([
      "First question",
      "First answer"
    ]);
    expect(listMessages(thread.conversation.id)).toHaveLength(2);
    expect(listAttachmentsForConversation(thread.conversation.id)).toEqual([]);
    expect(fs.existsSync(attachmentPath(thread.userAttachment.relativePath))).toBe(false);
    expect(fs.existsSync(attachmentPath(thread.assistantAttachment.relativePath))).toBe(false);
  });

  it("removes a user message and returns its text and attachments as a draft", async () => {
    const thread = await seedThread();

    const result = rewindConversationToMessage(thread.secondUser.id);

    expect(result.deletedMessageIds).toEqual([thread.secondUser.id, thread.secondAssistant.id]);
    expect(result.snapshot.messages.map((message) => message.content)).toEqual([
      "First question",
      "First answer"
    ]);
    expect(result.draft?.content).toBe("Second question");
    expect(result.draft?.attachments).toEqual([
      expect.objectContaining({
        id: thread.userAttachment.id,
        conversationId: thread.conversation.id,
        messageId: null,
        filename: "brief.txt"
      })
    ]);
    expect(Date.parse(result.draft!.attachments[0].createdAt)).toBeGreaterThanOrEqual(
      Date.parse(thread.userAttachment.createdAt)
    );
    expect(fs.existsSync(attachmentPath(thread.userAttachment.relativePath))).toBe(true);
    expect(fs.existsSync(attachmentPath(thread.assistantAttachment.relativePath))).toBe(false);

    const resent = createMessage({ conversationId: thread.conversation.id, role: "user", content: "Second question, again" });
    expect(
      bindAttachmentsToMessage(thread.conversation.id, resent.id, [thread.userAttachment.id]).map(
        (attachment) => attachment.messageId
      )
    ).toEqual([resent.id]);
  });

  it("can rewind the first user message into an empty conversation", async () => {
    const thread = await seedThread();

    const result = rewindConversationToMessage(thread.firstUser.id);

    expect(result.snapshot.messages).toEqual([]);
    expect(result.draft).toEqual({ content: "First question", attachments: [] });
    expect(result.snapshot.conversation.id).toBe(thread.conversation.id);
  });

  it("is a no-op on the latest assistant reply", async () => {
    const thread = await seedThread();

    const result = rewindConversationToMessage(thread.secondAssistant.id);

    expect(result.deletedMessageIds).toEqual([]);
    expect(result.draft).toBeNull();
    expect(result.snapshot.messages).toHaveLength(4);
  });

  it("drops compaction summaries that reach into the discarded messages and restores what they covered", async () => {
    const thread = await seedThread();
    insertLeafSummary({
      id: "mem_kept",
      conversationId: thread.conversation.id,
      startMessageId: thread.firstUser.id,
      endMessageId: thread.firstAssistant.id
    });
    insertLeafSummary({
      id: "mem_spanning",
      conversationId: thread.conversation.id,
      startMessageId: thread.firstAssistant.id,
      endMessageId: thread.secondUser.id
    });
    getDb()
      .prepare("UPDATE messages SET compacted_at = ? WHERE conversation_id = ?")
      .run(new Date().toISOString(), thread.conversation.id);

    rewindConversationToMessage(thread.firstAssistant.id);

    expect(listMemoryNodeIds(thread.conversation.id)).toEqual(["mem_kept"]);
    const [firstUser, firstAssistant] = listMessages(thread.conversation.id);
    expect(firstUser.compactedAt).not.toBeNull();
    expect(firstAssistant.compactedAt).toBeNull();
  });

  it("rejects missing, system, and foreign messages", async () => {
    const owner = await createLocalUser({ username: "rewind-owner", password: "Password123!", role: "user" });
    const other = await createLocalUser({ username: "rewind-other", password: "Password123!", role: "user" });
    const thread = await seedThread(owner.id);
    const notice = createMessage({
      conversationId: thread.conversation.id,
      role: "system",
      content: "Compacted",
      systemKind: "compaction_notice"
    });

    expect(() => rewindConversationToMessage("msg_missing")).toThrow("Message not found");
    expect(() => rewindConversationToMessage(notice.id)).toThrow(
      "Only user and assistant messages can be rewound to"
    );
    expect(() => rewindConversationToMessage(thread.firstAssistant.id, other.id)).toThrow("Message not found");
    expect(listMessages(thread.conversation.id)).toHaveLength(5);
  });
});

describe("forkConversationFromMessage from a user message", () => {
  it("copies the history before the message and returns it as the fork's draft", async () => {
    const thread = await seedThread();

    const { conversation, draft } = forkConversationFromMessage(thread.secondUser.id);

    expect(conversation.id).not.toBe(thread.conversation.id);
    expect(conversation.title).toBe("Fork Rewind target");
    expect(listMessages(conversation.id).map((message) => message.content)).toEqual([
      "First question",
      "First answer"
    ]);
    expect(draft?.content).toBe("Second question");
    expect(draft?.attachments).toEqual([
      expect.objectContaining({ conversationId: conversation.id, messageId: null, filename: "brief.txt" })
    ]);
    expect(draft?.attachments[0].id).not.toBe(thread.userAttachment.id);
    expect(fs.readFileSync(attachmentPath(draft!.attachments[0].relativePath), "utf8")).toBe("user brief");
    expect(listMessages(thread.conversation.id)).toHaveLength(4);
    expect(listMessages(thread.conversation.id)[2].attachments?.[0]?.id).toBe(thread.userAttachment.id);
  });

  it("returns no draft when forking from an assistant reply", async () => {
    const thread = await seedThread();

    const { conversation, draft } = forkConversationFromMessage(thread.firstAssistant.id);

    expect(draft).toBeNull();
    expect(listMessages(conversation.id)).toHaveLength(2);
    expect(listAttachmentsForConversation(conversation.id)).toEqual([]);
  });

  it("forks the first user message into an empty conversation", async () => {
    const thread = await seedThread();

    const { conversation, draft } = forkConversationFromMessage(thread.firstUser.id);

    expect(listMessages(conversation.id)).toEqual([]);
    expect(draft).toEqual({ content: "First question", attachments: [] });
  });

  it("refuses to fork a bot home conversation", () => {
    const conversation = createConversation("Researcher", null, { origin: "bot" });
    const assistant = createMessage({ conversationId: conversation.id, role: "assistant", content: "On it" });

    expect(() => forkConversationFromMessage(assistant.id)).toThrow("Bot conversations cannot be forked");
  });
});

describe("message rewind and fork routes", () => {
  let roomEvents: Array<{ conversationId: string; event: unknown }>;
  let userEvents: Array<{ event: unknown; userId?: string | null }>;

  beforeEach(() => {
    requireUserMock.mockReset();
    roomEvents = [];
    userEvents = [];
    const manager = getConversationManager();
    vi.spyOn(manager, "broadcast").mockImplementation((conversationId, event) => {
      roomEvents.push({ conversationId, event });
    });
    vi.spyOn(manager, "broadcastAll").mockImplementation((event, userId) => {
      userEvents.push({ event, userId });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function signIn(username: string) {
    const user = await createLocalUser({ username, password: "Password123!", role: "user" });
    requireUserMock.mockResolvedValue(user);
    return user;
  }

  async function postRewind(messageId: string) {
    const { POST } = await import("@/app/api/messages/[messageId]/rewind/route");
    return POST(
      new Request(`http://localhost/api/messages/${messageId}/rewind`, { method: "POST" }),
      { params: Promise.resolve({ messageId }) }
    );
  }

  async function postFork(messageId: string) {
    const { POST } = await import("@/app/api/messages/[messageId]/fork/route");
    return POST(
      new Request(`http://localhost/api/messages/${messageId}/fork`, { method: "POST" }),
      { params: Promise.resolve({ messageId }) }
    );
  }

  it("rewinds, returns the snapshot with the draft, and tells other clients which messages went", async () => {
    const user = await signIn("rewind-route-owner");
    const thread = await seedThread(user.id);

    const response = await postRewind(thread.secondUser.id);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      conversation: { id: string };
      messages: Array<{ content: string }>;
      queuedMessages: unknown[];
      draft: { content: string; attachments: Array<{ id: string; messageId: string | null }> };
    };
    expect(body.conversation.id).toBe(thread.conversation.id);
    expect(body.messages.map((message) => message.content)).toEqual(["First question", "First answer"]);
    expect(body.queuedMessages).toEqual([]);
    expect(body.draft.content).toBe("Second question");
    expect(body.draft.attachments).toEqual([
      expect.objectContaining({ id: thread.userAttachment.id, messageId: null })
    ]);
    expect(roomEvents[0]).toEqual({
      conversationId: thread.conversation.id,
      event: {
        type: "messages_deleted",
        conversationId: thread.conversation.id,
        messageIds: [thread.secondUser.id, thread.secondAssistant.id]
      }
    });
    expect(hasActiveChatTurn(thread.conversation.id)).toBe(false);
  });

  it("broadcasts the smaller context usage after a rewind", async () => {
    updateProviderCatalog({
      defaultProviderProfileId: "profile_rewind",
      skillsEnabled: true,
      providerProfiles: [
        createProviderProfileInput({ id: "profile_rewind", name: "Rewind", model: "gpt-5-mini", maxOutputTokens: 512, modelContextLimit: 16000 })
      ]
    });
    const user = await signIn("rewind-route-usage");
    const thread = await seedThread(user.id);

    await postRewind(thread.firstAssistant.id);

    expect(roomEvents.map(({ event }) => event)).toContainEqual({
      type: "delta",
      conversationId: thread.conversation.id,
      event: { type: "context_usage", contextTokens: expect.any(Number), compactionLimit: expect.any(Number) }
    });
  });

  it("does not broadcast when nothing was removed", async () => {
    const user = await signIn("rewind-route-noop");
    const thread = await seedThread(user.id);

    const response = await postRewind(thread.secondAssistant.id);

    expect(response.status).toBe(200);
    expect(roomEvents).toEqual([]);
  });

  it("refuses to rewind while a reply is streaming or a turn is starting", async () => {
    const user = await signIn("rewind-route-busy");
    const thread = await seedThread(user.id);

    setConversationActive(thread.conversation.id, true);
    const activeResponse = await postRewind(thread.firstAssistant.id);
    expect(activeResponse.status).toBe(409);

    setConversationActive(thread.conversation.id, false);
    const claimed = claimChatTurnStart(thread.conversation.id);
    expect(claimed.ok).toBe(true);
    try {
      const claimedResponse = await postRewind(thread.firstAssistant.id);
      expect(claimedResponse.status).toBe(409);
      await expect(claimedResponse.json()).resolves.toEqual({
        error: "Wait for the current assistant response to finish before rewinding this conversation"
      });
    } finally {
      if (claimed.ok) releaseChatTurnStart(thread.conversation.id, claimed.control);
    }

    expect(listMessages(thread.conversation.id)).toHaveLength(4);
    expect(roomEvents).toEqual([]);
  });

  it("returns 404 for another user's message and 400 for a system message", async () => {
    const owner = await createLocalUser({ username: "rewind-route-a", password: "Password123!", role: "user" });
    const thread = await seedThread(owner.id);
    const notice = createMessage({
      conversationId: thread.conversation.id,
      role: "system",
      content: "Compacted",
      systemKind: "compaction_notice"
    });

    await signIn("rewind-route-b");
    expect((await postRewind(thread.firstAssistant.id)).status).toBe(404);

    requireUserMock.mockResolvedValue(owner);
    const systemResponse = await postRewind(notice.id);
    expect(systemResponse.status).toBe(400);
    await expect(systemResponse.json()).resolves.toEqual({
      error: "Only user and assistant messages can be rewound to"
    });
  });

  it("forks from a user message, returns the draft, and announces the new conversation", async () => {
    const user = await signIn("fork-route-user-message");
    const thread = await seedThread(user.id);

    const response = await postFork(thread.secondUser.id);

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      conversation: { id: string; title: string };
      draft: { content: string; attachments: Array<{ conversationId: string; messageId: string | null }> };
    };
    expect(body.conversation.title).toBe("Fork Rewind target");
    expect(body.draft.content).toBe("Second question");
    expect(body.draft.attachments).toEqual([
      expect.objectContaining({ conversationId: body.conversation.id, messageId: null })
    ]);
    expect(userEvents).toEqual([
      {
        event: expect.objectContaining({
          type: "conversation_created",
          conversation: expect.objectContaining({ id: body.conversation.id, title: "Fork Rewind target" })
        }),
        userId: user.id
      }
    ]);
  });

  it("refuses to fork a bot home conversation", async () => {
    const user = await signIn("fork-route-bot");
    const conversation = createConversation("Researcher", null, { origin: "bot" }, user.id);
    const assistant = createMessage({ conversationId: conversation.id, role: "assistant", content: "On it" });

    const response = await postFork(assistant.id);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Bot conversations cannot be forked" });
    expect(userEvents).toEqual([]);
  });
});
