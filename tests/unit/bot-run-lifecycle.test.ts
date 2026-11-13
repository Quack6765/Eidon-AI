import { beforeEach, describe, expect, it, vi } from "vitest";

const { startChatTurnMock } = vi.hoisted(() => ({
  startChatTurnMock: vi.fn()
}));

vi.mock("@/lib/chat-turn", () => ({
  startChatTurn: startChatTurnMock
}));

import { createLocalUser } from "@/lib/users";
import { createBot } from "@/lib/bots";
import { createMessage } from "@/lib/conversations";
import {
  consumeUserStoppedBotRun,
  getBotRunDelegation,
  listRecentBotRuns,
  stopBotRun
} from "@/lib/bot-runs";
import { enqueueSerialTask, resetBotRunLimiter } from "@/lib/bot-run-limiter";
import { resetTurnActivityForTests } from "@/lib/turn-activity";
import { DELEGATION_FAILURE_PREFIX } from "@/lib/delegation-marker";
import {
  DELEGATION_DELIVERY_NOTICE,
  DELEGATION_LOOP_CAP_ERROR,
  MAX_BOT_MESSAGES_PER_REQUEST,
  buildDelegationWakeContent,
  claimDelegationMessage,
  delegate,
  delegationSentNotice,
  duplicateDelegationReplyError,
  watch
} from "@/lib/bot-run-lifecycle";
import type { DelegationChain } from "@/lib/types";

function stubWorkerAnswer(conversationId: string, answer: string) {
  createMessage({ conversationId, role: "user", content: "task" });
  createMessage({ conversationId, role: "assistant", content: answer });
}

