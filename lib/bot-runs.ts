import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { nowIso } from "@/lib/utils";
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
  error_message: string | null;
  created_at: string;
};

const BOT_RUN_COLUMNS = `id, bot_id, conversation_id, trigger_source, status, started_at, finished_at, parent_message_id, error_message, created_at`;

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
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

export function createBotRunRecord(input: {
  botId: string;
  conversationId: string;
  triggerSource: BotRunTriggerSource;
  parentMessageId?: string | null;
}): BotRun {
  const run: BotRun = {
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
        id, bot_id, conversation_id, trigger_source, status, started_at, finished_at, parent_message_id, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      run.createdAt
    );

  return run;
}

export function getBotRun(runId: string): BotRun | null {
  const row = getDb()
    .prepare(`SELECT ${BOT_RUN_COLUMNS} FROM bot_runs WHERE id = ?`)
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

export function getLatestBotRun(botId: string): BotRun | null {
  const row = getDb()
    .prepare(`SELECT ${BOT_RUN_COLUMNS} FROM bot_runs WHERE bot_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(botId) as BotRunRow | undefined;
  return row ? rowToBotRun(row) : null;
}

export function deleteBotRun(runId: string) {
  getDb().prepare("DELETE FROM bot_runs WHERE id = ?").run(runId);
}

export function listRecentBotRuns(input: { userId?: string; limit?: number }): BotRun[] {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const rows = (input.userId
    ? getDb()
        .prepare(
          `SELECT r.${BOT_RUN_COLUMNS.split(", ").join(", r.")}
           FROM bot_runs r
           JOIN bots b ON b.id = r.bot_id
           WHERE b.user_id = ?
           ORDER BY r.created_at DESC, r.id DESC
           LIMIT ?`
        )
        .all(input.userId, limit)
    : getDb()
        .prepare(
          `SELECT ${BOT_RUN_COLUMNS} FROM bot_runs ORDER BY created_at DESC, id DESC LIMIT ?`
        )
        .all(limit)) as BotRunRow[];

  return rows.map(rowToBotRun);
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
