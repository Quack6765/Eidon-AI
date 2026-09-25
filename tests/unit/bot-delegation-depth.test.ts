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
import { MAX_DELEGATION_DEPTH, executeMessageBot } from "@/lib/bot-delegation";
import { createConversationManager } from "@/lib/conversation-manager";
import { startChatTurn } from "@/lib/chat-turn";
import { createProviderProfileInput } from "@/tests/provider-fixtures";
import { updateProviderCatalog } from "@/lib/settings";
import type { PromptMessage } from "@/lib/types";

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

describe("bot delegation depth", () => {
  beforeEach(() => {
    resolveAssistantTurnMock.mockReset();
    setupProvider();
  });

  it("hands the turn's delegation depth to message_bot, which refuses once the limit is reached", async () => {
    const user = await createLocalUser({ username: "depthwiring", password: "password-123", role: "user" as const });
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

    const turn = await startChatTurn(createConversationManager(), sender.homeConversationId, "Keep going", [], undefined, {
      botRun: { record: false },
      unattended: true,
      delegationDepth: MAX_DELEGATION_DEPTH
    });

    expect(turn.status).toBe("completed");
    expect(resolveAssistantTurnMock.mock.calls[0][0]).toMatchObject({ delegationDepth: MAX_DELEGATION_DEPTH });
    expect(replies[0]).toContain(`between bots ${MAX_DELEGATION_DEPTH} times`);
    expect(listRecentBotRuns({ userId: user.id })).toEqual([]);
  });
});
