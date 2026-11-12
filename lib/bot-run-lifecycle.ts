import { appendDeliveredFileLinks } from "@/lib/assistant-local-attachments";
import { getMessage, listMessages, updateMessageAction } from "@/lib/conversations";
import { requestStop, waitForChatTurnRelease } from "@/lib/chat-turn-control";
import { truncateText, MAX_RUNTIME_TOOL_RESULT_CHARS } from "@/lib/bounded-text";
import { DELEGATION_FAILURE_PREFIX } from "@/lib/delegation-marker";
import { getBot, getBotByConversationId } from "@/lib/bots";
import {
  broadcastBotRunUpdate,
  broadcastBotUpsert,
  consumeUserStoppedBotRun,
  createBotRunRecord,
  deleteBotRun,
  getBotRun,
  getBotRunDelegation,
  isBotRunStopped,
  listBotRunIdsWithPendingReply,
  listResumableDelegatedBotRunIds,
  setBotRunPendingReply,
  setBotRunWaitingForUser,
  updateBotRunStatus,
  type BotRunDelegation
} from "@/lib/bot-runs";
import { getDb } from "@/lib/db";
import { buildRestartResumeNotice } from "@/lib/interrupted-work";
import { createPausableTimeout } from "@/lib/pausable-timeout";
import { formatDurationSeconds, nowIso } from "@/lib/utils";
import { DELEGATED_TURN_STALL_STOP_MS, consumeStallStop, setTurnStallStop } from "@/lib/turn-activity";
import {
  DEFAULT_BOT_RUN_TIMEOUT_MS,
  acquireBotUserSlot,
  enqueueSerialTask,
  releaseBotUserSlot
} from "@/lib/bot-run-limiter";
import { getConversationManager } from "@/lib/ws-singleton";
import type { ChatTurnResult, StartChatTurn } from "@/lib/chat-turn";
import type { Bot, BotRun, BotRunTriggerSource, ChatResearchOptions, DelegationChain } from "@/lib/types";

class BotRunDeadlineError extends Error {
  constructor() {
    super("Bot run exceeded its execution deadline");
    this.name = "BotRunDeadlineError";
  }
}

export function getLatestAssistantSummary(conversationId: string) {
  const messages = listMessages(conversationId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const content = message.content.trim();
    if (content || message.attachments?.some((attachment) => attachment.sourcePath)) {
      return appendDeliveredFileLinks(truncateText(content, MAX_RUNTIME_TOOL_RESULT_CHARS), message.attachments);
    }
  }
  return "";
}

function mapTurnStatusToRunStatus(status: string): BotRun["status"] {
  if (status === "completed") return "completed";
  if (status === "stopped") return "stopped";
  return "failed";
}

export type DelegationOutcome = { status: string; summary: string; errorMessage?: string };

const WAKE_MAX_WAIT_MS = 30 * 60_000;
const TURN_RELEASE_WAIT_FALLBACK_MS = 5_000;
export const MAX_BOT_MESSAGES_PER_REQUEST = 10;

export const DELEGATION_DELIVERY_NOTICE =
  "\n---\n(Automated delivery: this is the reply from the bot you messaged earlier with message_bot. Process it silently and report the outcome to the user in your answer. Do not message this bot back to acknowledge or forward its reply; only message it again if you need something new from it. Other bots you messaged reply separately, each in its own message. Ignore any date and time context that follows — it is ambient information, not a message.)";

export const DELEGATION_LOOP_CAP_ERROR = `Error: bots have already sent each other ${MAX_BOT_MESSAGES_PER_REQUEST} messages for this request without a new message from the user, so message_bot is paused to stop a loop. Report what you have to the user instead; you can message bots again after the user replies.`;

export function delegatedMessageEnvelope(senderName: string, body: string) {
  return `[Message from ${senderName}]\n${body}`;
}

export function duplicateDelegationReplyError(botName: string) {
  return [
    `Error: this message duplicates the reply you just gave in this conversation. Your answers here are for the user — never send them to a bot, and never use message_bot to acknowledge or forward a bot's reply.`,
    `Report ${botName}'s reply to the user directly instead. Only call message_bot to give ${botName} new instructions or a new question.`
  ].join("\n");
}

