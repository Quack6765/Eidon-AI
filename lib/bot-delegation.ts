import { getMessage, listMessages } from "@/lib/conversations";
import { requestStop, waitForChatTurnRelease } from "@/lib/chat-turn-control";
import { truncateText, MAX_RUNTIME_TOOL_RESULT_CHARS } from "@/lib/bounded-text";
import {
  createBot,
  getBotByConversationId,
  getBotStatus,
  listPendingBotApprovals,
  resolveBotByNameOrId,
  updateBot
} from "@/lib/bots";
import { MAX_INSTRUCTION_CHARS } from "@/lib/instruction-limits";
import {
  broadcastBotRunUpdate,
  broadcastBotUpsert,
  createBotRunRecord,
  getBotRun,
  getLatestBotRun,
  setBotRunAwaitingApproval,
  updateBotRunStatus
} from "@/lib/bot-runs";
import { createPausableTimeout } from "@/lib/pausable-timeout";
import {
  DELEGATED_TURN_STALL_STOP_MS,
  consumeStallStop,
  getTurnActivity,
  setTurnStallStop
} from "@/lib/turn-activity";
import {
  DEFAULT_BOT_RUN_TIMEOUT_MS,
  acquireBotUserSlot,
  enqueueSerialTask,
  releaseBotUserSlot
} from "@/lib/bot-run-limiter";
import { getConversationManager } from "@/lib/ws-singleton";
import type { RuntimeAction } from "./tool-executors";
import type { ChatTurnResult, StartChatTurn } from "@/lib/chat-turn";
import type { Bot, BotRun, ChatResearchOptions, DelegationChain, PromptMessage } from "@/lib/types";

type BotToolContext = {
  input: {
    memoryUserId?: string | null;
    conversationId?: string;
    assistantMessageId?: string;
    delegationChain?: DelegationChain;
    abortSignal?: AbortSignal;
    onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
    onActionComplete?: (
      handle: string | undefined,
      patch: { detail?: string; resultSummary?: string }
    ) => Promise<void> | void;
    onActionError?: (
      handle: string | undefined,
      patch: { detail?: string; resultSummary?: string }
    ) => Promise<void> | void;
  };
  timelineSortOrder: number;
  promptMessages: PromptMessage[];
};

class BotRunDeadlineError extends Error {
  constructor() {
    super("Bot run exceeded its execution deadline");
    this.name = "BotRunDeadlineError";
  }
}

function getLatestAssistantSummary(conversationId: string) {
  const messages = listMessages(conversationId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.content.trim()) {
      return truncateText(message.content.trim(), MAX_RUNTIME_TOOL_RESULT_CHARS);
    }
  }
  return "";
}

function mapTurnStatusToRunStatus(status: string): BotRun["status"] {
  if (status === "completed") return "completed";
  if (status === "stopped") return "stopped";
  return "failed";
}

type DelegationOutcome = { status: string; summary: string; errorMessage?: string };

const WAKE_MAX_WAIT_MS = 30 * 60_000;
const TURN_RELEASE_WAIT_FALLBACK_MS = 5_000;
export const MAX_BOT_MESSAGES_PER_REQUEST = 10;

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

