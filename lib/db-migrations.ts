import Database from "better-sqlite3";

import {
  DEFAULT_SKILLS_ENABLED,
  SETTINGS_ROW_ID
} from "@/lib/constants";
import {
  createProviderProfileDraft,
  DEFAULT_PROFILE_BEHAVIOR
} from "@/lib/provider-catalog";
import { createId } from "@/lib/ids";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { BUILTIN_AGENT_BROWSER_SKILL, deriveSkillDescription } from "@/lib/db-builtin-skills";
import {
  DEFAULT_EXTERNAL_STT_LANGUAGE,
  DEFAULT_EXTERNAL_STT_PROVIDER
} from "@/lib/speech/external-providers";
import { normalizeImageGenerationSelection } from "@/lib/image-generation/catalog";
import { normalizeTranscriptionSelection } from "@/lib/speech/transcription-catalog";
import { normalizeWebSearchSelection } from "@/lib/web-search-catalog";

const COMPACTION_EVENTS_TABLE_SQL = `
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
`;

const BOT_AVATARS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS bot_avatars (
    seed TEXT NOT NULL,
    style TEXT NOT NULL,
    variant TEXT NOT NULL,
    svg TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (seed, style, variant)
  );
`;

const BASELINE_SCHEMA_SQL = `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT NOT NULL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      auth_source TEXT NOT NULL,
      password_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
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
      purpose TEXT NOT NULL DEFAULT 'browser',
      device_name TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS provider_connection_flows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES provider_profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mcp_server_connections (
      server_id TEXT NOT NULL PRIMARY KEY,
      credentials_encrypted TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mcp_oauth_flows (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      payload_encrypted TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      vision_provider_profile_id TEXT,
      provider_kind TEXT NOT NULL DEFAULT 'openai_compatible',
      github_user_access_token_encrypted TEXT NOT NULL DEFAULT '',
      github_refresh_token_encrypted TEXT NOT NULL DEFAULT '',
      github_token_expires_at TEXT,
      github_refresh_token_expires_at TEXT,
      github_account_login TEXT,
      github_account_name TEXT,
      github_oauth_nonce TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_generation_status TEXT NOT NULL DEFAULT 'completed',
      user_id TEXT,
      folder_id TEXT,
      provider_profile_id TEXT,
      reasoning_effort TEXT,
      tool_execution_mode TEXT NOT NULL DEFAULT 'read_only',
      share_token TEXT UNIQUE,
      share_enabled INTEGER NOT NULL DEFAULT 0,
      shared_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
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
    CREATE TABLE IF NOT EXISTS queued_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sort_order INTEGER NOT NULL,
      failure_message TEXT,
      mode TEXT NOT NULL DEFAULT 'chat',
      processing_started_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
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
      slug TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      headers TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_vision_mcp INTEGER NOT NULL DEFAULT 0,
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
      proposal_state TEXT,
      proposal_payload_json TEXT,
      proposal_updated_at TEXT,
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
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS user_memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tool_approval_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      scope TEXT NOT NULL,
      family TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tool_approval_rules_owner
      ON tool_approval_rules (user_id, scope, family);
    CREATE TABLE IF NOT EXISTS vault_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      origin TEXT,
      username TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      secret_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      UNIQUE (user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      provider_profile_id TEXT NOT NULL,
      persona_id TEXT,
      user_id TEXT,
      schedule_kind TEXT NOT NULL,
      interval_minutes INTEGER,
      calendar_frequency TEXT,
      time_of_day TEXT,
      days_of_week TEXT NOT NULL DEFAULT '[]',
      continue_previous_conversation INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      last_scheduled_for TEXT,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      result_message_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_success_at TEXT,
      last_error_at TEXT,
      disabled_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      avatar_seed TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      is_chief INTEGER NOT NULL DEFAULT 0,
      home_conversation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (home_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bot_runs (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      parent_message_id TEXT,
      error_message TEXT,
      prompt TEXT,
      reply_conversation_id TEXT,
      reply_action_id TEXT,
      pending_reply TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS migration_flags (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
`;

const LEGACY_SETTINGS_TABLES_SQL = `
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
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT NOT NULL PRIMARY KEY,
        default_provider_profile_id TEXT,
        skills_enabled INTEGER NOT NULL DEFAULT 1,
        conversation_retention TEXT NOT NULL DEFAULT 'forever',
        auto_compaction INTEGER NOT NULL DEFAULT 1,
        memories_enabled INTEGER NOT NULL DEFAULT 1,
        memories_max_count INTEGER NOT NULL DEFAULT 100,
        mcp_timeout INTEGER NOT NULL DEFAULT 120000,
        stt_engine TEXT NOT NULL DEFAULT 'browser',
        stt_provider TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_STT_PROVIDER}',
        stt_language TEXT NOT NULL DEFAULT 'auto',
        external_stt_language TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_STT_LANGUAGE}',
        external_stt_api_key_encrypted TEXT NOT NULL DEFAULT '',
        web_search_engine TEXT NOT NULL DEFAULT 'exa',
        exa_api_key_encrypted TEXT NOT NULL DEFAULT '',
        tavily_api_key_encrypted TEXT NOT NULL DEFAULT '',
        searxng_base_url TEXT NOT NULL DEFAULT '',
        max_assistant_tool_steps INTEGER NOT NULL DEFAULT 25,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (default_provider_profile_id) REFERENCES provider_profiles(id) ON DELETE SET NULL
      );
`;

function tableExists(db: Database.Database, tableName: string) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  );
}

function tableColumns(db: Database.Database, tableName: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );
}

function hasColumns(db: Database.Database, tableName: string, columnNames: string[]) {
  const columns = tableColumns(db, tableName);
  return columnNames.every((columnName) => columns.has(columnName));
}

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columnName: string,
  columnDefinition: string
) {
  if (tableColumns(db, tableName).has(columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

function legacySettingsMigrated(db: Database.Database) {
  return (
    tableExists(db, "global_preferences") &&
    tableExists(db, "user_preferences") &&
    tableExists(db, "integration_settings")
  );
}

function decryptLegacyCredential(value: string | null | undefined) {
  if (!value) return "";
  try {
    return decryptValue(value);
  } catch {
    return "";
  }
}

function runLoggedDataMigration(db: Database.Database, label: string, runMigration: (db: Database.Database) => void) {
  console.log(`[db] ${label}...`);
  const startedAt = Date.now();
  runMigration(db);
  console.log(`[db] ${label} done in ${Date.now() - startedAt}ms`);
}

function savedLoginHost(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function migrateSavedLoginsToVault(db: Database.Database) {
  if (!tableExists(db, "saved_logins")) return;
  const rows = db
    .prepare(
      "SELECT id, user_id, origin, label, secret_encrypted, created_at, updated_at, last_used_at FROM saved_logins ORDER BY created_at"
    )
    .all() as Array<{
    id: string;
    user_id: string;
    origin: string;
    label: string;
    secret_encrypted: string;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
  }>;
  const takenNames = new Map<string, Set<string>>();
  const namesFor = (userId: string) => {
    let names = takenNames.get(userId);
    if (!names) {
      const existing = db.prepare("SELECT name FROM vault_entries WHERE user_id = ?").all(userId) as Array<{ name: string }>;
      names = new Set(existing.map((row) => row.name.toLowerCase()));
      takenNames.set(userId, names);
    }
    return names;
  };
  const insert = db.prepare(
    `INSERT INTO vault_entries (id, user_id, name, origin, secret_encrypted, created_at, updated_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    for (const row of rows) {
      const names = namesFor(row.user_id);
      const base = `${savedLoginHost(row.origin)} ${row.label}`.slice(0, 90);
      let name = base;
      for (let copy = 2; names.has(name.toLowerCase()); copy += 1) name = `${base} (${copy})`;
      names.add(name.toLowerCase());
      insert.run(row.id, row.user_id, name, row.origin, row.secret_encrypted, row.created_at, row.updated_at, row.last_used_at);
    }
    db.exec("DROP TABLE saved_logins");
  })();
}

function migrateProviderConnectionStorage(db: Database.Database) {
  if (!tableExists(db, "provider_profile_connections")) return;
  const columns = db.prepare("PRAGMA table_info(provider_profile_connections)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "provider_kind")) return;

  console.log("[db] Migrating provider connection storage...");
  const startedAt = Date.now();
  db.pragma("foreign_keys = OFF");
  try {
    const transaction = db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS provider_profile_connections_new;
        CREATE TABLE provider_profile_connections_new (
          profile_id TEXT PRIMARY KEY,
          credentials_encrypted TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          oauth_nonce TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (profile_id) REFERENCES provider_profiles(id) ON DELETE CASCADE
        );
        INSERT INTO provider_profile_connections_new (
          profile_id, credentials_encrypted, metadata_json,
          oauth_nonce, created_at, updated_at
        )
        SELECT profile_id, credentials_encrypted, metadata_json,
          oauth_nonce, created_at, updated_at
        FROM provider_profile_connections;
        DROP TABLE provider_profile_connections;
        ALTER TABLE provider_profile_connections_new RENAME TO provider_profile_connections;
      `);
    });
    transaction.immediate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  console.log(`[db] Provider connection storage migration done in ${Date.now() - startedAt}ms`);
}

function migrateProviderRequestConfiguration(db: Database.Database) {
  db.prepare(`
    UPDATE provider_profiles
    SET provider_config_json = json_set(
      json_set(
        CASE WHEN json_valid(provider_config_json) THEN provider_config_json ELSE '{}' END,
        '$.processingMode',
        CASE
          WHEN json_extract(provider_config_json, '$.processingMode') = 'fast' THEN 'fast'
          ELSE 'standard'
        END
      ),
      '$.reasoningParameterMode',
      CASE
        WHEN json_extract(provider_config_json, '$.reasoningParameterMode') = 'mirrored'
          THEN 'mirrored'
        WHEN json_extract(provider_config_json, '$.reasoningParameterMode') = 'standard'
          THEN 'standard'
        WHEN provider_preset_id = 'ollama_cloud' THEN 'mirrored'
        ELSE 'standard'
      END
    )
    WHERE provider_kind = 'openai_compatible'
      AND (
        json_extract(provider_config_json, '$.processingMode') IS NULL OR
        json_extract(provider_config_json, '$.reasoningParameterMode') IS NULL
      )
  `).run();
  db.prepare(`
    UPDATE provider_profiles
    SET provider_preset_id = 'openai_official'
    WHERE provider_preset_id = 'custom_openai_compatible'
  `).run();
}

function migrateProviderStorageTables(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>;
  if (
    columns.some((column) => column.name === "provider_config_json") &&
    tableExists(db, "provider_profile_connections") &&
    tableExists(db, "provider_connection_flows")
  ) {
    migrateProviderConnectionStorage(db);
    return;
  }

  console.log("[db] Migrating provider storage from legacy schema...");
  const legacyStartedAt = Date.now();
  const rows = db.prepare("SELECT * FROM provider_profiles").all() as Array<Record<string, unknown>>;
  const flowRows = tableExists(db, "mobile_github_oauth_flows")
    ? db.prepare("SELECT * FROM mobile_github_oauth_flows").all() as Array<Record<string, unknown>>
    : [];

  db.pragma("foreign_keys = OFF");
  try {
    const transaction = db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS provider_profiles_new;
        DROP TABLE IF EXISTS provider_profile_connections_new;
        DROP TABLE IF EXISTS provider_connection_flows_new;
        CREATE TABLE provider_profiles_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider_kind TEXT NOT NULL,
          provider_config_json TEXT NOT NULL,
          model TEXT NOT NULL,
          system_prompt TEXT NOT NULL,
          temperature REAL NOT NULL,
          max_output_tokens INTEGER NOT NULL,
          reasoning_effort TEXT NOT NULL,
          reasoning_summary_enabled INTEGER NOT NULL,
          model_context_limit INTEGER NOT NULL,
          compaction_threshold REAL NOT NULL,
          fresh_tail_count INTEGER NOT NULL,
          tokenizer_model TEXT NOT NULL,
          safety_margin_tokens INTEGER NOT NULL,
          leaf_source_token_limit INTEGER NOT NULL,
          leaf_min_message_count INTEGER NOT NULL,
          merged_min_node_count INTEGER NOT NULL,
          merged_target_tokens INTEGER NOT NULL,
          vision_mode TEXT NOT NULL,
          vision_provider_profile_id TEXT,
          provider_preset_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE provider_profile_connections_new (
          profile_id TEXT PRIMARY KEY,
          credentials_encrypted TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          oauth_nonce TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (profile_id) REFERENCES provider_profiles(id) ON DELETE CASCADE
        );
        CREATE TABLE provider_connection_flows_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          profile_id TEXT NOT NULL,
          provider_kind TEXT NOT NULL,
          state_json TEXT NOT NULL DEFAULT '{}',
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (profile_id) REFERENCES provider_profiles(id) ON DELETE CASCADE
        );
      `);

      const insertProfile = db.prepare(`
        INSERT INTO provider_profiles_new (
          id, name, provider_kind, provider_config_json, model, system_prompt,
          temperature, max_output_tokens, reasoning_effort,
          reasoning_summary_enabled, model_context_limit, compaction_threshold,
          fresh_tail_count, tokenizer_model, safety_margin_tokens,
          leaf_source_token_limit, leaf_min_message_count, merged_min_node_count,
          merged_target_tokens, vision_mode, vision_provider_profile_id, provider_preset_id, created_at, updated_at
        ) VALUES (
          @id, @name, @providerKind, @providerConfigJson, @model, @systemPrompt,
          @temperature, @maxOutputTokens, @reasoningEffort,
          @reasoningSummaryEnabled, @modelContextLimit, @compactionThreshold,
          @freshTailCount, @tokenizerModel, @safetyMarginTokens,
          @leafSourceTokenLimit, @leafMinMessageCount, @mergedMinNodeCount,
          @mergedTargetTokens, @visionMode, @visionProviderProfileId, @providerPresetId, @createdAt, @updatedAt
        )
      `);
      const insertConnection = db.prepare(`
        INSERT INTO provider_profile_connections_new (
          profile_id, credentials_encrypted, metadata_json,
          oauth_nonce, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const row of rows) {
        const providerKind = String(row.provider_kind ?? "openai_compatible");
        const providerConfig = providerKind === "github_copilot"
          ? {}
          : providerKind === "anthropic"
            ? { apiBaseUrl: String(row.api_base_url ?? "") }
            : {
                apiBaseUrl: String(row.api_base_url ?? ""),
                apiMode: String(row.api_mode ?? "responses"),
                processingMode: row.service_tier === "fast" ? "fast" : "standard",
                reasoningParameterMode: row.provider_preset_id === "ollama_cloud"
                  ? "mirrored"
                  : "standard"
              };
        const credentials = providerKind === "github_copilot"
          ? {
              accessToken: decryptLegacyCredential(String(row.github_user_access_token_encrypted ?? "")),
              refreshToken: decryptLegacyCredential(String(row.github_refresh_token_encrypted ?? ""))
            }
          : { apiKey: decryptLegacyCredential(String(row.api_key_encrypted ?? "")) };
        const nonEmptyCredentials = Object.fromEntries(
          Object.entries(credentials).filter(([, value]) => Boolean(value))
        );
        const metadata = providerKind === "github_copilot"
          ? {
              expiresAt: row.github_token_expires_at ?? null,
              refreshExpiresAt: row.github_refresh_token_expires_at ?? null,
              accountLabel: row.github_account_name ?? row.github_account_login ?? null
            }
          : {};
        const createdAt = String(row.created_at);
        const updatedAt = String(row.updated_at);

        insertProfile.run({
          id: row.id,
          name: row.name,
          providerKind,
          providerConfigJson: JSON.stringify(providerConfig),
          model: row.model,
          systemPrompt: row.system_prompt,
          temperature: row.temperature,
          maxOutputTokens: row.max_output_tokens,
          reasoningEffort: row.reasoning_effort,
          reasoningSummaryEnabled: row.reasoning_summary_enabled,
          modelContextLimit: row.model_context_limit,
          compactionThreshold: row.compaction_threshold,
          freshTailCount: row.fresh_tail_count,
          tokenizerModel: row.tokenizer_model ?? "gpt-tokenizer",
          safetyMarginTokens: row.safety_margin_tokens ?? 1200,
          leafSourceTokenLimit: row.leaf_source_token_limit ?? 12000,
          leafMinMessageCount: row.leaf_min_message_count ?? 6,
          mergedMinNodeCount: row.merged_min_node_count ?? 4,
          mergedTargetTokens: row.merged_target_tokens ?? 1600,
          visionMode: row.vision_mode ?? "native",
          visionProviderProfileId: null,
          providerPresetId: row.provider_preset_id ?? null,
          createdAt,
          updatedAt
        });
        insertConnection.run(
          row.id,
          Object.keys(nonEmptyCredentials).length
            ? encryptValue(JSON.stringify(nonEmptyCredentials))
            : "",
          JSON.stringify(metadata),
          row.github_oauth_nonce ?? null,
          createdAt,
          updatedAt
        );
      }

      const insertFlow = db.prepare(`
        INSERT INTO provider_connection_flows_new (
          id, user_id, profile_id, provider_kind, state_json,
          expires_at, consumed_at, status, created_at
        ) VALUES (?, ?, ?, 'github_copilot', ?, ?, ?, ?, ?)
      `);
      for (const row of flowRows) {
        insertFlow.run(
          row.id,
          row.user_id,
          row.profile_id,
          JSON.stringify({ profileNonce: row.profile_nonce }),
          row.expires_at,
          row.consumed_at ?? null,
          row.status,
          row.created_at
        );
      }

      db.exec(`
        DROP TABLE IF EXISTS mobile_github_oauth_flows;
        DROP TABLE IF EXISTS provider_connection_flows;
        DROP TABLE provider_profiles;
        ALTER TABLE provider_profiles_new RENAME TO provider_profiles;
        ALTER TABLE provider_profile_connections_new RENAME TO provider_profile_connections;
        ALTER TABLE provider_connection_flows_new RENAME TO provider_connection_flows;
        CREATE INDEX idx_provider_connection_flows_user_created
          ON provider_connection_flows(user_id, created_at DESC);
      `);
    });
    transaction.immediate();
  } finally {
    db.pragma("foreign_keys = ON");
  }

  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length) throw new Error("Provider storage migration failed foreign-key validation");
  console.log(`[db] Provider storage migration done in ${Date.now() - legacyStartedAt}ms`);
}

function normalizeProviderProfilesData(db: Database.Database) {
  migrateProviderRequestConfiguration(db);
  db.prepare(`
    UPDATE provider_profiles
    SET compaction_threshold = 0.8
    WHERE ABS(compaction_threshold - 0.78) < 0.000001
  `).run();
}

function migrateIntegrationSettings(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_settings (
      capability TEXT NOT NULL,
      user_id TEXT,
      provider_id TEXT NOT NULL,
      configuration_json TEXT NOT NULL DEFAULT '{}',
      credentials_encrypted TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_settings_global
      ON integration_settings(capability) WHERE user_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_settings_user
      ON integration_settings(capability, user_id) WHERE user_id IS NOT NULL;
  `);
  const encodeCredentials = (encrypted: string) => {
    const apiKey = decryptLegacyCredential(encrypted);
    return apiKey ? encryptValue(JSON.stringify({ apiKey })) : "";
  };
  const timestamp = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO integration_settings (
      capability, user_id, provider_id, configuration_json,
      credentials_encrypted, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const seedUserCapabilities = (row: Record<string, string>, userId: string | null) => {
    const search = normalizeWebSearchSelection(
      row.web_search_engine || "exa",
      { baseUrl: row.searxng_base_url }
    );
    const searchProvider = search.providerId;
    const searchCredential = searchProvider === "exa"
      ? row.exa_api_key_encrypted
      : searchProvider === "tavily"
        ? row.tavily_api_key_encrypted
        : "";
    insert.run(
      "web_search",
      userId,
      searchProvider,
      JSON.stringify(search.configuration),
      encodeCredentials(searchCredential),
      timestamp,
      timestamp
    );
    const legacySpeechProvider = row.stt_engine === "embedded"
      ? "canary"
      : row.stt_engine === "external"
        ? row.stt_provider || "elevenlabs"
        : "browser";
    const speech = normalizeTranscriptionSelection(legacySpeechProvider, {
      language: legacySpeechProvider === "elevenlabs"
        ? row.external_stt_language
        : row.stt_language
    });
    const speechProvider = speech.providerId;
    insert.run(
      "speech_transcription",
      userId,
      speechProvider,
      JSON.stringify(speech.configuration),
      encodeCredentials(speechProvider === "elevenlabs" ? row.external_stt_api_key_encrypted : ""),
      timestamp,
      timestamp
    );
  };

  const global = db.prepare(`
    SELECT image_generation_backend, google_nano_banana_model,
      google_nano_banana_api_key_encrypted
    FROM app_settings WHERE id = ?
  `).get(SETTINGS_ROW_ID) as Record<string, string>;
  seedUserCapabilities({
    web_search_engine: "exa",
    exa_api_key_encrypted: "",
    tavily_api_key_encrypted: "",
    searxng_base_url: "",
    stt_engine: "browser",
    stt_provider: "elevenlabs",
    stt_language: "auto",
    external_stt_language: "en",
    external_stt_api_key_encrypted: ""
  }, null);
  const image = normalizeImageGenerationSelection(
    global.image_generation_backend || "disabled",
    { model: global.google_nano_banana_model }
  );
  insert.run(
    "image_generation",
    null,
    image.providerId,
    JSON.stringify(image.configuration),
    image.providerId === global.image_generation_backend
      ? encodeCredentials(global.google_nano_banana_api_key_encrypted)
      : "",
    timestamp,
    timestamp
  );

  const users = db.prepare(`
    SELECT user_id, web_search_engine, exa_api_key_encrypted,
      tavily_api_key_encrypted, searxng_base_url, stt_engine, stt_provider,
      stt_language, external_stt_language, external_stt_api_key_encrypted
    FROM user_settings
  `).all() as Array<Record<string, string>>;
  for (const row of users) seedUserCapabilities(row, row.user_id);
}

function consolidateGlobalIntegrationSettings(db: Database.Database) {
  const update = db.prepare(`
    UPDATE integration_settings
    SET provider_id = ?, configuration_json = ?, credentials_encrypted = ?, updated_at = ?
    WHERE capability = ? AND user_id IS NULL
  `);
  const deleteUserRows = db.prepare(`
    DELETE FROM integration_settings
    WHERE capability = ? AND user_id IS NOT NULL
  `);
  const oldestAdminRow = db.prepare(`
    SELECT integration_settings.provider_id, integration_settings.configuration_json,
      integration_settings.credentials_encrypted
    FROM integration_settings
    JOIN users ON users.id = integration_settings.user_id
    WHERE integration_settings.capability = ? AND users.role = 'admin'
    ORDER BY users.created_at, integration_settings.created_at
    LIMIT 1
  `);
  const timestamp = new Date().toISOString();
  const transaction = db.transaction(() => {
    for (const capability of ["web_search", "speech_transcription"]) {
      const adminRow = oldestAdminRow.get(capability) as {
        provider_id: string;
        configuration_json: string;
        credentials_encrypted: string;
      } | undefined;
      if (adminRow) {
        update.run(
          adminRow.provider_id,
          adminRow.configuration_json,
          adminRow.credentials_encrypted,
          timestamp,
          capability
        );
      }
      deleteUserRows.run(capability);
    }
  });
  transaction();
}

function normalizeIntegrationSettingsStorage(db: Database.Database) {
  if (!tableExists(db, "integration_settings")) return;
  const rows = db.prepare(`
    SELECT rowid, capability, provider_id, configuration_json,
      credentials_encrypted
    FROM integration_settings
  `).all() as Array<{
    rowid: number;
    capability: string;
    provider_id: string;
    configuration_json: string;
    credentials_encrypted: string;
  }>;
  const update = db.prepare(`
    UPDATE integration_settings
    SET provider_id = ?, configuration_json = ?, credentials_encrypted = ?, updated_at = ?
    WHERE rowid = ?
  `);
  const parseConfiguration = (value: string) => {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  };
  const transaction = db.transaction(() => {
    for (const row of rows) {
      const configuration = parseConfiguration(row.configuration_json);
      const normalized = row.capability === "web_search"
        ? normalizeWebSearchSelection(row.provider_id, configuration)
        : row.capability === "image_generation"
          ? normalizeImageGenerationSelection(row.provider_id, configuration)
          : row.capability === "speech_transcription"
            ? normalizeTranscriptionSelection(row.provider_id, configuration)
            : null;
      if (!normalized) continue;
      const configurationJson = JSON.stringify(normalized.configuration);
      const credentials = normalized.providerId === row.provider_id
        ? row.credentials_encrypted
        : "";
      if (
        normalized.providerId !== row.provider_id ||
        configurationJson !== row.configuration_json ||
        credentials !== row.credentials_encrypted
      ) {
        update.run(
          normalized.providerId,
          configurationJson,
          credentials,
          new Date().toISOString(),
          row.rowid
        );
      }
    }
  });
  transaction();
}

function migratePreferenceStorage(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_provider_profile_id TEXT,
      skills_enabled INTEGER NOT NULL DEFAULT 1,
      conversation_retention TEXT NOT NULL DEFAULT 'forever',
      memories_enabled INTEGER NOT NULL DEFAULT 1,
      memories_max_count INTEGER NOT NULL DEFAULT 100,
      memories_rigor TEXT NOT NULL DEFAULT 'balanced',
      mcp_timeout INTEGER NOT NULL DEFAULT 120000,
      max_assistant_tool_steps INTEGER NOT NULL DEFAULT 25,
      confirm_external_links INTEGER NOT NULL DEFAULT 1,
      tool_call_display TEXT NOT NULL DEFAULT 'pills',
      default_view TEXT NOT NULL DEFAULT 'chat',
      follow_up_behavior TEXT NOT NULL DEFAULT 'queue',
      title_generation_mode TEXT NOT NULL DEFAULT 'same',
      title_generation_profile_id TEXT,
      speech_cleanup_enabled INTEGER NOT NULL DEFAULT 0,
      speech_cleanup_profile_id TEXT,
      speech_cleanup_prompt TEXT NOT NULL DEFAULT '',
      bot_system_prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (default_provider_profile_id) REFERENCES provider_profiles(id) ON DELETE SET NULL,
      FOREIGN KEY (title_generation_profile_id) REFERENCES provider_profiles(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      conversation_retention TEXT NOT NULL DEFAULT 'forever',
      memories_enabled INTEGER NOT NULL DEFAULT 1,
      memories_max_count INTEGER NOT NULL DEFAULT 100,
      memories_rigor TEXT NOT NULL DEFAULT 'balanced',
      mcp_timeout INTEGER NOT NULL DEFAULT 120000,
      max_assistant_tool_steps INTEGER NOT NULL DEFAULT 25,
      confirm_external_links INTEGER NOT NULL DEFAULT 1,
      tool_call_display TEXT NOT NULL DEFAULT 'pills',
      default_view TEXT NOT NULL DEFAULT 'chat',
      follow_up_behavior TEXT NOT NULL DEFAULT 'queue',
      allow_all_tools INTEGER NOT NULL DEFAULT 0,
      has_completed_onboarding INTEGER NOT NULL DEFAULT 0,
      last_seen_release TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const timestamp = new Date().toISOString();
  if (tableExists(db, "app_settings")) {
    db.prepare(`
      INSERT OR IGNORE INTO global_preferences (
        id, default_provider_profile_id, skills_enabled, conversation_retention,
        memories_enabled, memories_max_count, mcp_timeout,
        max_assistant_tool_steps, confirm_external_links, title_generation_mode,
        title_generation_profile_id, created_at, updated_at
      )
      SELECT id, NULLIF(default_provider_profile_id, ''), skills_enabled,
        conversation_retention, memories_enabled, memories_max_count,
        mcp_timeout, COALESCE(max_assistant_tool_steps, 25),
        1, COALESCE(title_generation_mode, 'same'), title_generation_profile_id,
        updated_at, updated_at
      FROM app_settings
      WHERE id = 1
    `).run();
  }
  db.prepare(`
    INSERT OR IGNORE INTO global_preferences (
      id, default_provider_profile_id, skills_enabled, conversation_retention,
      memories_enabled, memories_max_count, mcp_timeout,
      max_assistant_tool_steps, confirm_external_links, title_generation_mode,
      title_generation_profile_id, created_at, updated_at
    ) VALUES (1, NULL, 1, 'forever', 1, 100, 120000, 25, 1, 'same', NULL, ?, ?)
  `).run(timestamp, timestamp);

  if (tableExists(db, "user_settings")) {
    db.prepare(`
      INSERT OR IGNORE INTO user_preferences (
        user_id, conversation_retention, memories_enabled,
        memories_max_count, mcp_timeout, max_assistant_tool_steps,
        created_at, updated_at
      )
      SELECT user_id, conversation_retention, memories_enabled,
        memories_max_count, mcp_timeout,
        COALESCE(max_assistant_tool_steps, 25), updated_at, updated_at
      FROM user_settings
    `).run();
  }

  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      DROP TABLE IF EXISTS user_settings;
      DROP TABLE IF EXISTS app_settings;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function hasCurrentCompactionEventsSchema(db: Database.Database) {
  if (!tableExists(db, "compaction_events")) {
    return false;
  }

  const foreignKeys = db.prepare("PRAGMA foreign_key_list(compaction_events)").all() as Array<{
    from: string;
    table: string;
    to: string;
    on_delete: string;
  }>;
  const signatures = new Set(
    foreignKeys.map(
      (row) => `${row.from}:${row.table}:${row.to}:${row.on_delete.toUpperCase()}`
    )
  );

  return [
    "conversation_id:conversations:id:CASCADE",
    "node_id:memory_nodes:id:CASCADE",
    "source_start_message_id:messages:id:CASCADE",
    "source_end_message_id:messages:id:CASCADE"
  ].every((signature) => signatures.has(signature)) &&
    !foreignKeys.some((row) => row.from === "notice_message_id");
}

function migrateCompactionEventsTable(db: Database.Database) {
  const hasCurrentTable = tableExists(db, "compaction_events");
  const hasOldTable = tableExists(db, "compaction_events_old");

  if (hasCurrentTable && !hasOldTable && hasCurrentCompactionEventsSchema(db)) {
    return;
  }

  console.log("[db] Rebuilding compaction events table...");
  const startedAt = Date.now();
  const transaction = db.transaction(() => {
    db.exec("DROP TABLE IF EXISTS compaction_events_new");
    db.exec(COMPACTION_EVENTS_TABLE_SQL.replace("compaction_events", "compaction_events_new"));

    const sourceTables = [
      ...(hasOldTable ? ["compaction_events_old"] : []),
      ...(hasCurrentTable ? ["compaction_events"] : [])
    ];
    const sourceSignatures = new Map<string, string>();

    for (const sourceTable of sourceTables) {
      const sourceRows = db
        .prepare(
          `SELECT
             id,
             conversation_id,
             node_id,
             source_start_message_id,
             source_end_message_id,
             notice_message_id,
             created_at
           FROM ${sourceTable}`
        )
        .iterate() as Iterable<{
        id: string;
        conversation_id: string;
        node_id: string;
        source_start_message_id: string;
        source_end_message_id: string;
        notice_message_id: string | null;
        created_at: string;
      }>;

      for (const row of sourceRows) {
        const signature = JSON.stringify([
          row.conversation_id,
          row.node_id,
          row.source_start_message_id,
          row.source_end_message_id,
          row.notice_message_id,
          row.created_at
        ]);
        const existingSignature = sourceSignatures.get(row.id);
        if (existingSignature !== undefined && existingSignature !== signature) {
          throw new Error(`Unable to migrate compaction events: conflicting duplicate id ${row.id}`);
        }
        sourceSignatures.set(row.id, signature);
      }
    }

    for (const sourceTable of sourceTables) {
      db.exec(`
        INSERT OR IGNORE INTO compaction_events_new (
          id,
          conversation_id,
          node_id,
          source_start_message_id,
          source_end_message_id,
          notice_message_id,
          created_at
        )
        SELECT
          id,
          conversation_id,
          node_id,
          source_start_message_id,
          source_end_message_id,
          notice_message_id,
          created_at
        FROM ${sourceTable}
      `);
    }

    const expectedCount = sourceTables.length === 0
      ? 0
      : (
          db
            .prepare(
              `SELECT COUNT(DISTINCT id) AS count FROM (${sourceTables
                .map((sourceTable) => `SELECT id FROM ${sourceTable}`)
                .join(" UNION ALL ")})`
            )
            .get() as { count: number }
        ).count;
    const migratedCount = (
      db.prepare("SELECT COUNT(*) AS count FROM compaction_events_new").get() as { count: number }
    ).count;

    if (migratedCount !== expectedCount) {
      throw new Error(
        `Unable to migrate compaction events: expected ${expectedCount} rows, copied ${migratedCount}`
      );
    }

    if (hasCurrentTable) {
      db.exec("DROP TABLE compaction_events");
    }
    if (hasOldTable) {
      db.exec("DROP TABLE compaction_events_old");
    }
    db.exec("ALTER TABLE compaction_events_new RENAME TO compaction_events");
  });

  transaction.immediate();
  console.log(`[db] Compaction events rebuild done in ${Date.now() - startedAt}ms`);
}

function migrateBotAvatarsTable(db: Database.Database) {
  if (tableExists(db, "bot_avatars")) {
    const columns = db.prepare("PRAGMA table_info(bot_avatars)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "variant")) {
      return;
    }
    db.exec("DROP TABLE bot_avatars");
  }

  db.exec(BOT_AVATARS_TABLE_SQL);
}

function seedLegacyDefaultProvider(db: Database.Database) {
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
    ...createProviderProfileDraft({ name: "Default profile" }),
    id: SETTINGS_ROW_ID,
    skillsEnabled: DEFAULT_SKILLS_ENABLED ? 1 : 0,
    reasoningSummaryEnabled: DEFAULT_PROFILE_BEHAVIOR.reasoningSummaryEnabled ? 1 : 0,
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
      name: "Default profile",
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
}

function repairSkillMetadata(db: Database.Database) {
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
}

function upsertBuiltinSkills(db: Database.Database) {
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

function authSessionsReferenceUsers(db: Database.Database) {
  return (
    db.prepare("PRAGMA foreign_key_list(auth_sessions)").all() as Array<{ table: string }>
  ).some((row) => row.table === "users");
}

function migrateMcpServerSlugs(db: Database.Database) {
  db.exec("ALTER TABLE mcp_servers ADD COLUMN slug TEXT");
  const existingServers = db.prepare("SELECT id, name FROM mcp_servers").all() as Array<{ id: string; name: string }>;
  const updateSlug = db.prepare("UPDATE mcp_servers SET slug = ? WHERE id = ?");
  const usedSlugs = new Set<string>();
  for (const server of existingServers) {
    const baseSlug = server.name
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "unnamed";
    let slug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}_${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    updateSlug.run(slug, server.id);
  }
  db.exec(`
    CREATE TABLE mcp_servers_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      headers TEXT NOT NULL DEFAULT '{}',
      transport TEXT NOT NULL DEFAULT 'streamable_http',
      command TEXT,
      args TEXT,
      env TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO mcp_servers_new SELECT id, name, slug, url, headers, transport, command, args, env, enabled, created_at, updated_at FROM mcp_servers;
    DROP TABLE mcp_servers;
    ALTER TABLE mcp_servers_new RENAME TO mcp_servers;
  `);
}

function encryptMcpServerSecrets(db: Database.Database) {
  const mcpSecretRows = db
    .prepare("SELECT id, headers, env FROM mcp_servers")
    .all() as Array<{ id: string; headers: string; env: string | null }>;
  const encryptMcpSecrets = db.prepare("UPDATE mcp_servers SET headers = ?, env = ? WHERE id = ?");
  for (const row of mcpSecretRows) {
    const headers = row.headers.trim().startsWith("{") ? encryptValue(row.headers) : row.headers;
    const storedEnv = row.env?.trim().startsWith("{") ? encryptValue(row.env) : row.env;
    if (headers !== row.headers || storedEnv !== row.env) {
      encryptMcpSecrets.run(headers, storedEnv, row.id);
    }
  }
}

function widenLegacyProviderProfiles(db: Database.Database) {
  const newProfileCols = {
    tokenizer_model: "TEXT DEFAULT 'gpt-tokenizer'",
    safety_margin_tokens: "INTEGER DEFAULT 1200",
    leaf_source_token_limit: "INTEGER DEFAULT 12000",
    leaf_min_message_count: "INTEGER DEFAULT 6",
    merged_min_node_count: "INTEGER DEFAULT 4",
    merged_target_tokens: "INTEGER DEFAULT 1600"
  };
  for (const [colName, colDef] of Object.entries(newProfileCols)) {
    addColumnIfMissing(db, "provider_profiles", colName, colDef);
  }

  const visionProfileCols = {
    vision_mode: "TEXT NOT NULL DEFAULT 'native'",
    vision_mcp_server_id: "TEXT"
  };
  for (const [colName, colDef] of Object.entries(visionProfileCols)) {
    addColumnIfMissing(db, "provider_profiles", colName, colDef);
  }

  const githubCols = {
    provider_kind: "TEXT NOT NULL DEFAULT 'openai_compatible'",
    github_user_access_token_encrypted: "TEXT NOT NULL DEFAULT ''",
    github_refresh_token_encrypted: "TEXT NOT NULL DEFAULT ''",
    github_token_expires_at: "TEXT",
    github_refresh_token_expires_at: "TEXT",
    github_account_login: "TEXT",
    github_account_name: "TEXT",
    github_oauth_nonce: "TEXT"
  };
  for (const [colName, colDef] of Object.entries(githubCols)) {
    addColumnIfMissing(db, "provider_profiles", colName, colDef);
  }

  addColumnIfMissing(db, "provider_profiles", "provider_preset_id", "TEXT");
}

function legacyFlagRecorded(db: Database.Database, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM migration_flags WHERE name = ?").get(name));
}

type MigrationStep = {
  name: string;
  alreadyApplied?: (db: Database.Database) => boolean;
  apply: (db: Database.Database) => void;
};

type RecurringStep = {
  name: string;
  apply: (db: Database.Database) => void;
};

const MIGRATION_STEPS: MigrationStep[] = [
  {
    name: "saved_logins_to_vault",
    alreadyApplied: (db) => !tableExists(db, "saved_logins"),
    apply: (db) => migrateSavedLoginsToVault(db)
  },
  {
    name: "legacy_settings_tables",
    alreadyApplied: (db) => legacySettingsMigrated(db),
    apply: (db) => {
      if (legacySettingsMigrated(db)) return;
      db.exec(LEGACY_SETTINGS_TABLES_SQL);
    }
  },
  {
    name: "conversations_core_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "conversations", [
        "user_id",
        "folder_id",
        "sort_order",
        "provider_profile_id",
        "title_generation_status",
        "tool_execution_mode",
        "is_active",
        "share_token",
        "share_enabled",
        "shared_at"
      ]),
    apply: (db) => {
      addColumnIfMissing(db, "conversations", "user_id", "TEXT REFERENCES users(id) ON DELETE CASCADE");
      addColumnIfMissing(db, "conversations", "folder_id", "TEXT REFERENCES folders(id) ON DELETE SET NULL");
      addColumnIfMissing(db, "conversations", "sort_order", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(
        db,
        "conversations",
        "provider_profile_id",
        "TEXT REFERENCES provider_profiles(id) ON DELETE SET NULL"
      );
      addColumnIfMissing(
        db,
        "conversations",
        "title_generation_status",
        "TEXT NOT NULL DEFAULT 'completed'"
      );
      addColumnIfMissing(
        db,
        "conversations",
        "tool_execution_mode",
        "TEXT NOT NULL DEFAULT 'read_write'"
      );
      addColumnIfMissing(db, "conversations", "is_active", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "conversations", "share_token", "TEXT");
      addColumnIfMissing(db, "conversations", "share_enabled", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "conversations", "shared_at", "TEXT");
    }
  },
  {
    name: "conversations_automation_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "conversations", [
        "automation_id",
        "automation_run_id",
        "conversation_origin",
        "is_temporary",
        "reasoning_effort"
      ]),
    apply: (db) => {
      addColumnIfMissing(
        db,
        "conversations",
        "automation_id",
        "TEXT REFERENCES automations(id) ON DELETE SET NULL"
      );
      addColumnIfMissing(
        db,
        "conversations",
        "automation_run_id",
        "TEXT REFERENCES automation_runs(id) ON DELETE SET NULL"
      );
      addColumnIfMissing(
        db,
        "conversations",
        "conversation_origin",
        "TEXT NOT NULL DEFAULT 'manual'"
      );
      if (!tableColumns(db, "conversations").has("is_temporary")) {
        db.exec("ALTER TABLE conversations ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0");
        db.exec("DELETE FROM conversations WHERE is_temporary = 1");
      }
      addColumnIfMissing(db, "conversations", "reasoning_effort", "TEXT");
    }
  },
  {
    name: "message_actions_proposal_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "message_actions", ["proposal_state", "proposal_payload_json", "proposal_updated_at"]),
    apply: (db) => {
      addColumnIfMissing(db, "message_actions", "proposal_state", "TEXT");
      addColumnIfMissing(db, "message_actions", "proposal_payload_json", "TEXT");
      addColumnIfMissing(db, "message_actions", "proposal_updated_at", "TEXT");
    }
  },
  {
    name: "folders_user_column",
    alreadyApplied: (db) => hasColumns(db, "folders", ["user_id"]),
    apply: (db) => addColumnIfMissing(db, "folders", "user_id", "TEXT REFERENCES users(id) ON DELETE CASCADE")
  },
  {
    name: "personas_user_column",
    alreadyApplied: (db) => hasColumns(db, "personas", ["user_id"]),
    apply: (db) => addColumnIfMissing(db, "personas", "user_id", "TEXT REFERENCES users(id) ON DELETE CASCADE")
  },
  {
    name: "user_memories_owner_columns",
    alreadyApplied: (db) => hasColumns(db, "user_memories", ["user_id", "bot_id"]),
    apply: (db) => {
      addColumnIfMissing(db, "user_memories", "user_id", "TEXT REFERENCES users(id) ON DELETE CASCADE");
      addColumnIfMissing(db, "user_memories", "bot_id", "TEXT REFERENCES bots(id) ON DELETE CASCADE");
    }
  },
  {
    name: "automation_runs_result_message_column",
    alreadyApplied: (db) => hasColumns(db, "automation_runs", ["result_message_id"]),
    apply: (db) => {
      if (tableColumns(db, "automation_runs").has("result_message_id")) return;
      db.exec("ALTER TABLE automation_runs ADD COLUMN result_message_id TEXT");
      db.exec(
        `UPDATE automation_runs
         SET result_message_id = (
           SELECT m.id
           FROM messages m
           WHERE m.conversation_id = automation_runs.conversation_id
             AND m.role = 'assistant'
             AND m.status = 'completed'
             AND m.created_at >= automation_runs.started_at
             AND m.created_at <= automation_runs.finished_at
           ORDER BY m.rowid DESC
           LIMIT 1
         )
         WHERE status = 'completed'
           AND conversation_id IS NOT NULL
           AND started_at IS NOT NULL
           AND finished_at IS NOT NULL`
      );
    }
  },
  {
    name: "automations_expanded_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "automations", [
        "user_id",
        "bot_id",
        "research",
        "run_timeout_minutes",
        "continue_previous_conversation",
        "notify_config_json",
        "run_at"
      ]),
    apply: (db) => {
      addColumnIfMissing(db, "automations", "user_id", "TEXT REFERENCES users(id) ON DELETE CASCADE");
      addColumnIfMissing(db, "automations", "bot_id", "TEXT REFERENCES bots(id) ON DELETE SET NULL");
      addColumnIfMissing(db, "automations", "research", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "automations", "run_timeout_minutes", "INTEGER");
      addColumnIfMissing(
        db,
        "automations",
        "continue_previous_conversation",
        "INTEGER NOT NULL DEFAULT 0"
      );
      addColumnIfMissing(db, "automations", "notify_config_json", "TEXT NOT NULL DEFAULT '{}'");
      addColumnIfMissing(db, "automations", "run_at", "TEXT");
    }
  },
  {
    name: "bots_read_columns",
    alreadyApplied: (db) => hasColumns(db, "bots", ["last_read_at", "last_result_at"]),
    apply: (db) => {
      addColumnIfMissing(db, "bots", "last_read_at", "TEXT");
      addColumnIfMissing(db, "bots", "last_result_at", "TEXT");
    }
  },
  {
    name: "admin_users_into_users",
    apply: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO users (id, username, role, auth_source, password_hash, created_at, updated_at)
        SELECT id, username, 'admin', 'env_super_admin', NULL, created_at, updated_at
        FROM admin_users
      `);
    }
  },
  {
    name: "legacy_user_settings_seed",
    alreadyApplied: (db) => legacySettingsMigrated(db),
    apply: (db) => {
      if (legacySettingsMigrated(db)) return;
      db.exec(`
        INSERT OR IGNORE INTO user_settings (user_id, updated_at)
        SELECT id, updated_at
        FROM admin_users
      `);
    }
  },
  {
    name: "auth_sessions_user_foreign_key",
    alreadyApplied: (db) => authSessionsReferenceUsers(db),
    apply: (db) => {
      if (authSessionsReferenceUsers(db)) return;
      db.exec(`
        CREATE TABLE auth_sessions_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          purpose TEXT NOT NULL DEFAULT 'browser',
          device_name TEXT,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO auth_sessions_new (id, user_id, purpose, device_name, expires_at, created_at)
        SELECT id, user_id, 'browser', NULL, expires_at, created_at
        FROM auth_sessions;
        DROP TABLE auth_sessions;
        ALTER TABLE auth_sessions_new RENAME TO auth_sessions;
      `);
    }
  },
  {
    name: "auth_sessions_purpose_columns",
    alreadyApplied: (db) => hasColumns(db, "auth_sessions", ["purpose", "device_name"]),
    apply: (db) => {
      addColumnIfMissing(db, "auth_sessions", "purpose", "TEXT NOT NULL DEFAULT 'browser'");
      addColumnIfMissing(db, "auth_sessions", "device_name", "TEXT");
    }
  },
  {
    name: "legacy_app_settings_columns",
    alreadyApplied: (db) => legacySettingsMigrated(db),
    apply: (db) => {
      if (legacySettingsMigrated(db)) return;
      addColumnIfMissing(db, "app_settings", "default_provider_profile_id", "TEXT");
      addColumnIfMissing(db, "app_settings", "skills_enabled", "INTEGER NOT NULL DEFAULT 1");
      addColumnIfMissing(db, "app_settings", "conversation_retention", "TEXT NOT NULL DEFAULT 'forever'");
      addColumnIfMissing(db, "app_settings", "auto_compaction", "INTEGER NOT NULL DEFAULT 1");
      addColumnIfMissing(db, "app_settings", "memories_enabled", "INTEGER NOT NULL DEFAULT 1");
      addColumnIfMissing(db, "app_settings", "memories_max_count", "INTEGER NOT NULL DEFAULT 100");
      addColumnIfMissing(db, "app_settings", "mcp_timeout", "INTEGER NOT NULL DEFAULT 120000");
      addColumnIfMissing(db, "app_settings", "max_assistant_tool_steps", "INTEGER NOT NULL DEFAULT 25");
      addColumnIfMissing(db, "app_settings", "image_generation_backend", "TEXT NOT NULL DEFAULT 'disabled'");
      addColumnIfMissing(
        db,
        "app_settings",
        "google_nano_banana_model",
        "TEXT NOT NULL DEFAULT 'gemini-3.1-flash-image-preview'"
      );
      addColumnIfMissing(
        db,
        "app_settings",
        "google_nano_banana_api_key_encrypted",
        "TEXT NOT NULL DEFAULT ''"
      );
      addColumnIfMissing(db, "app_settings", "comfyui_base_url", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "app_settings", "comfyui_auth_type", "TEXT NOT NULL DEFAULT 'none'");
      addColumnIfMissing(db, "app_settings", "comfyui_bearer_token_encrypted", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "app_settings", "comfyui_workflow_json", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "app_settings", "comfyui_prompt_path", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(
        db,
        "app_settings",
        "comfyui_negative_prompt_path",
        "TEXT NOT NULL DEFAULT ''"
      );
      addColumnIfMissing(db, "app_settings", "comfyui_width_path", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "app_settings", "comfyui_height_path", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "app_settings", "comfyui_seed_path", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "app_settings", "title_generation_mode", "TEXT NOT NULL DEFAULT 'same'");
      addColumnIfMissing(db, "app_settings", "title_generation_profile_id", "TEXT");
    }
  },
  {
    name: "legacy_user_settings_columns",
    alreadyApplied: (db) => legacySettingsMigrated(db),
    apply: (db) => {
      if (legacySettingsMigrated(db)) return;
      addColumnIfMissing(db, "user_settings", "stt_engine", "TEXT NOT NULL DEFAULT 'browser'");
      addColumnIfMissing(
        db,
        "user_settings",
        "stt_provider",
        `TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_STT_PROVIDER}'`
      );
      addColumnIfMissing(db, "user_settings", "stt_language", "TEXT NOT NULL DEFAULT 'auto'");
      addColumnIfMissing(
        db,
        "user_settings",
        "external_stt_language",
        `TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_STT_LANGUAGE}'`
      );
      addColumnIfMissing(db, "user_settings", "external_stt_api_key_encrypted", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "user_settings", "web_search_engine", "TEXT NOT NULL DEFAULT 'exa'");
      addColumnIfMissing(db, "user_settings", "exa_api_key_encrypted", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "user_settings", "tavily_api_key_encrypted", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "user_settings", "searxng_base_url", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "user_settings", "max_assistant_tool_steps", "INTEGER NOT NULL DEFAULT 25");
    }
  },
  {
    name: "mcp_servers_transport_columns",
    alreadyApplied: (db) => hasColumns(db, "mcp_servers", ["transport", "command", "args", "env"]),
    apply: (db) => {
      addColumnIfMissing(db, "mcp_servers", "transport", "TEXT NOT NULL DEFAULT 'streamable_http'");
      addColumnIfMissing(db, "mcp_servers", "command", "TEXT");
      addColumnIfMissing(db, "mcp_servers", "args", "TEXT");
      addColumnIfMissing(db, "mcp_servers", "env", "TEXT");
    }
  },
  {
    name: "mcp_servers_slug_column",
    alreadyApplied: (db) => hasColumns(db, "mcp_servers", ["slug"]),
    apply: (db) => {
      if (tableColumns(db, "mcp_servers").has("slug")) return;
      migrateMcpServerSlugs(db);
    }
  },
  {
    name: "mcp_servers_vision_flag_column",
    alreadyApplied: (db) => hasColumns(db, "mcp_servers", ["is_vision_mcp"]),
    apply: (db) => {
      if (tableColumns(db, "mcp_servers").has("is_vision_mcp")) return;
      db.exec("ALTER TABLE mcp_servers ADD COLUMN is_vision_mcp INTEGER NOT NULL DEFAULT 0");
      backfillVisionMcpServers(db);
    }
  },
  {
    name: "mcp_servers_secrets_encrypted",
    apply: (db) => encryptMcpServerSecrets(db)
  },
  {
    name: "skills_description_column",
    alreadyApplied: (db) => hasColumns(db, "skills", ["description"]),
    apply: (db) => addColumnIfMissing(db, "skills", "description", "TEXT NOT NULL DEFAULT ''")
  },
  {
    name: "provider_profiles_preset_columns",
    alreadyApplied: (db) => hasColumns(db, "provider_profiles", ["provider_config_json"]),
    apply: (db) => {
      if (tableColumns(db, "provider_profiles").has("provider_config_json")) return;
      widenLegacyProviderProfiles(db);
    }
  },
  {
    name: "provider_profiles_vision_delegation_column",
    alreadyApplied: (db) => hasColumns(db, "provider_profiles", ["vision_provider_profile_id"]),
    apply: (db) =>
      addColumnIfMissing(db, "provider_profiles", "vision_provider_profile_id", "TEXT")
  },
  {
    name: "compaction_events_rebuild",
    alreadyApplied: (db) => hasCurrentCompactionEventsSchema(db) && !tableExists(db, "compaction_events_old"),
    apply: (db) => migrateCompactionEventsTable(db)
  },
  {
    name: "bot_avatars_variant_column",
    alreadyApplied: (db) => hasColumns(db, "bot_avatars", ["variant"]),
    apply: (db) => migrateBotAvatarsTable(db)
  },
  {
    name: "core_indexes",
    apply: (db) => {
      db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_folder ON conversations(folder_id, sort_order);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_share_token ON conversations(share_token);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_messages_compacted_at ON messages(conversation_id, compacted_at);
    CREATE INDEX IF NOT EXISTS idx_automations_enabled_next_run_at ON automations(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_scheduled_for ON automation_runs(automation_id, scheduled_for DESC);
    CREATE INDEX IF NOT EXISTS idx_automation_runs_status_scheduled_for ON automation_runs(status, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_message_actions_message_sort_order ON message_actions(message_id, sort_order, started_at);
    CREATE INDEX IF NOT EXISTS idx_message_text_segments_message_sort_order ON message_text_segments(message_id, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_queued_messages_conversation_status_sort
      ON queued_messages(conversation_id, status, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_message_created_at ON message_attachments(message_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_conversation_created_at ON message_attachments(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_memory_nodes_conversation_depth ON memory_nodes(conversation_id, depth, created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_nodes_superseded ON memory_nodes(conversation_id, superseded_by_node_id);
    CREATE INDEX IF NOT EXISTS idx_folders_sort_order ON folders(sort_order);
    CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(category);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_purpose_created
      ON auth_sessions(user_id, purpose, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_provider_connection_flows_user_created
      ON provider_connection_flows(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mcp_oauth_flows_server_created
      ON mcp_oauth_flows(server_id, created_at DESC);
      `);
    }
  },
  {
    name: "queued_messages_mode_column",
    alreadyApplied: (db) => hasColumns(db, "queued_messages", ["mode"]),
    apply: (db) => addColumnIfMissing(db, "queued_messages", "mode", "TEXT NOT NULL DEFAULT 'chat'")
  },
  {
    name: "bot_runs_reply_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "bot_runs", ["prompt", "reply_conversation_id", "reply_action_id", "pending_reply"]),
    apply: (db) => {
      addColumnIfMissing(db, "bot_runs", "prompt", "TEXT");
      addColumnIfMissing(db, "bot_runs", "reply_conversation_id", "TEXT");
      addColumnIfMissing(db, "bot_runs", "reply_action_id", "TEXT");
      addColumnIfMissing(db, "bot_runs", "pending_reply", "TEXT");
    }
  },
  {
    name: "skill_metadata_repair",
    apply: (db) => repairSkillMetadata(db)
  },
  {
    name: "legacy_default_provider_seed",
    alreadyApplied: (db) => legacySettingsMigrated(db),
    apply: (db) => {
      if (legacySettingsMigrated(db)) return;
      seedLegacyDefaultProvider(db);
    }
  },
  {
    name: "title_generation_status_repair",
    apply: (db) => {
      db.prepare(
        `UPDATE conversations
         SET title_generation_status = 'completed'
         WHERE COALESCE(title_generation_status, '') = ''`
      ).run();
    }
  },
  {
    name: "automation_runs_one_running_index",
    alreadyApplied: (db) =>
      (db.prepare("PRAGMA index_list(automation_runs)").all() as Array<{ name: string }>).some(
        (index) => index.name === "idx_automation_runs_one_running"
      ),
    apply: (db) => {
      db.prepare(
        `UPDATE automation_runs
         SET status = 'failed',
             error_message = 'Duplicate running automation repaired during migration',
             finished_at = COALESCE(finished_at, ?)
         WHERE status = 'running'
           AND id NOT IN (
             SELECT MIN(id)
             FROM automation_runs
             WHERE status = 'running'
             GROUP BY automation_id
           )`
      ).run(new Date().toISOString());
      db.exec(`
      CREATE UNIQUE INDEX idx_automation_runs_one_running
        ON automation_runs(automation_id)
        WHERE status = 'running'
    `);
    }
  },
  {
    name: "provider_storage_tables",
    alreadyApplied: (db) =>
      hasColumns(db, "provider_profiles", ["provider_config_json"]) &&
      tableExists(db, "provider_profile_connections") &&
      tableExists(db, "provider_connection_flows") &&
      !hasColumns(db, "provider_profile_connections", ["provider_kind"]),
    apply: (db) => migrateProviderStorageTables(db)
  },
  {
    name: "legacy_integration_settings",
    alreadyApplied: (db) => legacySettingsMigrated(db),
    apply: (db) => {
      if (legacySettingsMigrated(db)) return;
      runLoggedDataMigration(db, "Migrating integration settings", migrateIntegrationSettings);
    }
  },
  {
    name: "legacy_preference_storage",
    alreadyApplied: (db) => legacySettingsMigrated(db),
    apply: (db) => {
      if (legacySettingsMigrated(db)) return;
      runLoggedDataMigration(db, "Migrating preference storage", migratePreferenceStorage);
    }
  },
  {
    name: "preferences_confirm_external_links_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "global_preferences", ["confirm_external_links"]) &&
      hasColumns(db, "user_preferences", ["confirm_external_links", "allow_all_tools"]),
    apply: (db) => {
      addColumnIfMissing(db, "global_preferences", "confirm_external_links", "INTEGER NOT NULL DEFAULT 1");
      addColumnIfMissing(db, "user_preferences", "confirm_external_links", "INTEGER NOT NULL DEFAULT 1");
      addColumnIfMissing(db, "user_preferences", "allow_all_tools", "INTEGER NOT NULL DEFAULT 0");
    }
  },
  {
    name: "preferences_memories_rigor_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "global_preferences", ["memories_rigor"]) &&
      hasColumns(db, "user_preferences", ["memories_rigor"]),
    apply: (db) => {
      addColumnIfMissing(db, "global_preferences", "memories_rigor", "TEXT NOT NULL DEFAULT 'balanced'");
      addColumnIfMissing(db, "user_preferences", "memories_rigor", "TEXT NOT NULL DEFAULT 'balanced'");
    }
  },
  {
    name: "preferences_tool_call_display_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "global_preferences", ["tool_call_display"]) &&
      hasColumns(db, "user_preferences", ["tool_call_display"]),
    apply: (db) => {
      addColumnIfMissing(db, "global_preferences", "tool_call_display", "TEXT NOT NULL DEFAULT 'pills'");
      addColumnIfMissing(db, "user_preferences", "tool_call_display", "TEXT NOT NULL DEFAULT 'pills'");
    }
  },
  {
    name: "preferences_default_view_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "global_preferences", ["default_view"]) &&
      hasColumns(db, "user_preferences", ["default_view"]),
    apply: (db) => {
      addColumnIfMissing(db, "global_preferences", "default_view", "TEXT NOT NULL DEFAULT 'chat'");
      addColumnIfMissing(db, "user_preferences", "default_view", "TEXT NOT NULL DEFAULT 'chat'");
    }
  },
  {
    name: "preferences_follow_up_behavior_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "global_preferences", ["follow_up_behavior"]) &&
      hasColumns(db, "user_preferences", ["follow_up_behavior"]),
    apply: (db) => {
      addColumnIfMissing(db, "global_preferences", "follow_up_behavior", "TEXT NOT NULL DEFAULT 'queue'");
      addColumnIfMissing(db, "user_preferences", "follow_up_behavior", "TEXT NOT NULL DEFAULT 'queue'");
    }
  },
  {
    name: "preferences_onboarding_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "user_preferences", ["has_completed_onboarding", "last_seen_release"]),
    apply: (db) => {
      addColumnIfMissing(db, "user_preferences", "has_completed_onboarding", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "user_preferences", "last_seen_release", "TEXT NOT NULL DEFAULT ''");
    }
  },
  {
    name: "preferences_speech_cleanup_columns",
    alreadyApplied: (db) =>
      hasColumns(db, "global_preferences", [
        "speech_cleanup_enabled",
        "speech_cleanup_profile_id",
        "speech_cleanup_prompt",
        "bot_system_prompt"
      ]),
    apply: (db) => {
      addColumnIfMissing(db, "global_preferences", "speech_cleanup_enabled", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "global_preferences", "speech_cleanup_profile_id", "TEXT");
      addColumnIfMissing(db, "global_preferences", "speech_cleanup_prompt", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, "global_preferences", "bot_system_prompt", "TEXT NOT NULL DEFAULT ''");
    }
  },
  {
    name: "preferences_semantic_recall_column",
    alreadyApplied: (db) => hasColumns(db, "global_preferences", ["semantic_recall_enabled"]),
    apply: (db) =>
      addColumnIfMissing(db, "global_preferences", "semantic_recall_enabled", "INTEGER NOT NULL DEFAULT 1")
  },
  {
    name: "user_memories_pinned_column",
    alreadyApplied: (db) => hasColumns(db, "user_memories", ["pinned"]),
    apply: (db) => addColumnIfMissing(db, "user_memories", "pinned", "INTEGER NOT NULL DEFAULT 0")
  },
  {
    name: "message_attachments_source_path_column",
    alreadyApplied: (db) => hasColumns(db, "message_attachments", ["source_path"]),
    apply: (db) => addColumnIfMissing(db, "message_attachments", "source_path", "TEXT")
  },
  {
    name: "semantic_chunks_table",
    alreadyApplied: (db) => tableExists(db, "semantic_chunks"),
    apply: (db) => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_chunks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      user_id TEXT,
      conversation_id TEXT,
      memory_id TEXT,
      message_id TEXT,
      memory_node_id TEXT,
      attachment_id TEXT,
      chunk_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      model_id TEXT NOT NULL,
      dim INTEGER NOT NULL,
      embedding BLOB NOT NULL,
      source_created_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (kind, ref_id, chunk_index),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (memory_id) REFERENCES user_memories(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (memory_node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (attachment_id) REFERENCES message_attachments(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_user_kind ON semantic_chunks(user_id, kind);
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_model ON semantic_chunks(model_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_conversation ON semantic_chunks(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_memory ON semantic_chunks(memory_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_message ON semantic_chunks(message_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_memory_node ON semantic_chunks(memory_node_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_attachment ON semantic_chunks(attachment_id);
      `);
      console.log("[db] Created semantic_chunks table");
    }
  },
  {
    name: "bot_conversations_follow_default_provider",
    alreadyApplied: (db) => legacyFlagRecorded(db, "bot_conversations_follow_default_provider"),
    apply: (db) => {
      db.exec(`
        UPDATE conversations
        SET provider_profile_id = NULL
        WHERE id IN (SELECT home_conversation_id FROM bots)
      `);
      db.prepare(
        "INSERT OR IGNORE INTO migration_flags (name, applied_at) VALUES (?, ?)"
      ).run("bot_conversations_follow_default_provider", new Date().toISOString());
    }
  }
];

const RECURRING_STEPS: RecurringStep[] = [
  {
    name: "builtin_skills_seed",
    apply: (db) => upsertBuiltinSkills(db)
  },
  {
    name: "provider_profiles_data_repair",
    apply: (db) => normalizeProviderProfilesData(db)
  },
  {
    name: "integration_settings_normalized",
    apply: (db) => normalizeIntegrationSettingsStorage(db)
  },
  {
    name: "integration_settings_consolidated",
    apply: (db) => consolidateGlobalIntegrationSettings(db)
  }
];

export function listMigrationSteps() {
  return MIGRATION_STEPS.map((step) => step.name);
}

function recordAppliedStep(db: Database.Database, name: string) {
  db.prepare("INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
    name,
    new Date().toISOString()
  );
}

export function migrate(db: Database.Database) {
  const migrationStartedAt = Date.now();
  const isFreshDatabase = !tableExists(db, "users");
  if (isFreshDatabase) {
    console.log("[db] Initializing new database");
  }
  console.log("[db] Running database migrations...");
  if (!legacySettingsMigrated(db)) {
    console.log("[db] Migrating legacy settings storage (app_settings/user_settings)");
  }
  db.exec(BASELINE_SCHEMA_SQL);

  const appliedStepNames = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  );
  for (const step of MIGRATION_STEPS) {
    if (appliedStepNames.has(step.name)) continue;
    if (!step.alreadyApplied?.(db)) {
      step.apply(db);
    }
    recordAppliedStep(db, step.name);
    appliedStepNames.add(step.name);
  }
  for (const step of RECURRING_STEPS) {
    step.apply(db);
  }
  console.log(`[db] Database migrations complete in ${Date.now() - migrationStartedAt}ms`);
}

export function backfillVisionMcpServers(db: Database.Database) {
  const profileCols = db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>;
  if (!profileCols.some((c) => c.name === "vision_mcp_server_id")) return;
  db.exec(`
    UPDATE mcp_servers SET is_vision_mcp = 1
    WHERE id IN (
      SELECT DISTINCT vision_mcp_server_id FROM provider_profiles
      WHERE vision_mcp_server_id IS NOT NULL
    )
  `);
}