export function delegationSentNotice(botName: string) {
  return [
    `Message sent to ${botName}.`,
    "The bot is working on it in the background and its reply will arrive here as a new message when it finishes.",
    `Say right away that you have messaged ${botName} and that you will report back once you have the answer, then continue with anything else.`,
    `When ${botName}'s reply arrives as a new message, report it to the user directly — do not send it, or an acknowledgment, back to ${botName}.`
  ].join("\n");
}

export function buildDelegationWakeContent(botName: string, outcome: DelegationOutcome) {
  if (outcome.status === "failed") {
    return delegatedMessageEnvelope(
      botName,
      `${DELEGATION_FAILURE_PREFIX}${outcome.errorMessage ? `: ${outcome.errorMessage}` : ""}.${DELEGATION_DELIVERY_NOTICE}`
    );
  }
  return delegatedMessageEnvelope(
    botName,
    `${outcome.summary || "The bot finished without a visible response."}${DELEGATION_DELIVERY_NOTICE}`
  );
}

export function claimDelegationMessage(chain: DelegationChain): string | null {
  if (chain.messagesSent >= MAX_BOT_MESSAGES_PER_REQUEST) return DELEGATION_LOOP_CAP_ERROR;
  chain.messagesSent += 1;
  return null;
}

const DELEGATION_RUN_CHAINS_KEY = Symbol.for("eidon:delegation-run-chains");

function getDelegationRunChains(): Map<string, DelegationChain> {
  const registry = globalThis as Record<symbol, Map<string, DelegationChain> | undefined>;
  registry[DELEGATION_RUN_CHAINS_KEY] ??= new Map<string, DelegationChain>();
  return registry[DELEGATION_RUN_CHAINS_KEY];
}

function delegationRunChain(runId: string) {
  return getDelegationRunChains().get(runId);
}

export type RunHandle = { runId: string };

export function delegate(input: {
  target: Bot;
  prompt: string;
  parentMessageId?: string | null;
  replyConversationId?: string | null;
  replyActionId?: string | null;
  delegationChain?: DelegationChain;
}): RunHandle {
  const run = createBotRunRecord({
    botId: input.target.id,
    conversationId: input.target.homeConversationId,
    triggerSource: "delegated",
    parentMessageId: input.parentMessageId ?? null,
    prompt: input.prompt,
    replyConversationId: input.replyConversationId ?? null,
    replyActionId: input.replyActionId ?? null
  });
  broadcastBotRunUpdate(run);
  if (input.delegationChain) getDelegationRunChains().set(run.id, input.delegationChain);

  void runDelegation(run.id).catch((error: unknown) => {
    console.error("[bot-delegation] async settlement failed", error);
  });

  return { runId: run.id };
}

export function watch(runId: string): BotRun | null {
  return getBotRun(runId);
}

export function openBotRun(input: {
  botId: string;
  conversationId: string;
  triggerSource: BotRunTriggerSource;
}): BotRun {
  const run = createBotRunRecord(input);
  const running = updateBotRunStatus(run.id, { status: "running", startedAt: nowIso() });
  if (running) broadcastBotRunUpdate(running);
  return running ?? run;
}

export function settleBotRun(input: { runId: string; result: ChatTurnResult; bot: Bot | null }) {
  const { runId, result, bot } = input;
  if (result.status === "skipped") {
    deleteBotRun(runId);
    if (bot) broadcastBotUpsert(bot);
    return;
  }
  const finished = updateBotRunStatus(runId, {
    status: result.status,
    finishedAt: nowIso(),
    errorMessage: result.status === "failed" ? result.errorMessage ?? "Bot run failed" : null
  });
  if (finished) broadcastBotRunUpdate(finished);
}

function createBotUserSlotLease(ownerUserId: string) {
  let held = false;
  return {
    async acquire(timeoutMs: number) {
      if (!held) held = await acquireBotUserSlot(ownerUserId, timeoutMs);
      return held;
    },
    release() {
      if (!held) return;
      held = false;
      releaseBotUserSlot(ownerUserId);
    }
  };
}

function isBusyTurnFailure(result: ChatTurnResult) {
  return result.status === "failed" && /already has an active/i.test(result.errorMessage ?? "");
}

