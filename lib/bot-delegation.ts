import { getMessage, listMessages } from "@/lib/conversations";
import { requestStop, waitForChatTurnRelease } from "@/lib/chat-turn-control";
import { truncateText, MAX_RUNTIME_TOOL_RESULT_CHARS } from "@/lib/bounded-text";
import { createBot, getBotByConversationId, getBotStatus, resolveBotByNameOrId, updateBot } from "@/lib/bots";
import {
  broadcastBotRunUpdate,
  broadcastBotUpsert,
  createBotRunRecord,
  getBotRun,
  getLatestBotRun,
  updateBotRunStatus
} from "@/lib/bot-runs";
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
import type { ChatTurnResult } from "@/lib/chat-turn";
import type { BotRun, PromptMessage } from "@/lib/types";

type BotToolContext = {
  input: {
    memoryUserId?: string | null;
    conversationId?: string;
    assistantMessageId?: string;
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
  onTurnStarted?: () => void;
}): Promise<ChatTurnResult> {
  const { startChatTurn } = await import("@/lib/chat-turn");
  const manager = getConversationManager();
  const deadline = Date.now() + input.maxWaitMs;

  while (true) {
    const result = await startChatTurn(manager, input.conversationId, input.content, [], undefined, {
      botRun: { record: false },
      quietWhenBusy: true,
      onMessagesCreated: ({ userMessageId }) => {
        input.onTurnStarted?.();
        broadcastPersistedUserMessage(input.conversationId, userMessageId, input.ownerUserId);
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

async function runWorkerTurn(input: {
  target: NonNullable<ReturnType<typeof resolveBotByNameOrId>>;
  runId: string;
  taskPrompt: string;
  ownerUserId: string;
}): Promise<DelegationOutcome> {
  const { target, runId, taskPrompt, ownerUserId } = input;
  return enqueueSerialTask(target.id, async () => {
    if (!(await acquireBotUserSlot(ownerUserId, DEFAULT_BOT_RUN_TIMEOUT_MS))) {
      return {
        status: "failed",
        summary: "",
        errorMessage: "Too many concurrent bot runs. Try again when other bots finish."
      };
    }

    try {
      updateBotRunStatus(runId, { status: "running", startedAt: new Date().toISOString() });
      const runningRun = getBotRun(runId);
      if (runningRun) broadcastBotRunUpdate(runningRun);
      broadcastBotUpsert(target);

      let turnStarted = false;
      const turn = startTurnWhenIdle({
        conversationId: target.homeConversationId,
        content: taskPrompt,
        ownerUserId,
        maxWaitMs: DEFAULT_BOT_RUN_TIMEOUT_MS,
        busyErrorMessage: `${target.name} stayed busy and never picked up the message`,
        onTurnStarted: () => {
          turnStarted = true;
          setTurnStallStop(target.homeConversationId, DELEGATED_TURN_STALL_STOP_MS);
        }
      });

      let timeout: ReturnType<typeof setTimeout> | null = null;
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          if (turnStarted) requestStop(target.homeConversationId);
          reject(new BotRunDeadlineError());
        }, DEFAULT_BOT_RUN_TIMEOUT_MS);
        timeout.unref?.();
      });

      let turnResult: ChatTurnResult;
      try {
        turnResult = await Promise.race([turn, deadline]);
      } catch (error) {
        if (error instanceof BotRunDeadlineError) {
          turnResult = await turn.catch(() => ({
            status: "failed" as const,
            errorMessage: "Bot run timed out"
          }));
          if (turnResult.status === "completed") {
            turnResult = { ...turnResult, status: "stopped" as const };
          }
        } else {
          throw error;
        }
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      if (consumeStallStop(target.homeConversationId)) {
        return {
          status: "failed",
          summary: getLatestAssistantSummary(target.homeConversationId),
          errorMessage: `${target.name} stopped responding (no activity for ${Math.round(DELEGATED_TURN_STALL_STOP_MS / 60_000)} minutes) and was stopped`
        };
      }
      if (turnResult.status === "failed") {
        return {
          status: "failed",
          summary: turnStarted ? getLatestAssistantSummary(target.homeConversationId) : "",
          errorMessage: turnResult.errorMessage ?? "Bot run failed"
        };
      }
      return {
        status: turnResult.status,
        summary: getLatestAssistantSummary(target.homeConversationId) || "The bot finished without a visible response."
      };
    } finally {
      releaseBotUserSlot(ownerUserId);
    }
  });
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
}): Promise<ChatTurnResult> {
  return enqueueSerialTask(`wake:${input.recipientConversationId}`, () =>
    startTurnWhenIdle({
      conversationId: input.recipientConversationId,
      content: input.content,
      ownerUserId: input.ownerUserId,
      maxWaitMs: input.maxWaitMs ?? WAKE_MAX_WAIT_MS,
      busyErrorMessage: "Recipient conversation stayed busy"
    })
  );
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
    const outcome = await runWorkerTurn({ target, runId: run.id, taskPrompt: deliveredPrompt, ownerUserId }).catch(
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
      content: buildDelegationWakeContent(target.name, outcome)
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
  const lines = [`${target.name} is ${status}.`];

  if (status === "running") {
    const since = activity?.startedAt ?? run?.startedAt ?? null;
    if (since) lines.push(`Working for ${formatElapsed(since)}.`);
    if (activity?.currentAction) lines.push(`Current step: ${activity.currentAction}.`);
    if (activity?.stalled) {
      lines.push(`Warning: no activity for ${formatElapsed(activity.lastActivityAt)} — it may be stalled.`);
    } else if (activity) {
      lines.push(`Last activity ${formatElapsed(activity.lastActivityAt)} ago.`);
    }
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
  const systemPrompt = args.system_prompt !== undefined ? String(args.system_prompt).trim() : undefined;

  const result = (content: string, sortOrder: number) => ({
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, { role: "tool" as const, toolCallId, content }]
  });

  if (!ownerUserId) {
    return result("Error: bot updates are not available in this conversation", context.timelineSortOrder);
  }

  if (!botReference) {
    return result("Error: bot is required", context.timelineSortOrder + 1);
  }

  if (name === undefined && title === undefined && description === undefined && systemPrompt === undefined) {
    return result(
      "Error: provide at least one of name, title, description, or system_prompt to update",
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
      ...(systemPrompt !== undefined ? { system_prompt: systemPrompt } : {})
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
        ...(systemPrompt !== undefined ? { systemPrompt } : {})
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

  const result = (content: string, sortOrder: number) => ({
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, { role: "tool" as const, toolCallId, content }]
  });

  if (!ownerUserId) {
    return result("Error: bot creation is not available in this conversation", context.timelineSortOrder);
  }

  if (!name) {
    return result("Error: name is required", context.timelineSortOrder + 1);
  }

  const detail = name;
  const handle = await context.input.onActionStart?.({
    kind: "create_bot",
    label: "Create bot",
    detail,
    toolName: "create_bot",
    arguments: { name, title, description }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const bot = createBot({ name, title, description }, ownerUserId);
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
