import { listMessages } from "@/lib/conversations";
import { requestStop } from "@/lib/chat-turn-control";
import { truncateText, MAX_RUNTIME_TOOL_RESULT_CHARS } from "@/lib/bounded-text";
import { createBot, resolveBotByNameOrId, updateBot } from "@/lib/bots";
import {
  broadcastBotRunUpdate,
  broadcastBotUpsert,
  createBotRunRecord,
  getBotRun,
  updateBotRunStatus
} from "@/lib/bot-runs";
import {
  DEFAULT_BOT_RUN_TIMEOUT_MS,
  enqueueBotTask,
  releaseBotUserSlot,
  tryAcquireBotUserSlot
} from "@/lib/bot-run-limiter";
import { getConversationManager } from "@/lib/ws-singleton";
import type { RuntimeAction } from "./tool-executors";
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

const WAKE_RETRY_DELAY_MS = 2_000;
const WAKE_MAX_ATTEMPTS = 900;

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

async function runWorkerTurn(input: {
  target: NonNullable<ReturnType<typeof resolveBotByNameOrId>>;
  runId: string;
  taskPrompt: string;
  ownerUserId: string;
}): Promise<DelegationOutcome> {
  const { target, runId, taskPrompt, ownerUserId } = input;
  return enqueueBotTask(target.id, async () => {
    if (!tryAcquireBotUserSlot(ownerUserId)) {
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

      const { startChatTurn } = await import("@/lib/chat-turn");
      const manager = getConversationManager();
      const turn = startChatTurn(manager, target.homeConversationId, taskPrompt, [], undefined, {
        botRun: { record: false }
      });

      let timeout: ReturnType<typeof setTimeout> | null = null;
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          requestStop(target.homeConversationId);
          reject(new BotRunDeadlineError());
        }, DEFAULT_BOT_RUN_TIMEOUT_MS);
      });

      let turnResult: import("@/lib/chat-turn").ChatTurnResult;
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

      const summary = getLatestAssistantSummary(target.homeConversationId);
      if (turnResult.status === "failed") {
        return {
          status: "failed",
          summary,
          errorMessage: turnResult.errorMessage ?? "Bot run failed"
        };
      }
      return {
        status: turnResult.status,
        summary: summary || "The bot finished without a visible response."
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
  chiefConversationId: string;
  outcome: DelegationOutcome;
  detail: string;
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

  const manager = getConversationManager();
  manager.broadcast(input.chiefConversationId, {
    type: "delta",
    conversationId: input.chiefConversationId,
    event: { type: isFailure ? "action_error" : "action_complete", action: updated }
  });
}

export function buildDelegationWakeContent(botName: string, outcome: DelegationOutcome) {
  if (outcome.status === "failed") {
    return `[Message from ${botName}]\nThe task failed${outcome.errorMessage ? `: ${outcome.errorMessage}` : ""}.`;
  }
  return `[Message from ${botName}]\n${outcome.summary || "The bot finished without a visible response."}`;
}

export async function deliverDelegationWake(input: {
  chiefConversationId: string;
  ownerUserId: string;
  content: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}) {
  const { startChatTurn } = await import("@/lib/chat-turn");
  const { getMessage } = await import("@/lib/conversations");
  const manager = getConversationManager();
  const maxAttempts = input.maxAttempts ?? WAKE_MAX_ATTEMPTS;
  const retryDelayMs = input.retryDelayMs ?? WAKE_RETRY_DELAY_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await startChatTurn(manager, input.chiefConversationId, input.content, [], undefined, {
      botRun: { record: false },
      onMessagesCreated: ({ userMessageId }) => {
        const userMessage = getMessage(userMessageId, input.ownerUserId);
        if (userMessage) {
          manager.broadcast(input.chiefConversationId, {
            type: "user_message_persisted",
            conversationId: input.chiefConversationId,
            message: userMessage
          });
        }
      }
    }).catch((error: unknown) => ({
      status: "failed" as const,
      errorMessage: error instanceof Error ? error.message : "wake failed"
    }));

    if (result.status !== "failed") {
      return result;
    }
    if (!/already has an active/i.test(result.errorMessage ?? "")) {
      return result;
    }

    await delay(retryDelayMs);
  }

  return { status: "failed" as const, errorMessage: "Chief conversation stayed busy" };
}

export async function executeDelegateTask(
  toolCallId: string,
  args: Record<string, unknown>,
  context: BotToolContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const botReference = String(args.bot ?? "").trim();
  const taskPrompt = String(args.task_prompt ?? "").trim();

  const result = (content: string, sortOrder: number) => ({
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, { role: "tool" as const, toolCallId, content }]
  });

  if (!ownerUserId) {
    return result("Error: delegation is not available in this conversation", context.timelineSortOrder);
  }

  if (!botReference || !taskPrompt) {
    return result("Error: bot and task_prompt are required", context.timelineSortOrder + 1);
  }

  const target = resolveBotByNameOrId(botReference, ownerUserId);
  if (!target || target.isChief) {
    return result(
      `Error: no specialist bot "${botReference}" was found. Delegate to an existing specialist bot or create one with create_bot first.`,
      context.timelineSortOrder + 1
    );
  }

  const detail = truncateText(`→ ${target.name}: ${taskPrompt}`, 300);
  const handle = await context.input.onActionStart?.({
    kind: "delegate_task",
    label: `Messaged ${target.name}`,
    detail,
    status: "pending",
    toolName: "delegate_task",
    arguments: { bot: target.name, task_prompt: truncateText(taskPrompt, 200) }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  const run = createBotRunRecord({
    botId: target.id,
    conversationId: target.homeConversationId,
    triggerSource: "delegated",
    parentMessageId: context.input.assistantMessageId ?? null
  });
  broadcastBotRunUpdate(run);

  void (async () => {
      const outcome = await runWorkerTurn({ target, runId: run.id, taskPrompt, ownerUserId }).catch(
        (error: unknown) => ({
          status: "failed",
          summary: "",
          errorMessage: error instanceof Error ? error.message : "Delegation failed"
        })
      );

      await settleDelegationRun({
        outcome,
        runId: run.id,
        targetName: target.name,
        ownerUserId
      });

      if (actionHandle && context.input.conversationId) {
        await completeActionFromBackground({
          actionHandle,
          chiefConversationId: context.input.conversationId,
          outcome,
          detail
        });
      }

      if (context.input.conversationId) {
        await deliverDelegationWake({
          chiefConversationId: context.input.conversationId,
          ownerUserId,
          content: buildDelegationWakeContent(target.name, outcome)
        });
      }
  })().catch((error: unknown) => {
    console.error("[bot-delegation] async settlement failed", error);
  });

  return {
    ...result(
      [
        `Task sent to ${target.name}.`,
        "The bot is working on it in the background and its reply will arrive here as a new message when it finishes.",
        `Tell the user right away that you have asked ${target.name} and that you will let them know once you have the answer, then continue with anything else.`
      ].join("\n"),
      context.timelineSortOrder + 1
    ),
    toolSucceeded: true
  };
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
        `Created specialist bot "${bot.name}". Delegate tasks to it with delegate_task using its name.`,
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