function broadcastPersistedUserMessage(conversationId: string, userMessageId: string, ownerUserId?: string | null) {
  const userMessage = getMessage(userMessageId, ownerUserId ?? undefined);
  if (!userMessage) return;
  getConversationManager().broadcast(conversationId, {
    type: "user_message_persisted",
    conversationId,
    message: userMessage
  });
}

async function startTurnWhenIdle(input: {
  conversationId: string;
  content: string;
  ownerUserId?: string | null;
  maxWaitMs: number;
  busyErrorMessage: string;
  unattended?: boolean;
  recordBotRun?: boolean;
  botRunId?: string;
  isCancelled?: () => boolean;
  personaId?: string;
  providerProfileId?: string;
  research?: ChatResearchOptions;
  startChatTurn?: StartChatTurn;
  delegationChain?: DelegationChain;
  onTurnStarted?: (payload: { userMessageId: string; assistantMessageId: string }) => void;
  onUserWait?: (waiting: boolean) => Promise<void> | void;
}): Promise<ChatTurnResult> {
  const startChatTurn = input.startChatTurn ?? (await import("@/lib/chat-turn")).startChatTurn;
  const manager = getConversationManager();
  const deadline = Date.now() + input.maxWaitMs;

  while (true) {
    if (input.isCancelled?.()) {
      return { status: "stopped" };
    }
    const result = await startChatTurn(manager, input.conversationId, input.content, [], input.personaId, {
      botRun: input.recordBotRun ? undefined : { record: false, runId: input.botRunId },
      quietWhenBusy: true,
      unattended: input.unattended,
      providerProfileId: input.providerProfileId,
      research: input.research,
      delegationChain: input.delegationChain,
      onUserWait: input.onUserWait,
      onMessagesCreated: (payload) => {
        input.onTurnStarted?.(payload);
        broadcastPersistedUserMessage(input.conversationId, payload.userMessageId, input.ownerUserId);
      }
    }).catch((error: unknown) => ({
      status: "failed" as const,
      errorMessage: error instanceof Error ? error.message : "Unable to start assistant turn"
    }));

    if (!isBusyTurnFailure(result)) {
      return result;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { status: "failed", errorMessage: input.busyErrorMessage };
    }
    await waitForChatTurnRelease(input.conversationId, Math.min(remaining, TURN_RELEASE_WAIT_FALLBACK_MS));
  }
}

export type BotTurnOutcome = ChatTurnResult & { turnStarted: boolean };

