import { beforeEach, describe, expect, it, vi } from "vitest";

const { startChatTurnMock } = vi.hoisted(() => ({
  startChatTurnMock: vi.fn()
}));

vi.mock("@/lib/chat-turn", () => ({
  startChatTurn: startChatTurnMock
}));

import {
  attachConversationToRun,
  createAutomation,
  createAutomationRun,
  getAutomationRun,
  updateAutomationRunStatus
} from "@/lib/automations";
import { createBot, ensureChiefBot } from "@/lib/bots";
import {
  createBotRunRecord,
  getBotRun,
  getBotRunDelegation,
  setBotRunPendingReply,
  updateBotRunStatus
} from "@/lib/bot-runs";
import { resetBotRunLimiter } from "@/lib/bot-run-limiter";
import {
  createConversation,
  createMessage,
  createMessageAction,
  createMessageTextSegment,
  getConversation,
  getMessage
} from "@/lib/conversations";
import { RESTART_RESUME_NOTICE_HEADER } from "@/lib/constants";
import { getDb } from "@/lib/db";
import {
  MAX_CONSECUTIVE_RESTART_RESUMES,
  buildRestartResumeNotice,
  reconcileInterruptedRuntimeState,
  resumeInterruptedWork
} from "@/lib/interrupted-work";
import { resetRuntimeBootstrapForTests } from "@/lib/runtime-bootstrap";
import { resetTurnActivityForTests } from "@/lib/turn-activity";
import { createLocalUser } from "@/lib/users";

type TurnOptions = { unattended?: boolean; botRun?: { record?: false }; onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void };

function answerTurns(answers: Record<string, string> = {}) {
  const calls: Array<{ conversationId: string; content: string; options: TurnOptions }> = [];
  startChatTurnMock.mockImplementation(
    async (_manager: unknown, conversationId: string, content: string, _attachments: string[], _persona: unknown, options: TurnOptions) => {
      if (!getConversation(conversationId)) {
        return { status: "skipped" as const, errorMessage: "Conversation not found" };
      }
      calls.push({ conversationId, content, options });
      const userMessage = createMessage({ conversationId, role: "user", content });
      options?.onMessagesCreated?.({ userMessageId: userMessage.id, assistantMessageId: "msg_assistant" });
      createMessage({ conversationId, role: "assistant", content: answers[conversationId] ?? "Done." });
      return { status: "completed" as const };
    }
  );
  return calls;
}

async function createOwner(username: string) {
  return createLocalUser({ username, password: "password-123", role: "user" as const });
}

function readMessage(messageId: string) {
  return getDb().prepare("SELECT status, content FROM messages WHERE id = ?").get(messageId) as {
    status: string;
    content: string;
  };
}

function readAction(actionId: string) {
  return getDb().prepare("SELECT status, result_summary FROM message_actions WHERE id = ?").get(actionId) as {
    status: string;
    result_summary: string;
  };
}

