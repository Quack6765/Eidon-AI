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
import {
  createBot,
  getBot,
  getBotStatus,
  listPendingBotApprovals,
  markBotPendingInputSeen,
  toBotSummary
} from "@/lib/bots";
import { listRecentBotRuns } from "@/lib/bot-runs";
import { createConversation } from "@/lib/conversations";
import { createConversationManager } from "@/lib/conversation-manager";
import { startChatTurn } from "@/lib/chat-turn";
import {
  UNATTENDED_TOOL_APPROVAL_TIMEOUT_MS,
  approveToolApproval,
  classifyShellCommand,
  requestToolExecutionApproval,
  type ToolApprovalGateOutcome
} from "@/lib/tool-approvals";
import { getTurnActivity } from "@/lib/turn-activity";
import { createProviderProfileInput } from "@/tests/provider-fixtures";
import { updateProviderCatalog } from "@/lib/settings";
import type { ToolApprovalContext } from "@/lib/types";
import type { RuntimeAction } from "@/lib/tool-executors";

type TurnInput = {
  toolApproval: ToolApprovalContext;
  abortSignal?: AbortSignal;
  onActionStart: (action: RuntimeAction) => string;
};

function setupProvider() {
  const profile = createProviderProfileInput({
    id: "profile_bot_approvals",
    name: "Bot Approvals",
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

function completedTurn() {
  return { answer: "Done.", thinking: "", usage: { outputTokens: 1 } };
}

function requestShellApproval(input: TurnInput, command: string) {
  const classification = classifyShellCommand(command);
  return requestToolExecutionApproval({
    payload: {
      operation: "tool_approval",
      scope: "shell",
      families: classification.families,
      classified: classification.classified,
      command
    },
    label: `Allow "${classification.families[0]}" commands?`,
    detail: command,
    userId: input.toolApproval.userId,
    unattended: input.toolApproval.unattended,
    timeoutMs: input.toolApproval.timeoutMs,
    onWaitChange: input.toolApproval.onWaitChange,
    abortSignal: input.abortSignal,
    onActionStart: input.onActionStart
  });
}

describe("bot tool approvals", () => {
  beforeEach(() => {
    resolveAssistantTurnMock.mockReset();
    setupProvider();
  });

  it("asks for approval in a bot DM, pauses the run, and resumes once the user allows it", async () => {
    const user = await createLocalUser({ username: "approvaldm", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Pusher" }, user.id);
    const observed: Record<string, unknown> = {};
    let outcome: ToolApprovalGateOutcome | null = null;

    resolveAssistantTurnMock.mockImplementation(async (input: TurnInput) => {
      observed.unattended = input.toolApproval.unattended;
      observed.timeoutMs = input.toolApproval.timeoutMs;
      const pending = requestShellApproval(input, "git push origin main");
      await vi.waitFor(() => {
        if (listPendingBotApprovals({ userId: user.id }).length === 0) throw new Error("no card yet");
      });
      const [approval] = listPendingBotApprovals({ userId: user.id });
      observed.approval = { botId: approval.botId, botName: approval.botName, conversationId: approval.conversationId };
      await vi.waitFor(() => {
        if (listRecentBotRuns({ userId: user.id })[0]?.status !== "waiting_approval") throw new Error("not paused");
      });
      const current = getBot(bot.id)!;
      observed.botStatus = getBotStatus(current);
      observed.stalledWhileWaiting = getTurnActivity(bot.homeConversationId)?.stalled;
      markBotPendingInputSeen(bot.id, user.id);
      observed.waitingForInputAfterSeen = toBotSummary(getBot(bot.id)!).waitingForInput;

      approveToolApproval(approval.action.id, undefined, user.id);
      outcome = await pending;
      observed.resumedStatus = listRecentBotRuns({ userId: user.id })[0].status;
      return completedTurn();
    });

    const result = await startChatTurn(createConversationManager(), bot.homeConversationId, "Push", []);

    expect(result.status).toBe("completed");
    expect(outcome).toEqual({ approved: true });
    expect(observed).toEqual({
      unattended: false,
      timeoutMs: undefined,
      approval: { botId: bot.id, botName: "Pusher", conversationId: bot.homeConversationId },
      botStatus: "waiting_approval",
      stalledWhileWaiting: false,
      waitingForInputAfterSeen: true,
      resumedStatus: "running"
    });
    expect(listRecentBotRuns({ userId: user.id })[0].status).toBe("completed");
    expect(listPendingBotApprovals({ userId: user.id })).toEqual([]);
    expect(toBotSummary(getBot(bot.id)!).waitingForInput).toBe(false);
  });

  it("gives unattended bot turns the long approval window and forwards wait changes to the caller", async () => {
    const user = await createLocalUser({ username: "approvalroutine", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Nightly" }, user.id);
    const waits: boolean[] = [];
    const observed: Record<string, unknown> = {};

    resolveAssistantTurnMock.mockImplementation(async (input: TurnInput) => {
      observed.unattended = input.toolApproval.unattended;
      observed.timeoutMs = input.toolApproval.timeoutMs;
      await input.toolApproval.onWaitChange?.(true);
      await input.toolApproval.onWaitChange?.(false);
      return completedTurn();
    });

    const result = await startChatTurn(createConversationManager(), bot.homeConversationId, "Run", [], undefined, {
      unattended: true,
      botRun: { record: false },
      onApprovalWait: (waiting) => {
        waits.push(waiting);
      }
    });

    expect(result.status).toBe("completed");
    expect(observed).toEqual({ unattended: false, timeoutMs: UNATTENDED_TOOL_APPROVAL_TIMEOUT_MS });
    expect(waits).toEqual([true, false]);
    expect(listRecentBotRuns({ userId: user.id })).toEqual([]);
  });

  it("keeps denying unattended tools outside bot conversations", async () => {
    const user = await createLocalUser({ username: "approvalplain", password: "password-123", role: "user" as const });
    const conversation = createConversation("Automation", null, {}, user.id);
    const observed: Record<string, unknown> = {};

    resolveAssistantTurnMock.mockImplementation(async (input: TurnInput) => {
      observed.unattended = input.toolApproval.unattended;
      observed.timeoutMs = input.toolApproval.timeoutMs;
      observed.outcome = await requestShellApproval(input, "git push");
      return completedTurn();
    });

    const result = await startChatTurn(createConversationManager(), conversation.id, "Run", [], undefined, {
      unattended: true
    });

    expect(result.status).toBe("completed");
    expect(observed.unattended).toBe(true);
    expect(observed.timeoutMs).toBeUndefined();
    expect(observed.outcome).toMatchObject({ approved: false });
    expect(String((observed.outcome as { message: string }).message)).toContain("Unattended runs");
  });

  it("scopes pending approvals to the owner and bot", async () => {
    const owner = await createLocalUser({ username: "approvalowner", password: "password-123", role: "user" as const });
    const other = await createLocalUser({ username: "approvalother", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Scoped" }, owner.id);
    const sibling = createBot({ name: "Sibling" }, owner.id);

    resolveAssistantTurnMock.mockImplementation(async (input: TurnInput) => {
      const pending = requestShellApproval(input, "rm -rf build");
      await vi.waitFor(() => {
        if (listPendingBotApprovals({ botId: bot.id }).length === 0) throw new Error("no card yet");
      });
      expect(listPendingBotApprovals({ userId: other.id })).toEqual([]);
      expect(listPendingBotApprovals({ userId: owner.id, botId: sibling.id })).toEqual([]);
      expect(listPendingBotApprovals()).toHaveLength(1);
      const [approval] = listPendingBotApprovals({ userId: owner.id, botId: bot.id });
      expect(approval.action).toMatchObject({ kind: "tool_approval", status: "pending", proposalState: "pending" });
      approveToolApproval(approval.action.id, undefined, owner.id);
      await pending;
      return completedTurn();
    });

    await startChatTurn(createConversationManager(), bot.homeConversationId, "Clean", []);
  });
});