export function runBotTurn(input: {
  bot: Bot;
  runId: string;
  ownerUserId: string;
  content: string;
  timeoutMs: number;
  personaId?: string;
  providerProfileId?: string;
  research?: ChatResearchOptions;
  startChatTurn?: StartChatTurn;
  onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void;
  onDeadline?: () => void;
}): Promise<BotTurnOutcome> {
  const { bot, runId, ownerUserId, timeoutMs } = input;
  return enqueueSerialTask(bot.id, async (): Promise<BotTurnOutcome> => {
    const slot = createBotUserSlotLease(ownerUserId);
    if (!(await slot.acquire(timeoutMs))) {
      return {
        status: "failed",
        turnStarted: false,
        errorMessage: "Too many concurrent bot runs. Try again when other bots finish."
      };
    }

    try {
      const currentRun = getBotRun(runId);
      if (!currentRun || currentRun.status !== "queued") {
        return { status: "stopped", turnStarted: false };
      }

      const runningRun = updateBotRunStatus(runId, { status: "running", startedAt: new Date().toISOString() });
      if (runningRun) broadcastBotRunUpdate(runningRun);

      let turnStarted = false;
      let rejectDeadline: (error: Error) => void = () => {};
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject;
      });
      const timer = createPausableTimeout(() => {
        requestStop(bot.homeConversationId);
        input.onDeadline?.();
        rejectDeadline(new BotRunDeadlineError());
      }, timeoutMs);
      timer.pause();

      const turn = startTurnWhenIdle({
        conversationId: bot.homeConversationId,
        content: input.content,
        ownerUserId,
        maxWaitMs: timeoutMs,
        busyErrorMessage: `${bot.name} stayed busy and never picked up the message`,
        unattended: true,
        personaId: input.personaId,
        providerProfileId: input.providerProfileId,
        research: input.research,
        startChatTurn: input.startChatTurn,
        delegationChain: delegationRunChain(runId),
        botRunId: runId,
        isCancelled: () => isBotRunStopped(runId),
        onTurnStarted: (payload) => {
          turnStarted = true;
          setTurnStallStop(bot.homeConversationId, DELEGATED_TURN_STALL_STOP_MS);
          timer.resume();
          input.onMessagesCreated?.(payload);
          if (isBotRunStopped(runId)) requestStop(bot.homeConversationId);
        },
        onUserWait: async (waiting) => {
          setBotRunWaitingForUser(runId, waiting);
          if (waiting) {
            timer.pause();
            slot.release();
            return;
          }
          timer.resume();
          await slot.acquire(timer.remainingMs());
        }
      });

      let turnResult: ChatTurnResult;
      try {
        turnResult = await Promise.race([turn, deadline]);
      } catch (error) {
        if (!(error instanceof BotRunDeadlineError)) {
          throw error;
        }
        turnResult = await turn.catch(() => ({
          status: "failed" as const,
          errorMessage: "Bot run timed out"
        }));
        if (turnResult.status === "completed") {
          turnResult = { ...turnResult, status: "stopped" as const };
        }
      } finally {
        timer.clear();
      }

      if (consumeStallStop(bot.homeConversationId)) {
        return {
          status: "failed",
          turnStarted,
          errorMessage: `${bot.name} stopped responding (no activity for ${Math.round(DELEGATED_TURN_STALL_STOP_MS / 60_000)} minutes) and was stopped`
        };
      }
      return { ...turnResult, turnStarted };
    } finally {
      slot.release();
    }
  });
}

async function runWorkerTurn(input: {
  target: Bot;
  runId: string;
  taskPrompt: string;
  ownerUserId: string;
}): Promise<DelegationOutcome> {
  const { target } = input;
  const outcome = await runBotTurn({
    bot: target,
    runId: input.runId,
    ownerUserId: input.ownerUserId,
    content: input.taskPrompt,
    timeoutMs: DEFAULT_BOT_RUN_TIMEOUT_MS
  });

  if (outcome.status === "failed") {
    return {
      status: "failed",
      summary: outcome.turnStarted ? getLatestAssistantSummary(target.homeConversationId) : "",
      errorMessage: outcome.errorMessage ?? "Bot run failed"
    };
  }
  if (outcome.status === "stopped" && !outcome.turnStarted) {
    return { status: "stopped", summary: "" };
  }
  return {
    status: outcome.status,
    summary: getLatestAssistantSummary(target.homeConversationId) || "The bot finished without a visible response."
  };
}

function settleDelegationRun(input: {
  runId: string;
  target: Bot;
  delegation: BotRunDelegation;
  outcome: DelegationOutcome;
}) {
  const { runId, target, delegation, outcome } = input;
  const isFailure = outcome.status === "failed";
  const { finishedRun, action } = getDb().transaction(() => {
    const finishedRun = updateBotRunStatus(runId, {
      status: mapTurnStatusToRunStatus(outcome.status),
      finishedAt: new Date().toISOString(),
      errorMessage: outcome.errorMessage ?? null
    });
    if (delegation.replyConversationId) {
      setBotRunPendingReply(runId, buildDelegationWakeContent(target.name, outcome));
    }
    const action = delegation.replyActionId
      ? updateMessageAction(delegation.replyActionId, {
          status: isFailure ? "error" : "completed",
          resultSummary: isFailure
            ? `The bot run failed${outcome.errorMessage ? `: ${outcome.errorMessage}` : ""}.`
            : outcome.summary || "Finished.",
          completedAt: new Date().toISOString()
        })
      : null;
    return { finishedRun, action };
  })();

  if (finishedRun) broadcastBotRunUpdate(finishedRun);
  if (action && delegation.replyConversationId) {
    getConversationManager().broadcast(delegation.replyConversationId, {
      type: "delta",
      conversationId: delegation.replyConversationId,
      event: { type: isFailure ? "action_error" : "action_complete", action }
    });
  }
}