function broadcastPersistedUserMessage(conversationId: string, userMessageId: string, ownerUserId: string) {
  const userMessage = getMessage(userMessageId, ownerUserId);
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
  ownerUserId: string;
  maxWaitMs: number;
  busyErrorMessage: string;
  unattended?: boolean;
  personaId?: string;
  providerProfileId?: string;
  research?: ChatResearchOptions;
  startChatTurn?: StartChatTurn;
  delegationChain?: DelegationChain;
  onTurnStarted?: (payload: { userMessageId: string; assistantMessageId: string }) => void;
  onApprovalWait?: (waiting: boolean) => Promise<void> | void;
}): Promise<ChatTurnResult> {
  const startChatTurn = input.startChatTurn ?? (await import("@/lib/chat-turn")).startChatTurn;
  const manager = getConversationManager();
  const deadline = Date.now() + input.maxWaitMs;

  while (true) {
    const result = await startChatTurn(manager, input.conversationId, input.content, [], input.personaId, {
      botRun: { record: false },
      quietWhenBusy: true,
      unattended: input.unattended,
      providerProfileId: input.providerProfileId,
      research: input.research,
      delegationChain: input.delegationChain,
      onApprovalWait: input.onApprovalWait,
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

type BotTurnOutcome = ChatTurnResult & { turnStarted: boolean };

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
  delegationChain?: DelegationChain;
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
      broadcastBotUpsert(bot);

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
        delegationChain: input.delegationChain,
        onTurnStarted: (payload) => {
          turnStarted = true;
          setTurnStallStop(bot.homeConversationId, DELEGATED_TURN_STALL_STOP_MS);
          timer.resume();
          input.onMessagesCreated?.(payload);
        },
        onApprovalWait: async (waiting) => {
          setBotRunAwaitingApproval(runId, waiting);
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
  delegationChain: DelegationChain;
}): Promise<DelegationOutcome> {
  const { target } = input;
  const outcome = await runBotTurn({
    bot: target,
    runId: input.runId,
    ownerUserId: input.ownerUserId,
    content: input.taskPrompt,
    timeoutMs: DEFAULT_BOT_RUN_TIMEOUT_MS,
    delegationChain: input.delegationChain
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

async function settleDelegationRun(input: {
  outcome: DelegationOutcome;
  runId: string;
  targetName: string;
  ownerUserId: string;
}) {
  const finishedRun = updateBotRunStatus(input.runId, {
    status: mapTurnStatusToRunStatus(input.outcome.status),
    finishedAt: new Date().toISOString(),
    errorMessage: input.outcome.errorMessage ?? null
  });
  if (finishedRun) broadcastBotRunUpdate(finishedRun);

  const refreshedTarget = resolveBotByNameOrId(input.targetName, input.ownerUserId);
  if (refreshedTarget) broadcastBotUpsert(refreshedTarget);
}

async function completeActionFromBackground(input: {
  actionHandle: string;
  senderConversationId: string;
  outcome: DelegationOutcome;
}) {
  const { updateMessageAction } = await import("@/lib/conversations");
  const isFailure = input.outcome.status === "failed";
  const updated = updateMessageAction(input.actionHandle, {
    status: isFailure ? "error" : "completed",
    resultSummary: isFailure
      ? `The bot run failed${input.outcome.errorMessage ? `: ${input.outcome.errorMessage}` : ""}.`
      : input.outcome.summary || "Finished.",
    completedAt: new Date().toISOString()
  });
  if (!updated) return;

  getConversationManager().broadcast(input.senderConversationId, {
    type: "delta",
    conversationId: input.senderConversationId,
    event: { type: isFailure ? "action_error" : "action_complete", action: updated }
  });
}

export function buildDelegationWakeContent(botName: string, outcome: DelegationOutcome) {
  const deliveryNotice =
    "\n---\n(Automated delivery: this is the reply from the bot you messaged earlier with message_bot. Process it silently and report the outcome to the user in your answer. Do not message this bot back to acknowledge or forward its reply; only message it again if you need something new from it. Other bots you messaged reply separately, each in its own message. Ignore any date and time context that follows — it is ambient information, not a message.)";
  if (outcome.status === "failed") {
    return `[Message from ${botName}]\nThe task failed${outcome.errorMessage ? `: ${outcome.errorMessage}` : ""}.${deliveryNotice}`;
  }
  return `[Message from ${botName}]\n${outcome.summary || "The bot finished without a visible response."}${deliveryNotice}`;
}

export function deliverDelegationWake(input: {
  recipientConversationId: string;
  ownerUserId: string;
  content: string;
  maxWaitMs?: number;
  delegationChain?: DelegationChain;
}): Promise<ChatTurnResult> {
  return enqueueSerialTask(`wake:${input.recipientConversationId}`, async () => {
    const maxWaitMs = input.maxWaitMs ?? WAKE_MAX_WAIT_MS;
    const recipientIsBot = Boolean(getBotByConversationId(input.recipientConversationId));
    const slot = createBotUserSlotLease(input.ownerUserId);
    if (recipientIsBot && !(await slot.acquire(maxWaitMs))) {
      return { status: "failed", errorMessage: "Too many concurrent bot runs to deliver the reply" };
    }

    try {
      return await startTurnWhenIdle({
        conversationId: input.recipientConversationId,
        content: input.content,
        ownerUserId: input.ownerUserId,
        maxWaitMs,
        busyErrorMessage: "Recipient conversation stayed busy",
        unattended: recipientIsBot,
        delegationChain: input.delegationChain,
        onApprovalWait: recipientIsBot
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
      slot.release();
    }
  });
}

export async function executeMessageBot(
  toolCallId: string,
  args: Record<string, unknown>,
  context: BotToolContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const botReference = String(args.bot ?? "").trim();
  const message = String(args.message ?? "").trim();

  const result = (content: string, sortOrder: number) => ({
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, { role: "tool" as const, toolCallId, content }]
  });

  if (!ownerUserId) {
    return result("Error: bot messaging is not available in this conversation", context.timelineSortOrder);
  }

  if (!botReference || !message) {
    return result("Error: bot and message are required", context.timelineSortOrder + 1);
  }

  const sender = context.input.conversationId
    ? getBotByConversationId(context.input.conversationId)
    : null;
  const target = resolveBotByNameOrId(botReference, ownerUserId);
  if (!target || (sender && target.id === sender.id)) {
    return result(
      `Error: no other bot "${botReference}" was found. Message an existing teammate by its exact name or id.`,
      context.timelineSortOrder + 1
    );
  }

  if (sender && context.input.conversationId) {
    const senderLastReply = getLatestAssistantSummary(context.input.conversationId);
    if (senderLastReply && message === senderLastReply) {
      return result(
        [
          `Error: this message duplicates the reply you just gave in this conversation. Your answers here are for the user — never send them to a bot, and never use message_bot to acknowledge or forward a bot's reply.`,
          `Report ${target.name}'s reply to the user directly instead. Only call message_bot to give ${target.name} new instructions or a new question.`
        ].join("\n"),
        context.timelineSortOrder + 1
      );
    }
  }

  const delegationChain = context.input.delegationChain ?? { messagesSent: 0 };
  if (delegationChain.messagesSent >= MAX_BOT_MESSAGES_PER_REQUEST) {
    return result(
      `Error: bots have already sent each other ${MAX_BOT_MESSAGES_PER_REQUEST} messages for this request without a new message from the user, so message_bot is paused to stop a loop. Report what you have to the user instead; you can message bots again after the user replies.`,
      context.timelineSortOrder + 1
    );
  }
  delegationChain.messagesSent += 1;

  const deliveredPrompt = sender
    ? `[Message from ${sender.name}]\n${message}`
    : message;

  const detail = truncateText(`→ ${target.name}: ${message}`, 300);
  const handle = await context.input.onActionStart?.({
    kind: "message_bot",
    label: `Messaged ${target.name}`,
    detail,
    status: "pending",
    toolName: "message_bot",
    arguments: { bot: target.name, message: truncateText(message, 200) }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  const run = createBotRunRecord({
    botId: target.id,
    conversationId: target.homeConversationId,
    triggerSource: "delegated",
    parentMessageId: context.input.assistantMessageId ?? null
  });
  broadcastBotRunUpdate(run);

  const senderConversationId = context.input.conversationId;
  void (async () => {
    const outcome = await runWorkerTurn({
      target,
      runId: run.id,
      taskPrompt: deliveredPrompt,
      ownerUserId,
      delegationChain
    }).catch(
      (error: unknown) => ({
        status: "failed",
        summary: "",
        errorMessage: error instanceof Error ? error.message : "Message delivery failed"
      })
    );

    await settleDelegationRun({
      outcome,
      runId: run.id,
      targetName: target.name,
      ownerUserId
    });

    if (!senderConversationId) return;

    if (actionHandle) {
      await completeActionFromBackground({
        actionHandle,
        senderConversationId,
        outcome
      });
    }

    const wake = await deliverDelegationWake({
      recipientConversationId: senderConversationId,
      ownerUserId,
      content: buildDelegationWakeContent(target.name, outcome),
      delegationChain
    });
    if (wake.status === "failed") {
      console.error(`[bot-delegation] reply from ${target.name} could not be delivered: ${wake.errorMessage}`);
    }
  })().catch((error: unknown) => {
    console.error("[bot-delegation] async settlement failed", error);
  });

  return {
    ...result(
      [
        `Message sent to ${target.name}.`,
        "The bot is working on it in the background and its reply will arrive here as a new message when it finishes.",
        `Say right away that you have messaged ${target.name} and that you will report back once you have the answer, then continue with anything else.`,
        `When ${target.name}'s reply arrives as a new message, report it to the user directly — do not send it, or an acknowledgment, back to ${target.name}.`
      ].join("\n"),
      context.timelineSortOrder + 1
    ),
    toolSucceeded: true
  };
}

const CHECK_BOT_OUTPUT_CHARS = 1_500;

function formatElapsed(fromIso: string, toMs = Date.now()) {
  const seconds = Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function getLatestOutputSnippet(conversationId: string) {
  const messages = listMessages(conversationId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text =
      message.content.trim() ||
      (message.timeline ?? [])
        .filter((item): item is Extract<typeof item, { timelineKind: "text" }> => item.timelineKind === "text")
        .map((item) => item.content)
        .join("")
        .trim();
    if (!text) continue;
    const snippet = text.length > CHECK_BOT_OUTPUT_CHARS ? `…${text.slice(-CHECK_BOT_OUTPUT_CHARS)}` : text;
    return { status: message.status, snippet };
  }
  return null;
}

export function describeBotProgress(target: NonNullable<ReturnType<typeof resolveBotByNameOrId>>) {
  const status = getBotStatus(target);
  const run = getLatestBotRun(target.id);
  const activity = getTurnActivity(target.homeConversationId);
  const lines = [`${target.name} is ${status === "waiting_approval" ? "waiting for approval" : status}.`];

  if (status === "running") {
    const since = activity?.startedAt ?? run?.startedAt ?? null;
    if (since) lines.push(`Working for ${formatElapsed(since)}.`);
    if (activity?.currentAction) lines.push(`Current step: ${activity.currentAction}.`);
    if (activity?.stalled) {
      lines.push(`Warning: no activity for ${formatElapsed(activity.lastActivityAt)} — it may be stalled.`);
    } else if (activity) {
      lines.push(`Last activity ${formatElapsed(activity.lastActivityAt)} ago.`);
    }
  } else if (status === "waiting_approval") {
    for (const { action } of listPendingBotApprovals({ botId: target.id })) {
      lines.push(`Blocked: waiting ${formatElapsed(action.startedAt)} for the user to answer "${action.label}" (${action.detail}).`);
    }
    lines.push(`It resumes once the user answers the approval card in ${target.name}'s conversation.`);
  } else if (status === "queued") {
    lines.push("Waiting for its turn — another task or a concurrency slot is ahead of it.");
  } else if (run) {
    const finished = run.finishedAt ?? run.createdAt;
    lines.push(
      `Last run ${run.status}${run.errorMessage ? ` (${run.errorMessage})` : ""}, ${formatElapsed(finished)} ago.`
    );
  }

  const output = getLatestOutputSnippet(target.homeConversationId);
  if (output) {
    lines.push("", output.status === "streaming" ? "Output so far:" : "Latest output:", output.snippet);
  }
  return lines.join("\n");
}

export async function executeCheckBot(
  toolCallId: string,
  args: Record<string, unknown>,
  context: BotToolContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const botReference = String(args.bot ?? "").trim();

  const result = (content: string, toolSucceeded?: boolean) => ({
    nextSortOrder: context.timelineSortOrder,
    promptMessages: [...context.promptMessages, { role: "tool" as const, toolCallId, content }],
    ...(toolSucceeded === undefined ? {} : { toolSucceeded })
  });

  if (!ownerUserId) {
    return result("Error: bot status checks are not available in this conversation");
  }
  if (!botReference) {
    return result("Error: bot is required");
  }

  const target = resolveBotByNameOrId(botReference, ownerUserId);
  if (!target) {
    return result(`Error: no bot "${botReference}" was found. Check a teammate by its exact name or id.`);
  }

  return result(
    `${describeBotProgress(target)}\n\n(Status check only — the bot was not interrupted. Its reply will still arrive here as a new message when it finishes; do not message it to ask for status.)`,
    true
  );
}

const MAX_BOT_INSTRUCTIONS_CHARS = MAX_INSTRUCTION_CHARS;

export async function executeUpdateBotTool(
  toolCallId: string,
  args: Record<string, unknown>,
  context: BotToolContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const botReference = String(args.bot ?? "").trim();
  const name = args.name !== undefined ? String(args.name).trim() : undefined;
  const title = args.title !== undefined ? String(args.title).trim() : undefined;
  const description = args.description !== undefined ? String(args.description).trim() : undefined;
  const instructions = args.instructions !== undefined ? String(args.instructions).trim() : undefined;

  const result = (content: string, sortOrder: number) => ({
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, { role: "tool" as const, toolCallId, content }]
  });

  const actingBot = context.input.conversationId ? getBotByConversationId(context.input.conversationId) : null;

  if (!ownerUserId) {
    return result("Error: bot updates are not available in this conversation", context.timelineSortOrder);
  }

  if (!actingBot?.isChief) {
    return result("Error: only the chief of staff can update bots.", context.timelineSortOrder + 1);
  }

  if (!botReference) {
    return result("Error: bot is required", context.timelineSortOrder + 1);
  }

  if (name === undefined && title === undefined && description === undefined && instructions === undefined) {
    return result(
      "Error: provide at least one of name, title, description, or instructions to update",
      context.timelineSortOrder + 1
    );
  }

  if (instructions !== undefined && instructions.length > MAX_BOT_INSTRUCTIONS_CHARS) {
    return result(
      `Error: instructions are too long (max ${MAX_BOT_INSTRUCTIONS_CHARS} characters)`,
      context.timelineSortOrder + 1
    );
  }

  const target = resolveBotByNameOrId(botReference, ownerUserId);
  if (!target || target.isChief) {
    return result(
      `Error: no specialist bot "${botReference}" was found. Use the exact name or id of a specialist bot.`,
      context.timelineSortOrder + 1
    );
  }

  const detail = name ?? botReference;
  const handle = await context.input.onActionStart?.({
    kind: "update_bot",
    label: name ? `Rename ${target.name} to ${name}` : `Update ${target.name}`,
    detail,
    toolName: "update_bot",
    arguments: {
      bot: target.name,
      ...(name !== undefined ? { name } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(instructions !== undefined ? { instructions } : {})
    }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const updated = updateBot(
      target.id,
      {
        ...(name !== undefined ? { name } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(instructions !== undefined ? { systemPrompt: instructions } : {})
      },
      ownerUserId
    );
    if (!updated) {
      throw new Error("Bot not found");
    }
    broadcastBotUpsert(updated);

    await context.input.onActionComplete?.(actionHandle, {
      detail,
      resultSummary: `Updated bot ${updated.name}`
    });

    return {
      ...result(
        `Updated specialist bot "${target.name}"${name && name !== target.name ? ` → renamed to "${name}"` : ""}. Its thread and sidebar entry now use the new name.`,
        context.timelineSortOrder + 1
      ),
      toolSucceeded: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update bot";
    await context.input.onActionError?.(actionHandle, { detail, resultSummary: message });
    return { ...result(`Error: ${message}`, context.timelineSortOrder + 1), toolSucceeded: false };
  }
}

export async function executeCreateBotTool(
  toolCallId: string,
  args: Record<string, unknown>,
  context: BotToolContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const name = String(args.name ?? "").trim();
  const title = String(args.title ?? "").trim();
  const description = String(args.description ?? "").trim();
  const instructions = String(args.instructions ?? "").trim();

  const result = (content: string, sortOrder: number) => ({
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, { role: "tool" as const, toolCallId, content }]
  });

  const actingBot = context.input.conversationId ? getBotByConversationId(context.input.conversationId) : null;

  if (!ownerUserId) {
    return result("Error: bot creation is not available in this conversation", context.timelineSortOrder);
  }

  if (!actingBot?.isChief) {
    return result("Error: only the chief of staff can create bots.", context.timelineSortOrder + 1);
  }

  if (!name) {
    return result("Error: name is required", context.timelineSortOrder + 1);
  }

  if (!instructions) {
    return result(
      "Error: instructions are required — every bot needs specific instructions covering its identity, what it owns, how it should work, its quality bar, and what to avoid",
      context.timelineSortOrder + 1
    );
  }

  if (instructions.length > MAX_BOT_INSTRUCTIONS_CHARS) {
    return result(
      `Error: instructions are too long (max ${MAX_BOT_INSTRUCTIONS_CHARS} characters)`,
      context.timelineSortOrder + 1
    );
  }

  const detail = name;
  const handle = await context.input.onActionStart?.({
    kind: "create_bot",
    label: "Create bot",
    detail,
    toolName: "create_bot",
    arguments: { name, title, description, instructions }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const bot = createBot({ name, title, description, systemPrompt: instructions }, ownerUserId);
    broadcastBotUpsert(bot);

    await context.input.onActionComplete?.(actionHandle, {
      detail,
      resultSummary: `Created bot ${bot.name}`
    });

    return {
      ...result(
        `Created specialist bot "${bot.name}". Send work to it with message_bot using its name.`,
        context.timelineSortOrder + 1
      ),
      toolSucceeded: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create bot";
    await context.input.onActionError?.(actionHandle, { detail, resultSummary: message });
    return { ...result(`Error: ${message}`, context.timelineSortOrder + 1), toolSucceeded: false };
  }
}

export async function executeUpdateOwnInstructionsTool(
  toolCallId: string,
  args: Record<string, unknown>,
  context: BotToolContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const instructions = String(args.instructions ?? "").trim();

  const result = (content: string, sortOrder: number) => ({
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, { role: "tool" as const, toolCallId, content }]
  });

  const actingBot = context.input.conversationId ? getBotByConversationId(context.input.conversationId) : null;

  if (!ownerUserId || !actingBot) {
    return result(
      "Error: updating your own instructions is only available inside a bot's own thread",
      context.timelineSortOrder
    );
  }

  if (!instructions) {
    return result(
      "Error: instructions are required — provide the complete new instructions",
      context.timelineSortOrder + 1
    );
  }

  if (instructions.length > MAX_BOT_INSTRUCTIONS_CHARS) {
    return result(
      `Error: instructions are too long (max ${MAX_BOT_INSTRUCTIONS_CHARS} characters)`,
      context.timelineSortOrder + 1
    );
  }

  const handle = await context.input.onActionStart?.({
    kind: "update_bot",
    label: "Update own instructions",
    detail: actingBot.name,
    toolName: "update_own_instructions",
    arguments: { instructions }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const updated = updateBot(actingBot.id, { systemPrompt: instructions }, ownerUserId);
    if (!updated) {
      throw new Error("Bot not found");
    }
    broadcastBotUpsert(updated);

    await context.input.onActionComplete?.(actionHandle, {
      detail: actingBot.name,
      resultSummary: `Updated own instructions for ${updated.name}`
    });

    return {
      ...result(
        "Your instructions have been updated and apply from your next message. Tell the user what you changed and why.",
        context.timelineSortOrder + 1
      ),
      toolSucceeded: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update instructions";
    await context.input.onActionError?.(actionHandle, { detail: actingBot.name, resultSummary: message });
    return { ...result(`Error: ${message}`, context.timelineSortOrder + 1), toolSucceeded: false };
  }
}
