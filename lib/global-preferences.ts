import { getDb } from "@/lib/db";
import type {
  ConversationRetention,
  MemoryRigor,
  TitleGenerationMode,
  ToolCallDisplayMode
} from "@/lib/types";

export function normalizeMemoryRigor(value: unknown): MemoryRigor {
  return value === "low" || value === "high" ? value : "balanced";
}

export function normalizeToolCallDisplayMode(value: unknown): ToolCallDisplayMode {
  return value === "status_line" ? value : "pills";
}

export type GlobalPreferences = {
  defaultProviderProfileId: string | null;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  memoriesRigor: MemoryRigor;
  semanticRecallEnabled: boolean;
  mcpTimeout: number;
  maxAssistantToolSteps: number;
  confirmExternalLinks: boolean;
  toolCallDisplay: ToolCallDisplayMode;
  titleGenerationMode: TitleGenerationMode;
  titleGenerationProfileId: string | null;
  speechCleanupEnabled: boolean;
  speechCleanupProfileId: string | null;
  speechCleanupPrompt: string;
  updatedAt: string;
};

type GlobalPreferencesRow = {
  default_provider_profile_id: string | null;
  skills_enabled: number;
  conversation_retention: ConversationRetention;
  memories_enabled: number;
  memories_max_count: number;
  memories_rigor: MemoryRigor;
  semantic_recall_enabled: number;
  mcp_timeout: number;
  max_assistant_tool_steps: number;
  confirm_external_links: number;
  tool_call_display: ToolCallDisplayMode;
  title_generation_mode: TitleGenerationMode;
  title_generation_profile_id: string | null;
  speech_cleanup_enabled: number;
  speech_cleanup_profile_id: string | null;
  speech_cleanup_prompt: string;
  updated_at: string;
};

function rowToPreferences(row: GlobalPreferencesRow): GlobalPreferences {
  return {
    defaultProviderProfileId: row.default_provider_profile_id,
    skillsEnabled: Boolean(row.skills_enabled),
    conversationRetention: row.conversation_retention,
    memoriesEnabled: Boolean(row.memories_enabled),
    memoriesMaxCount: row.memories_max_count,
    memoriesRigor: normalizeMemoryRigor(row.memories_rigor),
    semanticRecallEnabled: Boolean(row.semantic_recall_enabled),
    mcpTimeout: row.mcp_timeout,
    maxAssistantToolSteps: row.max_assistant_tool_steps,
    confirmExternalLinks: Boolean(row.confirm_external_links),
    toolCallDisplay: normalizeToolCallDisplayMode(row.tool_call_display),
    titleGenerationMode: row.title_generation_mode,
    titleGenerationProfileId: row.title_generation_profile_id,
    speechCleanupEnabled: Boolean(row.speech_cleanup_enabled),
    speechCleanupProfileId: row.speech_cleanup_profile_id,
    speechCleanupPrompt: row.speech_cleanup_prompt ?? "",
    updatedAt: row.updated_at
  };
}

export function getGlobalPreferences() {
  const row = getDb().prepare(`
    SELECT default_provider_profile_id, skills_enabled, conversation_retention,
      memories_enabled, memories_max_count, memories_rigor, semantic_recall_enabled, mcp_timeout,
      max_assistant_tool_steps, confirm_external_links, tool_call_display,
      title_generation_mode, title_generation_profile_id,
      speech_cleanup_enabled, speech_cleanup_profile_id, speech_cleanup_prompt,
      updated_at
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
      memories_max_count = ?, memories_rigor = ?, semantic_recall_enabled = ?, mcp_timeout = ?,
      max_assistant_tool_steps = ?, confirm_external_links = ?, tool_call_display = ?, title_generation_mode = ?,
      title_generation_profile_id = ?, speech_cleanup_enabled = ?,
      speech_cleanup_profile_id = ?, speech_cleanup_prompt = ?, updated_at = ?
    WHERE id = 1
  `).run(
    next.defaultProviderProfileId,
    next.skillsEnabled ? 1 : 0,
    next.conversationRetention,
    next.memoriesEnabled ? 1 : 0,
    next.memoriesMaxCount,
    normalizeMemoryRigor(next.memoriesRigor),
    next.semanticRecallEnabled ? 1 : 0,
    next.mcpTimeout,
    next.maxAssistantToolSteps,
    next.confirmExternalLinks ? 1 : 0,
    normalizeToolCallDisplayMode(next.toolCallDisplay),
    next.titleGenerationMode,
    next.titleGenerationProfileId,
    next.speechCleanupEnabled ? 1 : 0,
    next.speechCleanupProfileId,
    next.speechCleanupPrompt,
    next.updatedAt
  );
  return next;
}
