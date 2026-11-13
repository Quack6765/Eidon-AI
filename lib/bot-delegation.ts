import { listMessages } from "@/lib/conversations";
import { truncateText } from "@/lib/bounded-text";
import {
  createBot,
  getBot,
  getBotByConversationId,
  getBotStatus,
  listPendingBotApprovals,
  resolveBotByNameOrId,
  updateBot
} from "@/lib/bots";
import { MAX_INSTRUCTION_CHARS } from "@/lib/instruction-limits";
import { broadcastBotUpsert, getLatestBotRun } from "@/lib/bot-runs";
import { formatDurationSeconds } from "@/lib/utils";
import { getTurnActivity } from "@/lib/turn-activity";
import { type ToolExecutionContext, resolveActionHandle, toolCallResult } from "./tool-lifecycle";
import {
  claimDelegationMessage,
  delegate,
  delegatedMessageEnvelope,
  delegationSentNotice,
  duplicateDelegationReplyError,
  getLatestAssistantSummary
} from "@/lib/bot-run-lifecycle";

export { deliverWakeMessage, resumeDelegations, runBotTurn } from "@/lib/bot-run-lifecycle";

const MAX_STORED_SENT_MESSAGE_CHARS = 4000;

export async function executeMessageBot(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const botReference = String(args.bot ?? "").trim();
  const message = String(args.message ?? "").trim();

  if (!ownerUserId) {
    return toolCallResult(
      context,
      toolCallId,
      "Error: bot messaging is not available in this conversation",
      context.timelineSortOrder
    );
  }

  if (!botReference || !message) {
    return toolCallResult(context, toolCallId, "Error: bot and message are required", context.timelineSortOrder + 1);
  }

  const sender = context.input.conversationId
    ? getBotByConversationId(context.input.conversationId)
    : null;
  const target = resolveBotByNameOrId(botReference, ownerUserId);
  if (!target || (sender && target.id === sender.id)) {
    return toolCallResult(
      context,
      toolCallId,
      `Error: no other bot "${botReference}" was found. Message an existing teammate by its exact name or id.`,
      context.timelineSortOrder + 1
    );
  }

  if (sender && context.input.conversationId) {
    const senderLastReply = getLatestAssistantSummary(context.input.conversationId);
    if (senderLastReply && message === senderLastReply) {
      return toolCallResult(
        context,
        toolCallId,
        duplicateDelegationReplyError(target.name),
        context.timelineSortOrder + 1
      );
    }
  }

  const delegationChain = context.input.delegationChain ?? { messagesSent: 0 };
  const loopCapError = claimDelegationMessage(delegationChain);
  if (loopCapError) {
    return toolCallResult(context, toolCallId, loopCapError, context.timelineSortOrder + 1);
  }

  const detail = truncateText(`→ ${target.name}: ${message}`, 300);
  const handle = await context.input.onActionStart?.({
    kind: "message_bot",
    label: `Messaged ${target.name}`,
    detail,
    status: "pending",
    toolName: "message_bot",
    arguments: { bot: target.name, message: truncateText(message, MAX_STORED_SENT_MESSAGE_CHARS) }
  });
  const actionHandle = resolveActionHandle(handle);

  delegate({
    target,
    prompt: sender ? delegatedMessageEnvelope(sender.name, message) : message,
    parentMessageId: context.input.assistantMessageId ?? null,
    replyConversationId: context.input.conversationId ?? null,
    replyActionId: actionHandle ?? null,
    delegationChain
  });

  return toolCallResult(
    context,
    toolCallId,
    delegationSentNotice(target.name),
    context.timelineSortOrder + 1,
    true
  );
}

const CHECK_BOT_OUTPUT_CHARS = 1_500;

function formatElapsed(fromIso: string, toMs = Date.now()) {
  return formatDurationSeconds((toMs - Date.parse(fromIso)) / 1000);
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
  const lines = [`${target.name} is ${status === "waiting_user" ? "waiting for the user" : status}.`];

  if (status === "running") {
    const since = activity?.startedAt ?? run?.startedAt ?? null;
    if (since) lines.push(`Working for ${formatElapsed(since)}.`);
    if (activity?.currentAction) lines.push(`Current step: ${activity.currentAction}.`);
    if (activity?.stalled) {
      lines.push(`Warning: no activity for ${formatElapsed(activity.lastActivityAt)} — it may be stalled.`);
    } else if (activity) {
      lines.push(`Last activity ${formatElapsed(activity.lastActivityAt)} ago.`);
    }
  } else if (status === "waiting_user") {
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
  context: ToolExecutionContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const botReference = String(args.bot ?? "").trim();

  const result = (content: string, toolSucceeded?: boolean) =>
    toolCallResult(context, toolCallId, content, context.timelineSortOrder, toolSucceeded);

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
  context: ToolExecutionContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const botReference = String(args.bot ?? "").trim();
  const name = args.name !== undefined ? String(args.name).trim() : undefined;
  const title = args.title !== undefined ? String(args.title).trim() : undefined;
  const description = args.description !== undefined ? String(args.description).trim() : undefined;
  const instructions = args.instructions !== undefined ? String(args.instructions).trim() : undefined;

  const result = (content: string, sortOrder: number) =>
    toolCallResult(context, toolCallId, content, sortOrder);

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
  const actionHandle = resolveActionHandle(handle);

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
  context: ToolExecutionContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const name = String(args.name ?? "").trim();
  const title = String(args.title ?? "").trim();
  const description = String(args.description ?? "").trim();
  const instructions = String(args.instructions ?? "").trim();

  const result = (content: string, sortOrder: number) =>
    toolCallResult(context, toolCallId, content, sortOrder);

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
  const actionHandle = resolveActionHandle(handle);

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
  context: ToolExecutionContext
) {
  const ownerUserId = context.input.memoryUserId ?? null;
  const instructions = String(args.instructions ?? "").trim();

  const result = (content: string, sortOrder: number) =>
    toolCallResult(context, toolCallId, content, sortOrder);

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
  const actionHandle = resolveActionHandle(handle);

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
