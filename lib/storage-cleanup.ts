import { deleteAttachmentById, deleteAttachmentFiles } from "@/lib/attachments";
import { deleteConversation } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getGlobalPreferences, type GlobalPreferences } from "@/lib/global-preferences";
import { getUserPreferences } from "@/lib/user-preferences";
import type { ConversationRetention } from "@/lib/types";

const RETENTION_DAYS: Record<Exclude<ConversationRetention, "forever">, number> = {
  "90d": 90,
  "30d": 30,
  "7d": 7
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const UNSENT_ATTACHMENT_TTL_MS = 7 * DAY_MS;

const STORAGE_CLEANUP_KEY = Symbol.for("eidon.storage-cleanup.started");
const INITIAL_DELAY_MS = 60_000;
const SWEEP_INTERVAL_MS = DAY_MS;

function cutoffIso(now: Date, ageMs: number) {
  return new Date(now.getTime() - ageMs).toISOString();
}

export function pruneUnsentAttachments(now = new Date()) {
  const rows = getDb()
    .prepare(
      "SELECT id FROM message_attachments WHERE message_id IS NULL AND created_at < ?"
    )
    .all(cutoffIso(now, UNSENT_ATTACHMENT_TTL_MS)) as { id: string }[];

  let prunedAttachments = 0;
  for (const row of rows) {
    try {
      if (deleteAttachmentById(row.id)) {
        prunedAttachments += 1;
      }
    } catch (error) {
      console.error(`Failed to prune unsent attachment ${row.id}:`, error);
    }
  }

  return { prunedAttachments };
}

function getUserRetentionResolver() {
  const defaults = getGlobalPreferences() as GlobalPreferences;
  const statement = getDb().prepare("SELECT id FROM users");
  const users = statement.all() as { id: string }[];
  return users.map((user) => ({
    userId: user.id,
    retention: getUserPreferences(user.id, defaults).conversationRetention
  }));
}

export function enforceConversationRetention(now = new Date()) {
  let prunedConversations = 0;

  for (const { userId, retention } of getUserRetentionResolver()) {
    const retentionDays = retention === "forever" ? null : RETENTION_DAYS[retention];
    if (retentionDays === null) {
      continue;
    }

    const conversations = getDb()
      .prepare(
        "SELECT id FROM conversations WHERE user_id = ? AND updated_at < ?"
      )
      .all(userId, cutoffIso(now, retentionDays * DAY_MS)) as { id: string }[];

    for (const conversation of conversations) {
      try {
        if (deleteConversation(conversation.id, userId)) {
          prunedConversations += 1;
        }
      } catch (error) {
        console.error(`Failed to prune conversation ${conversation.id}:`, error);
      }
    }
  }

  return { prunedConversations };
}

export function runStorageCleanup(now = new Date()) {
  const unsent = pruneUnsentAttachments(now);
  const retention = enforceConversationRetention(now);
  return { ...unsent, ...retention };
}

type SchedulerState = typeof globalThis & { [STORAGE_CLEANUP_KEY]?: boolean };

function getSchedulerState(): SchedulerState {
  return globalThis as SchedulerState;
}

export function startStorageCleanupScheduler() {
  const state = getSchedulerState();
  if (state[STORAGE_CLEANUP_KEY]) {
    return false;
  }
  state[STORAGE_CLEANUP_KEY] = true;

  const runSweep = () => {
    try {
      const result = runStorageCleanup();
      if (result.prunedAttachments || result.prunedConversations) {
        console.log(
          `Storage cleanup: pruned ${result.prunedAttachments} unsent attachments and ${result.prunedConversations} expired conversations`
        );
      }
    } catch (error) {
      console.error("Storage cleanup sweep failed:", error);
    }
  };

  const initialTimer = setTimeout(() => {
    runSweep();
    const interval = setInterval(runSweep, SWEEP_INTERVAL_MS);
    interval.unref();
  }, INITIAL_DELAY_MS);
  initialTimer.unref();

  return true;
}

export function resetStorageCleanupSchedulerForTests() {
  delete getSchedulerState()[STORAGE_CLEANUP_KEY];
}
