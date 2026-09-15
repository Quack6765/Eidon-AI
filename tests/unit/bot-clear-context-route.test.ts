import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

import { bindAttachmentsToMessage, createAttachments } from "@/lib/attachments";
import { createBotRunRecord } from "@/lib/bot-runs";
import { createBot, getBot } from "@/lib/bots";
import {
  clearConversationContent,
  createConversation,
  createMessage,
  createQueuedMessage,
  getConversation,
  listMessages,
  listQueuedMessages
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
import {
  claimChatTurnStart,
  releaseChatTurnStart
} from "@/lib/chat-turn-control";
import { getConversationManager } from "@/lib/ws-singleton";
import { createLocalUser } from "@/lib/users";

function buildContext(botId: string) {
  return { params: Promise.resolve({ botId }) };
}

function countRows(table: string, conversationId: string) {
  return (
    getDb()
      .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE conversation_id = ?`)
      .get(conversationId) as { count: number }
  ).count;
}

function seedConversationContent(conversationId: string, seedId: string) {
  const userMessage = createMessage({
    conversationId,
    role: "user",
    content: "Please research this topic"
  });
  const assistantMessage = createMessage({
    conversationId,
    role: "assistant",
    content: "Here is what I found."
  });
  createQueuedMessage({ conversationId, content: "Follow-up question" });

  const db = getDb();
  db.prepare(
    `INSERT INTO memory_nodes (
      id, conversation_id, type, depth, content, source_start_message_id,
      source_end_message_id, source_token_count, summary_token_count, child_node_ids, created_at
    ) VALUES (?, ?, 'summary', 0, 'Summary of the thread', ?, ?, 100, 10, '[]', ?)`
  ).run(`${seedId}_node`, conversationId, userMessage.id, assistantMessage.id, new Date().toISOString());
  db.prepare(
    `INSERT INTO compaction_events (
      id, conversation_id, node_id, source_start_message_id, source_end_message_id, notice_message_id, created_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    `${seedId}_cevent`,
    conversationId,
    `${seedId}_node`,
    userMessage.id,
    assistantMessage.id,
    new Date().toISOString()
  );
  db.prepare(
    `INSERT INTO semantic_chunks (
      id, kind, ref_id, chunk_index, conversation_id, chunk_text, content_hash,
      model_id, dim, embedding, source_created_at, created_at
    ) VALUES (?, 'conversation_message', ?, 0, ?, 'chunk text', 'hash', 'model', 8, ?, ?, ?)`
  ).run(
    `${seedId}_chunk`,
    userMessage.id,
    conversationId,
    Buffer.from(new Float32Array(8).buffer),
    new Date().toISOString(),
    new Date().toISOString()
  );

  return { userMessage, assistantMessage };
}

async function seedAttachments(conversationId: string, messageId: string) {
  const [bound] = await createAttachments(conversationId, [
    { filename: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("bound attachment", "utf8") }
  ]);
  const [unbound] = await createAttachments(conversationId, [
    { filename: "draft.txt", mimeType: "text/plain", bytes: Buffer.from("unbound attachment", "utf8") }
  ]);
  bindAttachmentsToMessage(conversationId, messageId, [bound.id]);
  return { bound, unbound };
}

describe("clearConversationContent", () => {
  it("wipes all conversation-scoped content but keeps the conversation row and siblings", async () => {
    const conversation = createConversation("Bot thread");
    const sibling = createConversation("Other thread");
    const { userMessage } = seedConversationContent(conversation.id, "a");
    seedConversationContent(sibling.id, "b");
    const { bound, unbound } = await seedAttachments(conversation.id, userMessage.id);
    const boundPath = path.resolve(process.env.EIDON_DATA_DIR!, "attachments", bound.relativePath);
    const unboundPath = path.resolve(process.env.EIDON_DATA_DIR!, "attachments", unbound.relativePath);
    expect(fs.existsSync(boundPath)).toBe(true);
    expect(fs.existsSync(unboundPath)).toBe(true);

    const result = clearConversationContent(conversation.id);

    expect(result.deletedAttachments).toBe(2);
    expect(getConversation(conversation.id)).not.toBeNull();
    expect(getConversation(conversation.id)?.isActive).toBe(false);
    expect(listMessages(conversation.id)).toHaveLength(0);
    expect(listQueuedMessages(conversation.id)).toHaveLength(0);
    expect(countRows("message_attachments", conversation.id)).toBe(0);
    expect(countRows("memory_nodes", conversation.id)).toBe(0);
    expect(countRows("compaction_events", conversation.id)).toBe(0);
    expect(countRows("semantic_chunks", conversation.id)).toBe(0);
    expect(fs.existsSync(boundPath)).toBe(false);
    expect(fs.existsSync(unboundPath)).toBe(false);

    expect(listMessages(sibling.id).length).toBeGreaterThan(0);
    expect(listQueuedMessages(sibling.id)).toHaveLength(1);
    expect(countRows("memory_nodes", sibling.id)).toBe(1);
    expect(countRows("compaction_events", sibling.id)).toBe(1);
    expect(countRows("semantic_chunks", sibling.id)).toBe(1);
  });
});

describe("POST /api/bots/:botId/clear-context", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("returns 404 for an unknown bot", async () => {
    const user = await createLocalUser({ username: "clearmissing", password: "password-123", role: "user" as const });
    requireUserMock.mockResolvedValue(user);

    const { POST } = await import("@/app/api/bots/[botId]/clear-context/route");
    const response = await POST(new Request("http://localhost/", { method: "POST" }), buildContext("bot-missing"));

    expect(response.status).toBe(404);
  });

  it("stops queued runs, clears the bot thread, and broadcasts to subscribers", async () => {
    const manager = getConversationManager();
    const roomEvents: unknown[] = [];
    const allEvents: unknown[] = [];
    const originalBroadcast = manager.broadcast;
    const originalBroadcastAll = manager.broadcastAll;
    manager.broadcast = ((conversationId: string, event: unknown) => {
      roomEvents.push(event);
    }) as typeof originalBroadcast;
    manager.broadcastAll = ((event: unknown) => {
      allEvents.push(event);
    }) as typeof originalBroadcastAll;

    try {
      const user = await createLocalUser({
        username: "clearhappy",
        password: "password-123",
        role: "user" as const
      });
      const bot = createBot({ name: "Researcher" }, user.id);
      const { userMessage } = seedConversationContent(bot.homeConversationId, "a");
      await seedAttachments(bot.homeConversationId, userMessage.id);
      const queuedRun = createBotRunRecord({
        botId: bot.id,
        conversationId: bot.homeConversationId,
        triggerSource: "delegated"
      });
      requireUserMock.mockResolvedValue(user);

      const { POST } = await import("@/app/api/bots/[botId]/clear-context/route");
      const response = await POST(
        new Request("http://localhost/", { method: "POST" }),
        buildContext(bot.id)
      );
      const payload = (await response.json()) as {
        cleared?: boolean;
        bot?: { id: string; status: string; waitingForInput: boolean };
      };

      expect(response.ok).toBe(true);
      expect(payload.cleared).toBe(true);
      expect(payload.bot).toMatchObject({ id: bot.id, status: "idle", waitingForInput: false });

      expect(getBot(bot.id, user.id)).not.toBeNull();
      expect(getConversation(bot.homeConversationId)).not.toBeNull();
      expect(listMessages(bot.homeConversationId)).toHaveLength(0);
      expect(listQueuedMessages(bot.homeConversationId)).toHaveLength(0);
      expect(countRows("message_attachments", bot.homeConversationId)).toBe(0);

      const stoppedRun = getDb()
        .prepare("SELECT status FROM bot_runs WHERE id = ?")
        .get(queuedRun.id) as { status: string };
      expect(stoppedRun.status).toBe("stopped");

      expect(roomEvents).toContainEqual({
        type: "conversation_cleared",
        conversationId: bot.homeConversationId
      });
      expect(roomEvents).toContainEqual({
        type: "queue_updated",
        conversationId: bot.homeConversationId,
        queuedMessages: []
      });
      expect(roomEvents).toContainEqual({
        type: "conversation_activity",
        conversationId: bot.homeConversationId,
        isActive: false
      });
      expect(allEvents).toContainEqual({ type: "bot_updated", bot: payload.bot });
      expect(
        allEvents.some(
          (event) =>
            (event as { type?: string; run?: { id: string; status: string } }).type ===
              "bot_run_updated" &&
            (event as { run?: { id: string; status: string } }).run?.id === queuedRun.id &&
            (event as { run?: { status: string } }).run?.status === "stopped"
        )
      ).toBe(true);
    } finally {
      manager.broadcast = originalBroadcast;
      manager.broadcastAll = originalBroadcastAll;
    }
  });

  it("waits for an active turn to unwind before clearing", async () => {
    const user = await createLocalUser({
      username: "clearbusy",
      password: "password-123",
      role: "user" as const
    });
    const bot = createBot({ name: "Slow Bot" }, user.id);
    seedConversationContent(bot.homeConversationId, "a");
    requireUserMock.mockResolvedValue(user);

    const claimed = claimChatTurnStart(bot.homeConversationId);
    expect(claimed.ok).toBe(true);

    const { POST } = await import("@/app/api/bots/[botId]/clear-context/route");
    const responsePromise = POST(
      new Request("http://localhost/", { method: "POST" }),
      buildContext(bot.id)
    );

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(listMessages(bot.homeConversationId).length).toBeGreaterThan(0);

    releaseChatTurnStart(bot.homeConversationId, claimed.control);
    const response = await responsePromise;

    expect(response.ok).toBe(true);
    expect(listMessages(bot.homeConversationId)).toHaveLength(0);
  });

  it("returns 409 when the active turn does not unwind in time", async () => {
    vi.useFakeTimers();
    try {
      const user = await createLocalUser({
        username: "cleartimeout",
        password: "password-123",
        role: "user" as const
      });
      const bot = createBot({ name: "Stuck Bot" }, user.id);
      seedConversationContent(bot.homeConversationId, "a");
      requireUserMock.mockResolvedValue(user);

      const claimed = claimChatTurnStart(bot.homeConversationId);
      expect(claimed.ok).toBe(true);

      const { POST } = await import("@/app/api/bots/[botId]/clear-context/route");
      const responsePromise = POST(
        new Request("http://localhost/", { method: "POST" }),
        buildContext(bot.id)
      );
      await vi.advanceTimersByTimeAsync(8_500);
      const response = await responsePromise;

      expect(response.status).toBe(409);
      const payload = (await response.json()) as { error?: string };
      expect(payload.error).toContain("still finishing");
      expect(listMessages(bot.homeConversationId).length).toBeGreaterThan(0);

      releaseChatTurnStart(bot.homeConversationId, claimed.control);
    } finally {
      vi.useRealTimers();
    }
  });
});
