import { getDb } from "@/lib/db";
import type { ConversationRetention, TitleGenerationMode } from "@/lib/types";

export type GlobalPreferences = {
  defaultProviderProfileId: string | null;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  mcpTimeout: number;
  maxAssistantToolSteps: number;
  confirmExternalLinks: boolean;
  titleGenerationMode: TitleGenerationMode;
  titleGenerationProfileId: string | null;
  updatedAt: string;
};

type GlobalPreferencesRow = {
  default_provider_profile_id: string | null;
  skills_enabled: number;
  conversation_retention: ConversationRetention;
  memories_enabled: number;
  memories_max_count: number;
  mcp_timeout: number;
  max_assistant_tool_steps: number;
  confirm_external_links: number;
  title_generation_mode: TitleGenerationMode;
  title_generation_profile_id: string | null;
  updated_at: string;
};

function rowToPreferences(row: GlobalPreferencesRow): GlobalPreferences {
  return {
    defaultProviderProfileId: row.default_provider_profile_id,
    skillsEnabled: Boolean(row.skills_enabled),
    conversationRetention: row.conversation_retention,
    memoriesEnabled: Boolean(row.memories_enabled),
    memoriesMaxCount: row.memories_max_count,
    mcpTimeout: row.mcp_timeout,
    maxAssistantToolSteps: row.max_assistant_tool_steps,
    confirmExternalLinks: Boolean(row.confirm_external_links),
    titleGenerationMode: row.title_generation_mode,
    titleGenerationProfileId: row.title_generation_profile_id,
    updatedAt: row.updated_at
  };
}

export function getGlobalPreferences() {
  const row = getDb().prepare(`
    SELECT default_provider_profile_id, skills_enabled, conversation_retention,
      memories_enabled, memories_max_count, mcp_timeout,
      max_assistant_tool_steps, confirm_external_links, title_generation_mode,
      title_generation_profile_id, updated_at
    FROM global_preferences
    WHERE id = 1
  `).get() as GlobalPreferencesRow;
  return rowToPreferences(row);
}

export function updateGlobalPreferences(input: Partial<GlobalPreferences>) {
  const current = getGlobalPreferences();
  const next = { ...current, ...input, updatedAt: new Date().toISOString() };
  getDb().prepare(`
    UPDATE global_preferences
    SET default_provider_profile_id = ?, skills_enabled = ?,
      conversation_retention = ?, memories_enabled = ?,
      memories_max_count = ?, mcp_timeout = ?, max_assistant_tool_steps = ?,
      confirm_external_links = ?, title_generation_mode = ?,
      title_generation_profile_id = ?, updated_at = ?
    WHERE id = 1
  `).run(
    next.defaultProviderProfileId,
    next.skillsEnabled ? 1 : 0,
    next.conversationRetention,
    next.memoriesEnabled ? 1 : 0,
    next.memoriesMaxCount,
    next.mcpTimeout,
    next.maxAssistantToolSteps,
    next.confirmExternalLinks ? 1 : 0,
    next.titleGenerationMode,
    next.titleGenerationProfileId,
    next.updatedAt
  );
  return next;
}
