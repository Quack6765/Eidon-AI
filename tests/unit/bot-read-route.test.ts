import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMessage, createMessageAction } from "@/lib/conversations";
import { buildCreateMemoryProposal } from "@/lib/memory-proposals";
import { createBot, getBot } from "@/lib/bots";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

async function createPendingProposalInBotConversation(
  botConversationId: string,
  content: string
) {
  const message = createMessage({
    conversationId: botConversationId,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0
  });

  return createMessageAction({
    messageId: message.id,
    kind: "create_memory",
    status: "pending",
    label: "Create memory proposal",
    proposalState: "pending",
    proposalPayload: buildCreateMemoryProposal({
      content,
      category: "preference"
    })
  });
}

function buildContext(botId: string) {
  return { params: Promise.resolve({ botId }) };
}

describe("POST /api/bots/:botId/read", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("marks the bot read without clearing unresolved input, broadcasts, and returns the summary", async () => {
    const { getConversationManager } = await import("@/lib/ws-singleton");
    const { recordBotResult } = await import("@/lib/bots");
    const manager = getConversationManager();
    const events: unknown[] = [];
    const original = manager.broadcastAll;
    manager.broadcastAll = (event: Parameters<typeof original>[0], userId: string | null) => {
      if (event.type === "bot_updated") {
        events.push({ event, userId });
      }
    };

    try {
      const user = await createLocalUser({ username: "readbot", password: "password-123", role: "user" as const });
      const bot = createBot({ name: "Read Bot" }, user.id);
      await createPendingProposalInBotConversation(bot.homeConversationId, "Likes tea");
      recordBotResult(bot.id);
      requireUserMock.mockResolvedValue(user);

      const { POST } = await import("@/app/api/bots/[botId]/read/route");
      const response = await POST(new Request("http://localhost/", { method: "POST" }), buildContext(bot.id));
      const payload = (await response.json()) as { bot?: { waitingForInput: boolean; unread: boolean; id: string } };

      expect(response.ok).toBe(true);
      expect(payload.bot).toMatchObject({ id: bot.id, waitingForInput: true, unread: false });
      expect(getBot(bot.id, user.id)?.lastReadAt).toBeTruthy();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: { type: "bot_updated", bot: { id: bot.id, waitingForInput: true, unread: false } },
        userId: user.id
      });
    } finally {
      manager.broadcastAll = original;
    }
  });

  it("returns 404 for an unknown bot", async () => {
    const user = await createLocalUser({ username: "readmissing", password: "password-123", role: "user" as const });
    requireUserMock.mockResolvedValue(user);

    const { POST } = await import("@/app/api/bots/[botId]/read/route");
    const response = await POST(new Request("http://localhost/", { method: "POST" }), buildContext("bot-missing"));

    expect(response.status).toBe(404);
  });
});
