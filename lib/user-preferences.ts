import { getDb } from "@/lib/db";
import { normalizeMemoryRigor, type GlobalPreferences } from "@/lib/global-preferences";
import type { ConversationRetention, MemoryRigor } from "@/lib/types";

export type UserPreferences = {
  conversationRetention: ConversationRetention;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  memoriesRigor: MemoryRigor;
  mcpTimeout: number;
  maxAssistantToolSteps: number;
  confirmExternalLinks: boolean;
  updatedAt: string;
};

type UserPreferencesRow = {
  conversation_retention: ConversationRetention;
  memories_enabled: number;
  memories_max_count: number;
  memories_rigor: MemoryRigor;
  mcp_timeout: number;
  max_assistant_tool_steps: number;
  confirm_external_links: number;
  updated_at: string;
};

function ensureUserPreferences(userId: string, defaults: GlobalPreferences) {
  const timestamp = new Date().toISOString();
  getDb().prepare(`
    INSERT OR IGNORE INTO user_preferences (
      user_id, conversation_retention, memories_enabled, memories_max_count,
      memories_rigor, mcp_timeout, max_assistant_tool_steps, confirm_external_links, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    defaults.conversationRetention,
    defaults.memoriesEnabled ? 1 : 0,
    defaults.memoriesMaxCount,
    normalizeMemoryRigor(defaults.memoriesRigor),
    defaults.mcpTimeout,
    defaults.maxAssistantToolSteps,
    defaults.confirmExternalLinks ? 1 : 0,
    timestamp,
    timestamp
  );
}

export function getUserPreferences(userId: string, defaults: GlobalPreferences) {
  ensureUserPreferences(userId, defaults);
  const row = getDb().prepare(`
    SELECT conversation_retention, memories_enabled, memories_max_count,
      memories_rigor, mcp_timeout, max_assistant_tool_steps, confirm_external_links, updated_at
    FROM user_preferences
    WHERE user_id = ?
  `).get(userId) as UserPreferencesRow;
  return {
    conversationRetention: row.conversation_retention,
    memoriesEnabled: Boolean(row.memories_enabled),
    memoriesMaxCount: row.memories_max_count,
    memoriesRigor: normalizeMemoryRigor(row.memories_rigor),
    mcpTimeout: row.mcp_timeout,
    maxAssistantToolSteps: row.max_assistant_tool_steps,
    confirmExternalLinks: Boolean(row.confirm_external_links),
    updatedAt: row.updated_at
  } satisfies UserPreferences;
}

export function updateUserPreferences(
  userId: string,
  defaults: GlobalPreferences,
  input: Partial<UserPreferences>
) {
  const current = getUserPreferences(userId, defaults);
  const next = { ...current, ...input, updatedAt: new Date().toISOString() };
  getDb().prepare(`
    UPDATE user_preferences
    SET conversation_retention = ?, memories_enabled = ?,
      memories_max_count = ?, memories_rigor = ?, mcp_timeout = ?, max_assistant_tool_steps = ?,
      confirm_external_links = ?, updated_at = ?
    WHERE user_id = ?
  `).run(
    next.conversationRetention,
    next.memoriesEnabled ? 1 : 0,
    next.memoriesMaxCount,
    normalizeMemoryRigor(next.memoriesRigor),
    next.mcpTimeout,
    next.maxAssistantToolSteps,
    next.confirmExternalLinks ? 1 : 0,
    next.updatedAt,
    userId
  );
  return next;
}
