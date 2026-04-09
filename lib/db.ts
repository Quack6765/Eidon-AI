import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  DEFAULT_PROVIDER_PROFILE_NAME,
  DEFAULT_PROVIDER_SETTINGS,
  DEFAULT_SKILLS_ENABLED,
  SETTINGS_ROW_ID
} from "@/lib/constants";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";

const BUILTIN_AGENT_BROWSER_SKILL = {
  id: "builtin-agent-browser",
  name: "Agent Browser",
  description:
    "Use for web browsing, page inspection, form interaction, screenshots, and browser-based testing tasks.",
  content: `---
name: Agent Browser
description: Use for web browsing, page inspection, form interaction, screenshots, and browser-based testing tasks.
shell_command_prefixes:
  - agent-browser
---

# Agent Browser

A fast headless browser automation CLI for AI agents. Use it for any web browsing task.

## Commands

- \`agent-browser open <url>\` — Navigate to URL
- \`agent-browser click <sel>\` — Click element (use @ref from snapshot)
- \`agent-browser fill <sel> <text>\` — Clear and fill input
- \`agent-browser type <sel> <text>\` — Type into element
- \`agent-browser press <key>\` — Press key (Enter, Tab, Control+a)
- \`agent-browser snapshot\` — Get accessibility tree with refs (best for AI understanding)
- \`agent-browser screenshot [path]\` — Take screenshot (--full for full page)
- \`agent-browser eval <js>\` — Run JavaScript
- \`agent-browser scroll <dir> [px]\` — Scroll (up/down/left/right)
- \`agent-browser hover <sel>\` — Hover element
- \`agent-browser select <sel> <val>\` — Select dropdown option
- \`agent-browser get text <sel>\` — Get text content of element
- \`agent-browser close\` — Close browser

## When to Use

Use agent-browser for ALL web browsing tasks including:
- Reading web pages and articles
- Filling forms and logging in
- Clicking buttons and navigating
- Taking screenshots
- Scraping data
- Testing web applications

Always use \`snapshot\` after \`open\` or any interaction to understand the page state. Use refs (@e1, @e2) from snapshots for clicking and filling.

## Important

- Always close the browser when done: \`agent-browser close\`
- Use snapshot + refs for reliable element interaction
- For screenshots, save to /tmp/ and use the path`
};

let database: Database.Database | null = null;

function deriveSkillDescription(content: string) {
  const metadata = parseSkillContentMetadata(content);

  if (metadata.description?.trim()) {
    return metadata.description.trim().slice(0, 240);
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }

    return line.slice(0, 240);
  }

  return "Reusable skill instructions.";
}

function getDatabasePath() {
  const dir = path.resolve(env.EIDON_DATA_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "eidon.db");
}

