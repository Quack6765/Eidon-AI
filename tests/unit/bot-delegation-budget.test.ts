import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveAssistantTurnMock } = vi.hoisted(() => ({
  resolveAssistantTurnMock: vi.fn()
}));

vi.mock("@/lib/assistant-runtime", () => ({
  resolveAssistantTurn: resolveAssistantTurnMock
}));

vi.mock("@/lib/compaction", () => ({
  ensureCompactedContext: vi.fn().mockResolvedValue({
    promptMessages: [{ role: "user", content: "Hi" }],
    promptTokens: 16,
    compactionLimit: 8192,
    didCompact: false
  }),
  getConversationContextUsage: vi.fn().mockReturnValue(null)
}));

vi.mock("@/lib/conversation-title-generator", () => ({
  generateConversationTitle: vi.fn(),
  sanitizeGeneratedConversationTitle: vi.fn(),
  buildConversationTitlePrompt: vi.fn(),
  DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE: "Files",
  DEFAULT_CONVERSATION_TITLE: "Conversation",
  MAX_CONVERSATION_TITLE_LENGTH: 48
}));

import { createLocalUser } from "@/lib/users";
import { createBot } from "@/lib/bots";
import { listRecentBotRuns } from "@/lib/bot-runs";
import { MAX_BOT_MESSAGES_PER_REQUEST, executeMessageBot } from "@/lib/bot-delegation";
import { createConversationManager } from "@/lib/conversation-manager";
import { startChatTurn } from "@/lib/chat-turn";
import { createProviderProfileInput } from "@/tests/provider-fixtures";
import { updateProviderCatalog } from "@/lib/settings";
import type { DelegationChain, PromptMessage } from "@/lib/types";

type TurnInput = Parameters<typeof executeMessageBot>[2]["input"];

function setupProvider() {
  const profile = createProviderProfileInput({
    id: "profile_delegation_depth",
    name: "Delegation Depth",
    model: "gpt-test",
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    modelContextLimit: 16384,
    freshTailCount: 12,
    visionMode: "none",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  updateProviderCatalog({
    defaultProviderProfileId: profile.id,
    skillsEnabled: false,
    providerProfiles: [profile]
  });
}

describe("bot delegation budget", () => {
  beforeEach(() => {
    resolveAssistantTurnMock.mockReset();
    setupProvider();
  });

  it("hands the turn's message budget to message_bot, which refuses once it is spent", async () => {
    const user = await createLocalUser({ username: "budgetwiring", password: "password-123", role: "user" as const });
    const sender = createBot({ name: "Ping" }, user.id);
    createBot({ name: "Pong" }, user.id);
    const replies: string[] = [];

    resolveAssistantTurnMock.mockResolvedValue({ answer: "Done.", thinking: "", usage: { outputTokens: 1 } });
    resolveAssistantTurnMock.mockImplementationOnce(async (input: TurnInput) => {
      const result = await executeMessageBot("call_pong", { bot: "Pong", message: "your turn" }, {
        input,
        timelineSortOrder: 0,
        promptMessages: [] as PromptMessage[]
      });
      replies.push(String(result.promptMessages.at(-1)?.content));
      return { answer: "Done.", thinking: "", usage: { outputTokens: 1 } };
    });

    const spentChain: DelegationChain = { messagesSent: MAX_BOT_MESSAGES_PER_REQUEST };
    const turn = await startChatTurn(createConversationManager(), sender.homeConversationId, "Keep going", [], undefined, {
      botRun: { record: false },
      unattended: true,
      delegationChain: spentChain
    });

    expect(turn.status).toBe("completed");
    expect(resolveAssistantTurnMock.mock.calls[0][0].delegationChain).toBe(spentChain);
    expect(replies[0]).toContain(`already sent each other ${MAX_BOT_MESSAGES_PER_REQUEST} messages`);
    expect(spentChain.messagesSent).toBe(MAX_BOT_MESSAGES_PER_REQUEST);
    expect(listRecentBotRuns({ userId: user.id })).toEqual([]);

    const userTurn = await startChatTurn(createConversationManager(), sender.homeConversationId, "New request", [], undefined, {
      botRun: { record: false }
    });

    expect(userTurn.status).toBe("completed");
    expect(resolveAssistantTurnMock.mock.calls[1][0].delegationChain).toEqual({ messagesSent: 0 });
  });
});