describe("interrupted work", () => {
  beforeEach(() => {
    startChatTurnMock.mockReset();
    resetBotRunLimiter();
    resetTurnActivityForTests();
    resetRuntimeBootstrapForTests();
  });

  it("keeps interrupted progress and plans resumes for the work it cannot hand to an owner", async () => {
    const owner = await createOwner("reconcile-owner");
    const chat = createConversation("Chat", null, {}, owner.id);
    createMessage({ conversationId: chat.id, role: "user", content: "Summarize the repo" });
    const partial = createMessage({ conversationId: chat.id, role: "assistant", status: "streaming" });
    createMessageTextSegment({ messageId: partial.id, content: "Looking at ", sortOrder: 0 });
    createMessageTextSegment({ messageId: partial.id, content: "the files.", sortOrder: 2 });
    const runningStep = createMessageAction({
      messageId: partial.id,
      kind: "shell_command",
      label: "Ran ls",
      detail: "ls -la",
      status: "running",
      sortOrder: 1
    });

    const emptyChat = createConversation("Empty", null, {}, owner.id);
    createMessage({ conversationId: emptyChat.id, role: "user", content: "Hello?" });
    const placeholder = createMessage({ conversationId: emptyChat.id, role: "assistant", status: "streaming" });

    const chief = ensureChiefBot(owner.id);
    const chiefMessage = createMessage({ conversationId: chief.homeConversationId, role: "assistant", content: "Asking" });
    const senderAction = createMessageAction({
      messageId: chiefMessage.id,
      kind: "message_bot",
      label: "Messaged Researcher",
      status: "pending"
    });
    const legacyAction = createMessageAction({
      messageId: chiefMessage.id,
      kind: "message_bot",
      label: "Messaged Researcher",
      status: "pending"
    });
    const worker = createBot({ name: "Researcher" }, owner.id);
    const workerTurn = createMessage({ conversationId: worker.homeConversationId, role: "assistant", status: "streaming" });
    createMessageTextSegment({ messageId: workerTurn.id, content: "Searching", sortOrder: 0 });
    const startedRun = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      prompt: "[Message from Chief of Staff]\nfind sources",
      replyConversationId: chief.homeConversationId,
      replyActionId: senderAction.id
    });
    updateBotRunStatus(startedRun.id, { status: "waiting_user", startedAt: "2026-09-25T10:00:00.000Z" });
    const queuedRun = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      prompt: "second task"
    });
    const dmRun = createBotRunRecord({ botId: worker.id, conversationId: worker.homeConversationId, triggerSource: "dm" });
    updateBotRunStatus(dmRun.id, { status: "running", startedAt: "2026-09-25T10:00:00.000Z" });

    const automation = createAutomation({
      name: "Nightly",
      prompt: "Run",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 60,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });
    const automationConversation = createConversation("Nightly", null, {}, owner.id);
    createMessage({ conversationId: automationConversation.id, role: "assistant", status: "streaming", content: "" });
    const automationRun = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-09-25T10:00:00.000Z",
      triggerSource: "schedule"
    });
    attachConversationToRun(automationRun.id, automationConversation.id);
    updateAutomationRunStatus(automationRun.id, { status: "running", startedAt: "2026-09-25T10:00:00.000Z" });

    const recovered = reconcileInterruptedRuntimeState(getDb());

    expect(readMessage(partial.id)).toEqual({ status: "stopped", content: "Looking at the files." });
    expect(readMessage(placeholder.id).status).toBe("error");
    expect(readAction(runningStep.id)).toEqual({ status: "error", result_summary: "Interrupted by a server restart" });
    expect(getBotRun(startedRun.id)?.status).toBe("queued");
    expect(getBotRun(queuedRun.id)?.status).toBe("queued");
    expect(getBotRun(dmRun.id)).toMatchObject({ status: "stopped", errorMessage: "Interrupted by a server restart" });
    expect(readAction(senderAction.id).status).toBe("pending");
    expect(readAction(legacyAction.id).status).toBe("error");
    expect(getAutomationRun(automationRun.id)).toMatchObject({
      status: "queued",
      conversationId: automationConversation.id
    });
    expect(recovered).toMatchObject({ messages: 4, automationRuns: 1, delegatedRuns: 1, botRuns: 1, delegationActions: 1 });
    expect(recovered.conversationIds.sort()).toEqual([chat.id, emptyChat.id].sort());
  });

  it("treats runs an older build saved as waiting_approval like waiting_user runs", async () => {
    const owner = await createOwner("legacy-wait-owner");
    const worker = createBot({ name: "Researcher" }, owner.id);
    const delegatedRun = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      prompt: "[Message from Chief of Staff]\nfind sources"
    });
    const dmRun = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "dm"
    });
    getDb()
      .prepare("UPDATE bot_runs SET status = 'waiting_approval' WHERE id IN (?, ?)")
      .run(delegatedRun.id, dmRun.id);

    reconcileInterruptedRuntimeState(getDb());

    expect(getBotRun(delegatedRun.id)?.status).toBe("queued");
    expect(getBotRun(dmRun.id)?.status).toBe("stopped");
  });

  it("describes what was cut off, restates a task, and refuses to resume a crash loop", async () => {
    const owner = await createOwner("notice-owner");
    const chat = createConversation("Chat", null, {}, owner.id);
    createMessage({ conversationId: chat.id, role: "user", content: "Deploy it" });
    const partial = createMessage({ conversationId: chat.id, role: "assistant", status: "streaming" });
    createMessageAction({
      messageId: partial.id,
      kind: "shell_command",
      label: "Ran git",
      detail: "git push origin main",
      status: "running"
    });
    createMessageAction({
      messageId: partial.id,
      kind: "tool_approval",
      label: "Allow \"rm\" commands?",
      detail: "rm -rf build",
      status: "pending",
      proposalState: "pending",
      proposalPayload: { operation: "tool_approval", scope: "shell", families: ["rm"], classified: true, command: "rm -rf build" }
    });
    reconcileInterruptedRuntimeState(getDb());

    const notice = buildRestartResumeNotice(chat.id, "Ship the release");
    expect(notice?.startsWith(RESTART_RESUME_NOTICE_HEADER)).toBe(true);
    expect(notice).toContain("- Ran git: git push origin main");
    expect(notice).toContain("check their result before repeating them");
    expect(notice).toContain("- Allow \"rm\" commands?: rm -rf build");
    expect(notice).toContain("ask again if you still need them");
    expect(notice).toContain("The task you were working on:\nShip the release");
    expect(notice).toContain("the user did not write this message");

    const quiet = createConversation("Quiet", null, {}, owner.id);
    expect(buildRestartResumeNotice(quiet.id)).not.toContain("still running");

    for (let index = 0; index < MAX_CONSECUTIVE_RESTART_RESUMES; index += 1) {
      createMessage({ conversationId: chat.id, role: "user", content: notice ?? "" });
    }
    expect(buildRestartResumeNotice(chat.id)).toBeNull();
  });

  it("stops a pending browser hand-off on restart and tells the resumed bot to check the page", async () => {
    const owner = await createOwner("handoff-restart-owner");
    const bot = createBot({ name: "Shopper" }, owner.id);
    const partial = createMessage({ conversationId: bot.homeConversationId, role: "assistant", status: "streaming" });
    const handoff = createMessageAction({
      messageId: partial.id,
      kind: "computer_handoff",
      label: "Your turn in the browser",
      detail: "Enter the SMS code",
      status: "pending",
      proposalState: "pending",
      proposalPayload: { operation: "computer_handoff", reason: "Enter the SMS code" }
    });

    createMessageAction({
      messageId: partial.id,
      kind: "secret_request",
      label: "Enter your password",
      detail: "https://example.com",
      status: "pending",
      proposalState: "pending",
      proposalPayload: { operation: "secret_request", label: "password", origin: "https://example.com", target: "@e5", save: false }
    });

    const { computerHandoffs, secretRequests } = reconcileInterruptedRuntimeState(getDb());

    expect(computerHandoffs).toBe(1);
    expect(secretRequests).toBe(1);
    const row = getDb()
      .prepare("SELECT status, proposal_state, proposal_payload_json FROM message_actions WHERE id = ?")
      .get(handoff.id) as { status: string; proposal_state: string; proposal_payload_json: string };
    expect(row.status).toBe("completed");
    expect(row.proposal_state).toBe("dismissed");
    expect(JSON.parse(row.proposal_payload_json).resolution).toBe("stopped");
    const notice = buildRestartResumeNotice(bot.homeConversationId);
    expect(notice).toContain("requests for the user to take over your browser were cancelled");
    expect(notice).toContain("- Your turn in the browser: Enter the SMS code");
    expect(notice).toContain("requests for a secret were cancelled");
    expect(notice).toContain("- Enter your password: https://example.com");
  });

  it("resumes interrupted conversations with a notice, unattended only for bots", async () => {
    const owner = await createOwner("resume-owner");
    const chat = createConversation("Chat", null, {}, owner.id);
    createMessage({ conversationId: chat.id, role: "user", content: "Write a plan" });
    const partial = createMessage({ conversationId: chat.id, role: "assistant", status: "streaming" });
    createMessageTextSegment({ messageId: partial.id, content: "Step one", sortOrder: 0 });
    const bot = createBot({ name: "Planner" }, owner.id);
    createMessage({ conversationId: bot.homeConversationId, role: "user", content: "Plan my week" });
    createMessage({ conversationId: bot.homeConversationId, role: "assistant", status: "streaming", content: "" });
    const looping = createConversation("Looping", null, {}, owner.id);
    for (let index = 0; index < MAX_CONSECUTIVE_RESTART_RESUMES; index += 1) {
      createMessage({ conversationId: looping.id, role: "user", content: `${RESTART_RESUME_NOTICE_HEADER}\nContinue` });
    }
    createMessage({ conversationId: looping.id, role: "assistant", status: "streaming", content: "" });
    const calls = answerTurns();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { conversationIds } = reconcileInterruptedRuntimeState(getDb());
    expect(conversationIds.sort()).toEqual([chat.id, bot.homeConversationId, looping.id].sort());
    await resumeInterruptedWork([chat.id, looping.id]);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await resumeInterruptedWork([bot.homeConversationId]);
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    const chatResume = calls.find((call) => call.conversationId === chat.id);
    const botResume = calls.find((call) => call.conversationId === bot.homeConversationId);
    expect(chatResume?.content.startsWith(RESTART_RESUME_NOTICE_HEADER)).toBe(true);
    expect(chatResume?.options.unattended).toBe(false);
    expect(botResume?.options.unattended).toBe(true);
    expect(botResume?.options.botRun).toBeUndefined();
    expect(calls.some((call) => call.conversationId === looping.id)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(looping.id));
    warn.mockRestore();
  });

  it("resumes a delegated run cut off mid-task and delivers its reply to the sender", async () => {
    const owner = await createOwner("delegation-resume-owner");
    const chief = ensureChiefBot(owner.id);
    const chiefMessage = createMessage({ conversationId: chief.homeConversationId, role: "assistant", content: "Asking" });
    const senderAction = createMessageAction({ messageId: chiefMessage.id, kind: "message_bot", label: "Messaged", status: "pending" });
    const worker = createBot({ name: "Researcher" }, owner.id);
    createMessage({ conversationId: worker.homeConversationId, role: "user", content: "[Message from Chief of Staff]\nfind sources" });
    createMessage({ conversationId: worker.homeConversationId, role: "assistant", status: "streaming", content: "" });
    const run = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      prompt: "[Message from Chief of Staff]\nfind sources",
      replyConversationId: chief.homeConversationId,
      replyActionId: senderAction.id
    });
    updateBotRunStatus(run.id, { status: "waiting_user", startedAt: "2026-09-25T10:00:00.000Z" });
    const calls = answerTurns({ [worker.homeConversationId]: "Found 3 sources." });

    const { conversationIds } = reconcileInterruptedRuntimeState(getDb());
    expect(conversationIds).toEqual([]);
    expect(readAction(senderAction.id).status).toBe("pending");
    await resumeInterruptedWork(conversationIds);
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 5_000 });

    expect(calls[0].conversationId).toBe(worker.homeConversationId);
    expect(calls[0].content.startsWith(RESTART_RESUME_NOTICE_HEADER)).toBe(true);
    expect(calls[0].content).toContain("The task you were working on:\n[Message from Chief of Staff]\nfind sources");
    expect(calls[1].conversationId).toBe(chief.homeConversationId);
    expect(calls[1].content).toContain("[Message from Researcher]\nFound 3 sources.");
    expect(getBotRun(run.id)?.status).toBe("completed");
    expect(readAction(senderAction.id)).toEqual({ status: "completed", result_summary: "Found 3 sources." });
    expect(getBotRunDelegation(run.id)?.pendingReply).toBeNull();
  });

  it("starts a delegated run that was still queued with its original task", async () => {
    const owner = await createOwner("delegation-queued-owner");
    const chief = ensureChiefBot(owner.id);
    const worker = createBot({ name: "Summarizer" }, owner.id);
    const run = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      prompt: "[Message from Chief of Staff]\nsummarize them",
      replyConversationId: chief.homeConversationId
    });
    const calls = answerTurns({ [worker.homeConversationId]: "Summary ready." });

    reconcileInterruptedRuntimeState(getDb());
    await resumeInterruptedWork([]);
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 5_000 });

    expect(calls[0]).toMatchObject({
      conversationId: worker.homeConversationId,
      content: "[Message from Chief of Staff]\nsummarize them"
    });
    expect(calls[1].content).toContain("[Message from Summarizer]\nSummary ready.");
    expect(getBotRun(run.id)?.status).toBe("completed");
  });

  it("fails a delegated run caught in a restart loop and tells the sender", async () => {
    const owner = await createOwner("delegation-loop-owner");
    const chief = ensureChiefBot(owner.id);
    const worker = createBot({ name: "Crasher" }, owner.id);
    for (let index = 0; index < MAX_CONSECUTIVE_RESTART_RESUMES; index += 1) {
      createMessage({ conversationId: worker.homeConversationId, role: "user", content: `${RESTART_RESUME_NOTICE_HEADER}\nContinue` });
    }
    const run = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      prompt: "crash again",
      replyConversationId: chief.homeConversationId
    });
    updateBotRunStatus(run.id, { status: "running", startedAt: "2026-09-25T10:00:00.000Z" });
    const calls = answerTurns();

    const { conversationIds } = reconcileInterruptedRuntimeState(getDb());
    await resumeInterruptedWork(conversationIds);
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0].conversationId).toBe(chief.homeConversationId);
    expect(calls[0].content).toContain("The task failed: Crasher was interrupted by repeated server restarts.");
    expect(getBotRun(run.id)).toMatchObject({ status: "failed" });
  });

  it("redelivers a reply that was waiting when the server stopped", async () => {
    const owner = await createOwner("redelivery-owner");
    const chief = ensureChiefBot(owner.id);
    const worker = createBot({ name: "Writer" }, owner.id);
    const run = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      prompt: "draft it",
      replyConversationId: chief.homeConversationId
    });
    updateBotRunStatus(run.id, { status: "completed", finishedAt: "2026-09-25T10:00:00.000Z" });
    setBotRunPendingReply(run.id, "[Message from Writer]\nDraft attached.");
    const calls = answerTurns();

    await resumeInterruptedWork([]);
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0]).toMatchObject({ conversationId: chief.homeConversationId, content: "[Message from Writer]\nDraft attached." });
    expect(getBotRunDelegation(run.id)?.pendingReply).toBeNull();
  });

  it("drops a waiting reply whose recipient no longer exists", async () => {
    const owner = await createOwner("orphan-owner");
    const worker = createBot({ name: "Writer" }, owner.id);
    const run = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      prompt: "lost",
      replyConversationId: "conv_deleted"
    });
    updateBotRunStatus(run.id, { status: "completed", finishedAt: "2026-09-25T10:00:00.000Z" });
    setBotRunPendingReply(run.id, "[Message from Writer]\nNobody is listening.");
    const calls = answerTurns();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await resumeInterruptedWork([]);
    await vi.waitFor(() => expect(getBotRunDelegation(run.id)?.pendingReply).toBeNull());

    expect(calls).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("could not be delivered: Conversation not found"));
    error.mockRestore();
  });

  it("resumes only after a bootstrap, and only once", async () => {
    const runtimeBootstrap = await import("@/lib/runtime-bootstrap");
    const owner = await createOwner("bootstrap-resume-owner");
    const chat = createConversation("Chat", null, {}, owner.id);
    createMessage({ conversationId: chat.id, role: "user", content: "Keep going" });
    createMessage({ conversationId: chat.id, role: "assistant", status: "streaming", content: "" });
    const calls = answerTurns();

    await expect(runtimeBootstrap.resumeRuntimeWork()).resolves.toBe(false);
    runtimeBootstrap.bootstrapRuntimeState();
    await expect(runtimeBootstrap.resumeRuntimeWork()).resolves.toBe(true);
    await expect(runtimeBootstrap.resumeRuntimeWork()).resolves.toBe(false);
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0].conversationId).toBe(chat.id);
    const persisted = getDb()
      .prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY rowid DESC LIMIT 1")
      .get(chat.id) as { id: string };
    expect(getMessage(persisted.id)?.content.startsWith(RESTART_RESUME_NOTICE_HEADER)).toBe(true);
  });
});