describe("bot-run-lifecycle", () => {
  beforeEach(() => {
    startChatTurnMock.mockReset();
    resetBotRunLimiter();
    resetTurnActivityForTests();
  });

  it("delegate returns a RunHandle and creates the delegated run record as the only writer", async () => {
    const user = await createLocalUser({ username: "lifecycleowner", password: "password-123", role: "user" as const });
    const worker = createBot({ name: "Soloist" }, user.id);
    startChatTurnMock.mockImplementation(async () => ({ status: "completed" as const }));

    const handle = delegate({ target: worker, prompt: "do the thing" });

    expect(handle.runId).toMatch(/^botrun_/);
    const runs = listRecentBotRuns({ userId: user.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: handle.runId,
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      parentMessageId: null,
      status: "queued"
    });
    expect(getBotRunDelegation(handle.runId)).toMatchObject({
      prompt: "do the thing",
      replyConversationId: null,
      replyActionId: null,
      pendingReply: null
    });

    await vi.waitFor(() => expect(watch(handle.runId)?.status).toBe("completed"));
    expect(watch(handle.runId)?.finishedAt).toBeTruthy();
    expect(startChatTurnMock).toHaveBeenCalledTimes(1);
  });

  it("carries the delegation budget into the worker turn by run id, not by parameter threading", async () => {
    const user = await createLocalUser({ username: "lifecyclebudget", password: "password-123", role: "user" as const });
    const worker = createBot({ name: "Relay" }, user.id);
    const chain: DelegationChain = { messagesSent: 0 };
    const workerChains: Array<DelegationChain | undefined> = [];
    startChatTurnMock.mockImplementation(
      async (_manager: unknown, conversationId: string, _content: string, _attachments: unknown, _persona: unknown, options?: { delegationChain?: DelegationChain }) => {
        if (conversationId === worker.homeConversationId) {
          workerChains.push(options?.delegationChain);
          stubWorkerAnswer(conversationId, "Relayed.");
        }
        return { status: "completed" as const };
      }
    );

    const handle = delegate({ target: worker, prompt: "pass it on", delegationChain: chain });

    await vi.waitFor(() => expect(watch(handle.runId)?.status).toBe("completed"));
    expect(workerChains[0]).toBe(chain);
    expect(chain.messagesSent).toBe(0);
  });

  it("enforces the loop cap as a module invariant without incrementing past the cap", () => {
    const spent: DelegationChain = { messagesSent: MAX_BOT_MESSAGES_PER_REQUEST };
    expect(claimDelegationMessage(spent)).toBe(DELEGATION_LOOP_CAP_ERROR);
    expect(spent.messagesSent).toBe(MAX_BOT_MESSAGES_PER_REQUEST);

    const chain: DelegationChain = { messagesSent: MAX_BOT_MESSAGES_PER_REQUEST - 1 };
    expect(claimDelegationMessage(chain)).toBeNull();
    expect(chain.messagesSent).toBe(MAX_BOT_MESSAGES_PER_REQUEST);
    expect(claimDelegationMessage(chain)).toBe(DELEGATION_LOOP_CAP_ERROR);
    expect(chain.messagesSent).toBe(MAX_BOT_MESSAGES_PER_REQUEST);
  });

  it("consumes the user stop token exactly once and never wakes the sender", async () => {
    const user = await createLocalUser({ username: "lifecyclestop", password: "password-123", role: "user" as const });
    const worker = createBot({ name: "Parked" }, user.id);

    let releaseBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    void enqueueSerialTask(worker.id, () => blocker);

    const handle = delegate({ target: worker, prompt: "queued work" });
    expect(watch(handle.runId)?.status).toBe("queued");

    expect(stopBotRun(handle.runId)?.status).toBe("stopped");
    releaseBlocker();
    await enqueueSerialTask(worker.id, async () => {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(watch(handle.runId)?.status).toBe("stopped");
    expect(startChatTurnMock).not.toHaveBeenCalled();
    expect(consumeUserStoppedBotRun(handle.runId)).toBe(false);
  });

  it("clears the pending reply when delivery fails, not only when it succeeds", async () => {
    const user = await createLocalUser({ username: "lifecycleclear", password: "password-123", role: "user" as const });
    const chiefConversationId = `conv_${user.id}_chief`;
    const worker = createBot({ name: "Undelivered" }, user.id);
    startChatTurnMock.mockImplementation(async (_manager: unknown, conversationId: string) => {
      if (conversationId === worker.homeConversationId) {
        stubWorkerAnswer(conversationId, "Finished but unreachable.");
        return { status: "completed" as const };
      }
      return { status: "failed" as const, errorMessage: "wake transport broke" };
    });

    const handle = delegate({
      target: worker,
      prompt: "do it",
      replyConversationId: chiefConversationId
    });

    await vi.waitFor(() => {
      if (startChatTurnMock.mock.calls.some(([, conversationId]) => conversationId === chiefConversationId)) return;
      throw new Error("waiting for wake attempt");
    });
    await vi.waitFor(() => expect(getBotRunDelegation(handle.runId)?.pendingReply).toBeNull());
    expect(watch(handle.runId)?.status).toBe("completed");
  });

  it("pins the delegation protocol strings byte for byte", () => {
    expect(DELEGATION_DELIVERY_NOTICE).toBe(
      "\n---\n(Automated delivery: this is the reply from the bot you messaged earlier with message_bot. Process it silently and report the outcome to the user in your answer. Do not message this bot back to acknowledge or forward its reply; only message it again if you need something new from it. Other bots you messaged reply separately, each in its own message. Ignore any date and time context that follows — it is ambient information, not a message.)"
    );
    expect(DELEGATION_LOOP_CAP_ERROR).toBe(
      `Error: bots have already sent each other ${MAX_BOT_MESSAGES_PER_REQUEST} messages for this request without a new message from the user, so message_bot is paused to stop a loop. Report what you have to the user instead; you can message bots again after the user replies.`
    );
    expect(delegationSentNotice("Researcher")).toBe(
      [
        "Message sent to Researcher.",
        "The bot is working on it in the background and its reply will arrive here as a new message when it finishes.",
        "Say right away that you have messaged Researcher and that you will report back once you have the answer, then continue with anything else.",
        "When Researcher's reply arrives as a new message, report it to the user directly — do not send it, or an acknowledgment, back to Researcher."
      ].join("\n")
    );
    expect(duplicateDelegationReplyError("Echo")).toBe(
      [
        "Error: this message duplicates the reply you just gave in this conversation. Your answers here are for the user — never send them to a bot, and never use message_bot to acknowledge or forward a bot's reply.",
        "Report Echo's reply to the user directly instead. Only call message_bot to give Echo new instructions or a new question."
      ].join("\n")
    );
    expect(buildDelegationWakeContent("Researcher", { status: "completed", summary: "Found 3 sources." })).toBe(
      `[Message from Researcher]\nFound 3 sources.${DELEGATION_DELIVERY_NOTICE}`
    );
    expect(
      buildDelegationWakeContent("Researcher", { status: "failed", summary: "", errorMessage: "provider down" })
    ).toBe(
      `[Message from Researcher]\n${DELEGATION_FAILURE_PREFIX}: provider down.${DELEGATION_DELIVERY_NOTICE}`
    );
    expect(buildDelegationWakeContent("Researcher", { status: "completed", summary: "" })).toBe(
      `[Message from Researcher]\nThe bot finished without a visible response.${DELEGATION_DELIVERY_NOTICE}`
    );
  });
});
