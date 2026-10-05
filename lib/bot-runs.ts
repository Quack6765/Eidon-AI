import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
import { getActiveChatTurn, requestStop } from "@/lib/chat-turn-control";
import { updateMessageAction } from "@/lib/conversations";
import { getBot, getBotByConversationId, toBotSummary } from "@/lib/bots";
import { getConversationManager } from "@/lib/ws-singleton";
import type { Bot, BotRun, BotRunStatus, BotRunTriggerSource } from "@/lib/types";

type BotRunRow = {
  id: string;
  bot_id: string;
  conversation_id: string;
  trigger_source: BotRunTriggerSource;
  status: BotRunStatus;
  started_at: string | null;
  finished_at: string | null;
  parent_message_id: string | null;
  requested_by_bot_id: string | null;
  error_message: string | null;
  created_at: string;
};

const BOT_RUN_SELECT = `SELECT r.id, r.bot_id, r.conversation_id, r.trigger_source, r.status, r.started_at, r.finished_at,
    r.parent_message_id, pb.id AS requested_by_bot_id, r.error_message, r.created_at
  FROM bot_runs r
  LEFT JOIN messages pm ON pm.id = r.parent_message_id
  LEFT JOIN bots pb ON pb.home_conversation_id = COALESCE(r.reply_conversation_id, pm.conversation_id)`;

const ACTIVE_BOT_RUN_STATUSES = "('queued', 'running', 'waiting_user')";