function migrate(db: Database.Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_provider_profile_id TEXT,
      api_base_url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      model TEXT NOT NULL,
      api_mode TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      skills_enabled INTEGER NOT NULL DEFAULT 1,
      temperature REAL NOT NULL,
      max_output_tokens INTEGER NOT NULL,
      reasoning_effort TEXT NOT NULL,
      reasoning_summary_enabled INTEGER NOT NULL,
      model_context_limit INTEGER NOT NULL,
      compaction_threshold REAL NOT NULL,
      fresh_tail_count INTEGER NOT NULL,
      mcp_timeout INTEGER NOT NULL DEFAULT 120000,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_base_url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      model TEXT NOT NULL,
      api_mode TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      temperature REAL NOT NULL,
      max_output_tokens INTEGER NOT NULL,
      reasoning_effort TEXT NOT NULL,
      reasoning_summary_enabled INTEGER NOT NULL,
      model_context_limit INTEGER NOT NULL,
      compaction_threshold REAL NOT NULL,
      fresh_tail_count INTEGER NOT NULL,
      tokenizer_model TEXT DEFAULT 'gpt-tokenizer',
      safety_margin_tokens INTEGER DEFAULT 1200,
      leaf_source_token_limit INTEGER DEFAULT 12000,
      leaf_min_message_count INTEGER DEFAULT 6,
      merged_min_node_count INTEGER DEFAULT 4,
      merged_target_tokens INTEGER DEFAULT 1600,
      vision_mode TEXT NOT NULL DEFAULT 'native',
      vision_mcp_server_id TEXT,
      provider_kind TEXT NOT NULL DEFAULT 'openai_compatible',
      github_user_access_token_encrypted TEXT NOT NULL DEFAULT '',
      github_refresh_token_encrypted TEXT NOT NULL DEFAULT '',
      github_token_expires_at TEXT,
      github_refresh_token_expires_at TEXT,
      github_account_login TEXT,
      github_account_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_generation_status TEXT NOT NULL DEFAULT 'completed',
      folder_id TEXT,
      provider_profile_id TEXT,
      tool_execution_mode TEXT NOT NULL DEFAULT 'read_only',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
      FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      thinking_content TEXT NOT NULL,
      status TEXT NOT NULL,
      estimated_tokens INTEGER NOT NULL DEFAULT 0,
      system_kind TEXT,
      compacted_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS memory_nodes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      type TEXT NOT NULL,
      depth INTEGER NOT NULL,
      content TEXT NOT NULL,
      source_start_message_id TEXT NOT NULL,
      source_end_message_id TEXT NOT NULL,
      source_token_count INTEGER NOT NULL,
      summary_token_count INTEGER NOT NULL,
      child_node_ids TEXT NOT NULL,
      superseded_by_node_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS compaction_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      source_start_message_id TEXT NOT NULL,
      source_end_message_id TEXT NOT NULL,
      notice_message_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (notice_message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      headers TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS message_actions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      server_id TEXT,
      skill_id TEXT,
      tool_name TEXT,
      label TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      arguments_json TEXT,
      result_summary TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS message_text_segments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      extracted_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      provider_profile_id TEXT NOT NULL,
      persona_id TEXT,
      schedule_kind TEXT NOT NULL,
      interval_minutes INTEGER,
      calendar_frequency TEXT,
      time_of_day TEXT,
      days_of_week TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      last_scheduled_for TEXT,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      conversation_id TEXT,
      scheduled_for TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      trigger_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );
  `);

  const convCols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  const convColNames = convCols.map((c) => c.name);
  if (!convColNames.includes("folder_id")) {
    db.exec("ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL");
  }
  if (!convColNames.includes("sort_order")) {
    db.exec("ALTER TABLE conversations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }
  if (!convColNames.includes("provider_profile_id")) {
    db.exec(
      "ALTER TABLE conversations ADD COLUMN provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE SET NULL"
    );
  }
  if (!convColNames.includes("title_generation_status")) {
    db.exec(
      "ALTER TABLE conversations ADD COLUMN title_generation_status TEXT NOT NULL DEFAULT 'completed'"
    );
  }
  if (!convColNames.includes("tool_execution_mode")) {
    db.exec(
      `ALTER TABLE conversations ADD COLUMN tool_execution_mode TEXT NOT NULL DEFAULT 'read_write'`
    );
  }
  if (!convColNames.includes("is_active")) {
    db.exec("ALTER TABLE conversations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0");
  }

  const automationConversationCols = db
    .prepare("PRAGMA table_info(conversations)")
    .all() as Array<{ name: string }>;
  if (!automationConversationCols.some((col) => col.name === "automation_id")) {
    db.exec(
      "ALTER TABLE conversations ADD COLUMN automation_id TEXT REFERENCES automations(id) ON DELETE SET NULL"
    );
  }
  if (!automationConversationCols.some((col) => col.name === "automation_run_id")) {
    db.exec(
      "ALTER TABLE conversations ADD COLUMN automation_run_id TEXT REFERENCES automation_runs(id) ON DELETE SET NULL"
    );
  }
  if (!automationConversationCols.some((col) => col.name === "conversation_origin")) {
    db.exec(
      "ALTER TABLE conversations ADD COLUMN conversation_origin TEXT NOT NULL DEFAULT 'manual'"
    );
  }

  const settingsCols = db.prepare("PRAGMA table_info(app_settings)").all() as Array<{ name: string }>;
  const settingsColNames = settingsCols.map((c) => c.name);
  if (!settingsColNames.includes("default_provider_profile_id")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN default_provider_profile_id TEXT");
  }
  if (!settingsColNames.includes("skills_enabled")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN skills_enabled INTEGER NOT NULL DEFAULT 1");
  }
  if (!settingsColNames.includes("conversation_retention")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN conversation_retention TEXT NOT NULL DEFAULT 'forever'");
  }
  if (!settingsColNames.includes("auto_compaction")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN auto_compaction INTEGER NOT NULL DEFAULT 1");
  }
  if (!settingsColNames.includes("memories_enabled")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN memories_enabled INTEGER NOT NULL DEFAULT 1");
  }
  if (!settingsColNames.includes("memories_max_count")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN memories_max_count INTEGER NOT NULL DEFAULT 100");
  }
  if (!settingsColNames.includes("mcp_timeout")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN mcp_timeout INTEGER NOT NULL DEFAULT 120000");
  }

  const mcpCols = db.prepare("PRAGMA table_info(mcp_servers)").all() as Array<{ name: string }>;
  const mcpColNames = mcpCols.map((c) => c.name);
  if (!mcpColNames.includes("transport")) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN transport TEXT NOT NULL DEFAULT 'streamable_http'");
  }
  if (!mcpColNames.includes("command")) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN command TEXT");
  }
  if (!mcpColNames.includes("args")) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN args TEXT");
  }
  if (!mcpColNames.includes("env")) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN env TEXT");
  }

  const skillCols = db.prepare("PRAGMA table_info(skills)").all() as Array<{ name: string }>;
  const skillColNames = skillCols.map((c) => c.name);
  if (!skillColNames.includes("description")) {
    db.exec("ALTER TABLE skills ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }

  const profileCols = db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>;
  const profileColNames = profileCols.map((c) => c.name);
  const newProfileCols = {
    tokenizer_model: "TEXT DEFAULT 'gpt-tokenizer'",
    safety_margin_tokens: "INTEGER DEFAULT 1200",
    leaf_source_token_limit: "INTEGER DEFAULT 12000",
    leaf_min_message_count: "INTEGER DEFAULT 6",
    merged_min_node_count: "INTEGER DEFAULT 4",
    merged_target_tokens: "INTEGER DEFAULT 1600"
  };
  for (const [colName, colDef] of Object.entries(newProfileCols)) {
    if (!profileColNames.includes(colName)) {
      db.exec(`ALTER TABLE provider_profiles ADD COLUMN ${colName} ${colDef}`);
    }
  }

  const visionProfileCols = {
    vision_mode: "TEXT NOT NULL DEFAULT 'native'",
    vision_mcp_server_id: "TEXT"
  };
  for (const [colName, colDef] of Object.entries(visionProfileCols)) {
    if (!profileColNames.includes(colName)) {
      db.exec(`ALTER TABLE provider_profiles ADD COLUMN ${colName} ${colDef}`);
    }
  }

  const githubCols = {
    provider_kind: "TEXT NOT NULL DEFAULT 'openai_compatible'",
    github_user_access_token_encrypted: "TEXT NOT NULL DEFAULT ''",
    github_refresh_token_encrypted: "TEXT NOT NULL DEFAULT ''",
    github_token_expires_at: "TEXT",
    github_refresh_token_expires_at: "TEXT",
    github_account_login: "TEXT",
    github_account_name: "TEXT"
  };
  const githubProfileCols = db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>;
  const githubProfileColNames = githubProfileCols.map((c) => c.name);
  for (const [colName, colDef] of Object.entries(githubCols)) {
    if (!githubProfileColNames.includes(colName)) {
      db.exec(`ALTER TABLE provider_profiles ADD COLUMN ${colName} ${colDef}`);
    }
  }

  try {
    db.exec(`ALTER TABLE compaction_events RENAME TO compaction_events_old`);
    db.exec(`
      CREATE TABLE compaction_events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        source_start_message_id TEXT NOT NULL,
        source_end_message_id TEXT NOT NULL,
        notice_message_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (source_start_message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (source_end_message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);
    db.exec(`INSERT INTO compaction_events SELECT * FROM compaction_events_old`);
    db.exec(`DROP TABLE compaction_events_old`);
  } catch {
    // Already migrated or table doesn't exist yet
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_folder ON conversations(folder_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_messages_compacted_at ON messages(conversation_id, compacted_at);
    CREATE INDEX IF NOT EXISTS idx_automations_enabled_next_run_at ON automations(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_scheduled_for ON automation_runs(automation_id, scheduled_for DESC);
    CREATE INDEX IF NOT EXISTS idx_automation_runs_status_scheduled_for ON automation_runs(status, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_message_actions_message_sort_order ON message_actions(message_id, sort_order, started_at);
    CREATE INDEX IF NOT EXISTS idx_message_text_segments_message_sort_order ON message_text_segments(message_id, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_message_created_at ON message_attachments(message_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_conversation_created_at ON message_attachments(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_memory_nodes_conversation_depth ON memory_nodes(conversation_id, depth, created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_nodes_superseded ON memory_nodes(conversation_id, superseded_by_node_id);
    CREATE INDEX IF NOT EXISTS idx_folders_sort_order ON folders(sort_order);
    CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(category);
  `);

  const existingSkills = db
    .prepare("SELECT id, name, content, description FROM skills")
    .all() as Array<{ id: string; name: string; content: string; description: string }>;
  const updateSkillMetadata = db.prepare("UPDATE skills SET name = ?, description = ? WHERE id = ?");

  for (const skill of existingSkills) {
    const metadata = parseSkillContentMetadata(skill.content);
    const nextName = metadata.name?.trim() || skill.name;
    const nextDescription = metadata.description?.trim() || skill.description.trim() || deriveSkillDescription(skill.content);

    if (nextName !== skill.name || nextDescription !== skill.description) {
      updateSkillMetadata.run(nextName, nextDescription, skill.id);
    }
  }

  db.prepare(
    `INSERT OR IGNORE INTO app_settings (
      id,
      default_provider_profile_id,
      api_base_url,
      api_key_encrypted,
      model,
      api_mode,
      system_prompt,
      skills_enabled,
      temperature,
      max_output_tokens,
      reasoning_effort,
      reasoning_summary_enabled,
      model_context_limit,
      compaction_threshold,
      fresh_tail_count,
      updated_at
    ) VALUES (
      @id,
      '',
      @apiBaseUrl,
      '',
      @model,
      @apiMode,
      @systemPrompt,
      @skillsEnabled,
      @temperature,
      @maxOutputTokens,
      @reasoningEffort,
      @reasoningSummaryEnabled,
      @modelContextLimit,
      @compactionThreshold,
      @freshTailCount,
      @updatedAt
    )`
  ).run({
    id: SETTINGS_ROW_ID,
    ...DEFAULT_PROVIDER_SETTINGS,
    skillsEnabled: DEFAULT_SKILLS_ENABLED ? 1 : 0,
    reasoningSummaryEnabled: DEFAULT_PROVIDER_SETTINGS.reasoningSummaryEnabled ? 1 : 0,
    updatedAt: new Date().toISOString()
  });

  const appSettingsRow = db
    .prepare(
      `SELECT
        default_provider_profile_id,
        api_base_url,
        api_key_encrypted,
        model,
        api_mode,
        system_prompt,
        skills_enabled,
        temperature,
        max_output_tokens,
        reasoning_effort,
        reasoning_summary_enabled,
        model_context_limit,
        compaction_threshold,
        fresh_tail_count,
        updated_at
      FROM app_settings
      WHERE id = ?`
    )
    .get(SETTINGS_ROW_ID) as {
    default_provider_profile_id: string | null;
    api_base_url: string;
    api_key_encrypted: string;
    model: string;
    api_mode: string;
    system_prompt: string;
    skills_enabled: number;
    temperature: number;
    max_output_tokens: number;
    reasoning_effort: string;
    reasoning_summary_enabled: number;
    model_context_limit: number;
    compaction_threshold: number;
    fresh_tail_count: number;
    updated_at: string;
  };

  const profileCount = (
    db.prepare("SELECT COUNT(*) as count FROM provider_profiles").get() as { count: number }
  ).count;

  if (profileCount === 0) {
    const profileId = createId("profile");
    db.prepare(
      `INSERT INTO provider_profiles (
        id,
        name,
        api_base_url,
        api_key_encrypted,
        model,
        api_mode,
        system_prompt,
        temperature,
        max_output_tokens,
        reasoning_effort,
        reasoning_summary_enabled,
        model_context_limit,
        compaction_threshold,
        fresh_tail_count,
        tokenizer_model,
        safety_margin_tokens,
        leaf_source_token_limit,
        leaf_min_message_count,
        merged_min_node_count,
        merged_target_tokens,
        provider_kind,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @name,
        @apiBaseUrl,
        @apiKeyEncrypted,
        @model,
        @apiMode,
        @systemPrompt,
        @temperature,
        @maxOutputTokens,
        @reasoningEffort,
        @reasoningSummaryEnabled,
        @modelContextLimit,
        @compactionThreshold,
        @freshTailCount,
        @tokenizerModel,
        @safetyMarginTokens,
        @leafSourceTokenLimit,
        @leafMinMessageCount,
        @mergedMinNodeCount,
        @mergedTargetTokens,
        'openai_compatible',
        @createdAt,
        @updatedAt
      )`
    ).run({
      id: profileId,
      name: DEFAULT_PROVIDER_PROFILE_NAME,
      apiBaseUrl: appSettingsRow.api_base_url,
      apiKeyEncrypted: appSettingsRow.api_key_encrypted,
      model: appSettingsRow.model,
      apiMode: appSettingsRow.api_mode,
      systemPrompt: appSettingsRow.system_prompt,
      temperature: appSettingsRow.temperature,
      maxOutputTokens: appSettingsRow.max_output_tokens,
      reasoningEffort: appSettingsRow.reasoning_effort,
      reasoningSummaryEnabled: appSettingsRow.reasoning_summary_enabled,
      modelContextLimit: appSettingsRow.model_context_limit,
      compactionThreshold: appSettingsRow.compaction_threshold,
      freshTailCount: appSettingsRow.fresh_tail_count,
      tokenizerModel: "gpt-tokenizer",
      safetyMarginTokens: 1200,
      leafSourceTokenLimit: 12000,
      leafMinMessageCount: 6,
      mergedMinNodeCount: 4,
      mergedTargetTokens: 1600,
      createdAt: appSettingsRow.updated_at,
      updatedAt: appSettingsRow.updated_at
    });
  }

  const defaultProfileRow = db
    .prepare(
      `SELECT id
       FROM provider_profiles
       WHERE id = ?
       LIMIT 1`
    )
    .get(appSettingsRow.default_provider_profile_id) as { id: string } | undefined;

  const resolvedDefaultProfileId =
    defaultProfileRow?.id ??
    (
      db.prepare(
        `SELECT id
         FROM provider_profiles
         ORDER BY created_at ASC
         LIMIT 1`
      ).get() as { id: string }
    ).id;

  db.prepare(
    `UPDATE app_settings
     SET default_provider_profile_id = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(resolvedDefaultProfileId, new Date().toISOString(), SETTINGS_ROW_ID);

  db.prepare(
    `UPDATE conversations
     SET provider_profile_id = ?
     WHERE provider_profile_id IS NULL`
  ).run(resolvedDefaultProfileId);

  db.prepare(
    `UPDATE conversations
     SET title_generation_status = 'completed'
     WHERE COALESCE(title_generation_status, '') = ''`
  ).run();

  const builtinSkills = [BUILTIN_AGENT_BROWSER_SKILL];
  const upsertSkill = db.prepare(
    `INSERT INTO skills (id, name, description, content, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       content = excluded.content`
  );
  const now = new Date().toISOString();
  for (const skill of builtinSkills) {
    upsertSkill.run(skill.id, skill.name, skill.description, skill.content, now, now);
  }
}

export function getDb() {
  if (!database) {
    database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    migrate(database);
  }

  return database;
}

export function resetDbForTests() {
  if (database) {
    database.close();
    database = null;
  }
}