export function deliverWakeMessage(input: {
  recipientConversationId: string;
  ownerUserId?: string | null;
  content: string;
  maxWaitMs?: number;
  recordBotRun?: boolean;
  delegationChain?: DelegationChain;
  onDelivered?: () => void;
}): Promise<ChatTurnResult> {
  return enqueueSerialTask(`wake:${input.recipientConversationId}`, async () => {
    const maxWaitMs = input.maxWaitMs ?? WAKE_MAX_WAIT_MS;
    const recipientBot = getBotByConversationId(input.recipientConversationId);
    const slotOwnerId = recipientBot ? input.ownerUserId ?? recipientBot.userId : null;
    const slot = slotOwnerId ? createBotUserSlotLease(slotOwnerId) : null;
    if (slot && !(await slot.acquire(maxWaitMs))) {
      return { status: "failed", errorMessage: "Too many concurrent bot runs to deliver the reply" };
    }

    try {
      return await startTurnWhenIdle({
        conversationId: input.recipientConversationId,
        content: input.content,
        ownerUserId: input.ownerUserId,
        maxWaitMs,
        busyErrorMessage: "Recipient conversation stayed busy",
        unattended: Boolean(recipientBot),
        recordBotRun: input.recordBotRun,
        delegationChain: input.delegationChain,
        onTurnStarted: input.onDelivered,
        onUserWait: slot
          ? async (waiting) => {
              if (waiting) {
                slot.release();
                return;
              }
              await slot.acquire(maxWaitMs);
            }
          : undefined
      });
    } finally {
      slot?.release();
    }
  });
}

async function deliverPendingReply(runId: string) {
  const run = getBotRun(runId);
  const delegation = getBotRunDelegation(runId);
  if (!run || !delegation?.pendingReply || !delegation.replyConversationId) return;

  let cleared = false;
  const clearPendingReply = () => {
    if (cleared) return;
    cleared = true;
    setBotRunPendingReply(runId, null);
  };

  const wake = await deliverWakeMessage({
    recipientConversationId: delegation.replyConversationId,
    ownerUserId: getBot(run.botId)?.userId,
    content: delegation.pendingReply,
    delegationChain: delegationRunChain(runId),
    onDelivered: clearPendingReply
  });
  clearPendingReply();
  if (wake.status === "failed" || wake.status === "skipped") {
    console.error(`[bot-delegation] reply from bot run ${runId} could not be delivered: ${wake.errorMessage}`);
  }
}

async function runDelegation(runId: string) {
  try {
    const run = getBotRun(runId);
    const delegation = getBotRunDelegation(runId);
    const target = run ? getBot(run.botId) : null;
    if (!run || !delegation?.prompt || !target?.userId) return;

    const taskPrompt = run.startedAt
      ? buildRestartResumeNotice(target.homeConversationId, delegation.prompt)
      : delegation.prompt;
    const outcome: DelegationOutcome = taskPrompt === null
      ? { status: "failed", summary: "", errorMessage: `${target.name} was interrupted by repeated server restarts` }
      : await runWorkerTurn({ target, runId, taskPrompt, ownerUserId: target.userId }).catch(
          (error: unknown) => ({
            status: "failed",
            summary: "",
            errorMessage: error instanceof Error ? error.message : "Message delivery failed"
          })
        );
    if (consumeUserStoppedBotRun(runId)) return;

    settleDelegationRun({ runId, target, delegation, outcome });
    await deliverPendingReply(runId);
  } finally {
    getDelegationRunChains().delete(runId);
  }
}

export function resumeDelegations() {
  const resumableRunIds = listResumableDelegatedBotRunIds();
  const pendingReplyRunIds = listBotRunIdsWithPendingReply();
  for (const runId of resumableRunIds) {
    void runDelegation(runId).catch((error: unknown) => {
      console.error(`[bot-delegation] resuming bot run ${runId} failed`, error);
    });
  }
  for (const runId of pendingReplyRunIds) {
    void deliverPendingReply(runId).catch((error: unknown) => {
      console.error(`[bot-delegation] redelivering the reply of bot run ${runId} failed`, error);
    });
  }
}