function rowToBotRun(row: BotRunRow): BotRun {
  return {
    id: row.id,
    botId: row.bot_id,
    conversationId: row.conversation_id,
    triggerSource: row.trigger_source,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    parentMessageId: row.parent_message_id,
    requestedByBotId: row.requested_by_bot_id,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

export function createBotRunRecord(input: {
  botId: string;
  conversationId: string;
  triggerSource: BotRunTriggerSource;
  parentMessageId?: string | null;
  prompt?: string | null;
  replyConversationId?: string | null;
  replyActionId?: string | null;
}): BotRun {
  const run: Omit<BotRun, "requestedByBotId"> = {
    id: createId("botrun"),
    botId: input.botId,
    conversationId: input.conversationId,
    triggerSource: input.triggerSource,
    status: "queued",
    startedAt: null,
    finishedAt: null,
    parentMessageId: input.parentMessageId ?? null,
    errorMessage: null,
    createdAt: nowIso()
  };

  getDb()
    .prepare(
      `INSERT INTO bot_runs (
        id, bot_id, conversation_id, trigger_source, status, started_at, finished_at, parent_message_id, error_message,
        prompt, reply_conversation_id, reply_action_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.id,
      run.botId,
      run.conversationId,
      run.triggerSource,
      run.status,
      run.startedAt,
      run.finishedAt,
      run.parentMessageId,
      run.errorMessage,
      input.prompt ?? null,
      input.replyConversationId ?? null,
      input.replyActionId ?? null,
      run.createdAt
    );

  return getBotRun(run.id) ?? { ...run, requestedByBotId: null };
}

export type BotRunDelegation = {
  prompt: string | null;
  replyConversationId: string | null;
  replyActionId: string | null;
  pendingReply: string | null;
};

export function getBotRunDelegation(runId: string): BotRunDelegation | null {
  const row = getDb()
    .prepare("SELECT prompt, reply_conversation_id, reply_action_id, pending_reply FROM bot_runs WHERE id = ?")
    .get(runId) as
    | { prompt: string | null; reply_conversation_id: string | null; reply_action_id: string | null; pending_reply: string | null }
    | undefined;
  return row
    ? {
        prompt: row.prompt,
        replyConversationId: row.reply_conversation_id,
        replyActionId: row.reply_action_id,
        pendingReply: row.pending_reply
      }
    : null;
}

export function setBotRunPendingReply(runId: string, reply: string | null) {
  getDb().prepare("UPDATE bot_runs SET pending_reply = ? WHERE id = ?").run(reply, runId);
}

export function listResumableDelegatedBotRunIds(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT id FROM bot_runs
       WHERE trigger_source = 'delegated' AND status = 'queued' AND prompt IS NOT NULL
       ORDER BY created_at ASC, id ASC`
    )
    .all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function listBotRunIdsWithPendingReply(): string[] {
  const rows = getDb()
    .prepare("SELECT id FROM bot_runs WHERE pending_reply IS NOT NULL ORDER BY finished_at ASC, id ASC")
    .all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function getBotRun(runId: string): BotRun | null {
  const row = getDb()
    .prepare(`${BOT_RUN_SELECT} WHERE r.id = ?`)
    .get(runId) as BotRunRow | undefined;
  return row ? rowToBotRun(row) : null;
}

export function updateBotRunStatus(
  runId: string,
  patch: {
    status: BotRunStatus;
    startedAt?: string | null;
    finishedAt?: string | null;
    errorMessage?: string | null;
  }
): BotRun | null {
  const current = getBotRun(runId);
  if (!current) return null;

  getDb()
    .prepare(
      `UPDATE bot_runs
       SET status = ?,
           started_at = ?,
           finished_at = ?,
           error_message = ?
       WHERE id = ?`
    )
    .run(
      patch.status,
      patch.startedAt ?? current.startedAt,
      patch.finishedAt ?? current.finishedAt,
      patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
      runId
    );

  return getBotRun(runId);
}

export function setBotRunWaitingForUser(runId: string, waitingForUser: boolean) {
  const current = getBotRun(runId);
  if (!current || (current.status !== "running" && current.status !== "waiting_user")) return;
  const updated = updateBotRunStatus(runId, { status: waitingForUser ? "waiting_user" : "running" });
  if (!updated) return;
  broadcastBotRunUpdate(updated);
}

export function getLatestBotRun(botId: string): BotRun | null {
  const row = getDb()
    .prepare(`${BOT_RUN_SELECT} WHERE r.bot_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 1`)
    .get(botId) as BotRunRow | undefined;
  return row ? rowToBotRun(row) : null;
}

export function deleteBotRun(runId: string) {
  getDb().prepare("DELETE FROM bot_runs WHERE id = ?").run(runId);
}

export function listRecentBotRuns(input: { userId?: string; botId?: string; limit?: number }): BotRun[] {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const filters: string[] = [];
  const values: string[] = [];
  if (input.userId) {
    filters.push("r.bot_id IN (SELECT id FROM bots WHERE user_id = ?)");
    values.push(input.userId);
  }
  if (input.botId) {
    filters.push("(r.bot_id = ? OR pb.id = ?)");
    values.push(input.botId, input.botId);
  }
  const rows = getDb()
    .prepare(
      `${BOT_RUN_SELECT}
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ?`
    )
    .all(...values, limit) as BotRunRow[];

  return rows.map(rowToBotRun);
}

const USER_STOPPED_BOT_RUNS_KEY = Symbol.for("eidon:user-stopped-bot-runs");

function getUserStoppedBotRuns() {
  const registry = globalThis as Record<symbol, Set<string> | undefined>;
  registry[USER_STOPPED_BOT_RUNS_KEY] ??= new Set<string>();
  return registry[USER_STOPPED_BOT_RUNS_KEY];
}

export function consumeUserStoppedBotRun(runId: string) {
  return getUserStoppedBotRuns().delete(runId);
}

export function isBotRunStopped(runId: string) {
  return getBotRun(runId)?.status === "stopped";
}

function isActiveBotRun(run: BotRun) {
  return run.status === "queued" || run.status === "running" || run.status === "waiting_user";
}

function markHandOffStopped(runId: string) {
  const delegation = getBotRunDelegation(runId);
  if (!delegation?.replyActionId || !delegation.replyConversationId) return;
  const action = updateMessageAction(delegation.replyActionId, {
    status: "stopped",
    resultSummary: "Stopped by you before it finished.",
    completedAt: nowIso()
  });
  if (!action) return;
  getConversationManager().broadcast(delegation.replyConversationId, {
    type: "delta",
    conversationId: delegation.replyConversationId,
    event: { type: "action_complete", action }
  });
}

function markBotRunStopped(runId: string) {
  const run = getBotRun(runId);
  if (!run || !isActiveBotRun(run)) return;
  if (run.triggerSource === "delegated") getUserStoppedBotRuns().add(run.id);
  const stopped = updateBotRunStatus(run.id, { status: "stopped", finishedAt: nowIso() });
  if (stopped) broadcastBotRunUpdate(stopped);
  if (run.triggerSource === "delegated") markHandOffStopped(run.id);
}

export function stopBotRun(runId: string): BotRun | null {
  const run = getBotRun(runId);
  if (!run || !isActiveBotRun(run)) return run;

  if (getActiveChatTurn(run.conversationId)?.botRunId === run.id) {
    stopConversationWork(run.conversationId);
  } else {
    markBotRunStopped(run.id);
  }
  const bot = getBot(run.botId);
  if (bot) broadcastBotUpsert(bot);
  return getBotRun(run.id);
}

export function stopConversationWork(conversationId: string) {
  const activeRunId = getActiveChatTurn(conversationId)?.botRunId;
  requestStop(conversationId);
  if (activeRunId) markBotRunStopped(activeRunId);

  const delegated = getDb()
    .prepare(
      `SELECT r.id FROM bot_runs r
       LEFT JOIN messages pm ON pm.id = r.parent_message_id
       WHERE COALESCE(r.reply_conversation_id, pm.conversation_id) = ? AND r.status IN ${ACTIVE_BOT_RUN_STATUSES}
       ORDER BY r.created_at ASC`
    )
    .all(conversationId) as Array<{ id: string }>;
  for (const { id } of delegated) {
    stopBotRun(id);
  }
}

export function stopBotWork(bot: Bot) {
  const active = getDb()
    .prepare(`SELECT id FROM bot_runs WHERE bot_id = ? AND status IN ${ACTIVE_BOT_RUN_STATUSES} ORDER BY created_at ASC`)
    .all(bot.id) as Array<{ id: string }>;
  for (const { id } of active) {
    stopBotRun(id);
  }
  stopConversationWork(bot.homeConversationId);
  broadcastBotUpsert(bot);
}

function getBotOwnerUserId(bot: Bot): string | null {
  return bot.userId;
}

export function broadcastBotRunUpdate(run: BotRun) {
  const bot = getBot(run.botId);
  const ownerUserId = bot ? getBotOwnerUserId(bot) : null;
  if (!ownerUserId) return;
  getConversationManager().broadcastAll({ type: "bot_run_updated", run }, ownerUserId);
}

export function broadcastBotUpsert(bot: Bot) {
  const ownerUserId = getBotOwnerUserId(bot);
  if (!ownerUserId) return;
  getConversationManager().broadcastAll(
    { type: "bot_updated", bot: toBotSummary(bot) },
    ownerUserId
  );
}

export function broadcastBotUpdateForMessage(messageId: string) {
  const row = getDb()
    .prepare("SELECT conversation_id FROM messages WHERE id = ?")
    .get(messageId) as { conversation_id: string } | undefined;
  if (!row) return;
  const bot = getBotByConversationId(row.conversation_id);
  if (!bot) return;
  broadcastBotUpsert(bot);
}

export function broadcastBotDeleted(botId: string, ownerUserId: string | null) {
  if (!ownerUserId) return;
  getConversationManager().broadcastAll({ type: "bot_deleted", botId }, ownerUserId);
}
