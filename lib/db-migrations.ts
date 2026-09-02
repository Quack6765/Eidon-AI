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

function tableExists(db: Database.Database, tableName: string) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
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

function migrateProviderConnectionStorage(db: Database.Database) {
  if (!tableExists(db, "provider_profile_connections")) return;
  const columns = db.prepare("PRAGMA table_info(provider_profile_connections)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "provider_kind")) return;

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

function migrateProviderStorage(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>;
  if (
    columns.some((column) => column.name === "provider_config_json") &&
    tableExists(db, "provider_profile_connections") &&
    tableExists(db, "provider_connection_flows")
  ) {
    migrateProviderConnectionStorage(db);
    migrateProviderRequestConfiguration(db);
    db.prepare(`
      UPDATE provider_profiles
      SET compaction_threshold = 0.8
      WHERE ABS(compaction_threshold - 0.78) < 0.000001
    `).run();
    return;
  }

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
      title_generation_mode TEXT NOT NULL DEFAULT 'same',
      title_generation_profile_id TEXT,
      speech_cleanup_enabled INTEGER NOT NULL DEFAULT 0,
      speech_cleanup_profile_id TEXT,
      speech_cleanup_prompt TEXT NOT NULL DEFAULT '',
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
}

export function reconcileInterruptedRuntimeState(
  db: Database.Database,
  timestamp = new Date().toISOString()
) {
  const transaction = db.transaction(() => {
    const conversations = db
      .prepare("UPDATE conversations SET is_active = 0 WHERE is_active = 1")
      .run().changes;
    const messages = db
      .prepare("UPDATE messages SET status = 'error' WHERE status = 'streaming'")
      .run().changes;
    const actions = db
      .prepare(
        `UPDATE message_actions
         SET status = 'error',
             detail = CASE WHEN detail = '' THEN ? ELSE detail END,
             completed_at = COALESCE(completed_at, ?)
         WHERE status = 'running'`
      )
      .run("Interrupted by server restart", timestamp).changes;
    const titles = db
      .prepare(
        `UPDATE conversations
         SET title_generation_status = 'failed'
         WHERE title_generation_status = 'running'`
      )
      .run().changes;
    const queuedMessages = db
      .prepare(
        `UPDATE queued_messages
         SET status = 'failed',
             failure_message = 'Queued follow-up was interrupted by server restart',
             processing_started_at = NULL,
             updated_at = ?
         WHERE status = 'processing'`
      )
      .run(timestamp).changes;
    const automationRuns = db
      .prepare(
        `UPDATE automation_runs
         SET status = 'failed',
             error_message = 'Automation run was interrupted by server restart',
             finished_at = COALESCE(finished_at, ?)
         WHERE status = 'running'`
      )
      .run(timestamp).changes;

    db.prepare(
      `UPDATE automations
       SET last_status = 'failed',
           last_finished_at = COALESCE(last_finished_at, ?),
           updated_at = ?
       WHERE last_status = 'running'`
    ).run(timestamp, timestamp);

    return { conversations, messages, actions, titles, queuedMessages, automationRuns };
  });

  return transaction.immediate();
}

export function migrate(db: Database.Database) {
  const needsLegacySettingsMigration = !(
    tableExists(db, "global_preferences") &&
    tableExists(db, "user_preferences") &&
    tableExists(db, "integration_settings")
  );
  db.exec(`
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
      created_at TEXT NOT NULL,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
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
      created_at TEXT NOT NULL,
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE SET NULL
    );
  `);

  if (needsLegacySettingsMigration) {
    db.exec(`
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
    `);
  }

  const convCols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  const convColNames = convCols.map((c) => c.name);
  if (!convColNames.includes("user_id")) {
    db.exec("ALTER TABLE conversations ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
  }
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
  if (!convColNames.includes("share_token")) {
    db.exec("ALTER TABLE conversations ADD COLUMN share_token TEXT");
  }
  if (!convColNames.includes("share_enabled")) {
    db.exec("ALTER TABLE conversations ADD COLUMN share_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!convColNames.includes("shared_at")) {
    db.exec("ALTER TABLE conversations ADD COLUMN shared_at TEXT");
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
  if (!automationConversationCols.some((col) => col.name === "is_temporary")) {
    db.exec("ALTER TABLE conversations ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0");
    db.exec("DELETE FROM conversations WHERE is_temporary = 1");
  }
  if (!automationConversationCols.some((col) => col.name === "reasoning_effort")) {
    db.exec("ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT");
  }

  const messageActionCols = db.prepare("PRAGMA table_info(message_actions)").all() as Array<{ name: string }>;
  if (!messageActionCols.some((col) => col.name === "proposal_state")) {
    db.exec("ALTER TABLE message_actions ADD COLUMN proposal_state TEXT");
  }
  if (!messageActionCols.some((col) => col.name === "proposal_payload_json")) {
    db.exec("ALTER TABLE message_actions ADD COLUMN proposal_payload_json TEXT");
  }
  if (!messageActionCols.some((col) => col.name === "proposal_updated_at")) {
    db.exec("ALTER TABLE message_actions ADD COLUMN proposal_updated_at TEXT");
  }

  const folderCols = db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>;
  if (!folderCols.some((col) => col.name === "user_id")) {
    db.exec("ALTER TABLE folders ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
  }

  const personaCols = db.prepare("PRAGMA table_info(personas)").all() as Array<{ name: string }>;
  if (!personaCols.some((col) => col.name === "user_id")) {
    db.exec("ALTER TABLE personas ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
  }

  const memoryCols = db.prepare("PRAGMA table_info(user_memories)").all() as Array<{ name: string }>;
  if (!memoryCols.some((col) => col.name === "user_id")) {
    db.exec("ALTER TABLE user_memories ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
  }
  if (!memoryCols.some((col) => col.name === "bot_id")) {
    db.exec("ALTER TABLE user_memories ADD COLUMN bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE");
  }

  const automationCols = db.prepare("PRAGMA table_info(automations)").all() as Array<{ name: string }>;
  if (!automationCols.some((col) => col.name === "user_id")) {
    db.exec("ALTER TABLE automations ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
  }
  if (!automationCols.some((col) => col.name === "bot_id")) {
    db.exec("ALTER TABLE automations ADD COLUMN bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL");
  }

  db.exec(`
    INSERT OR IGNORE INTO users (id, username, role, auth_source, password_hash, created_at, updated_at)
    SELECT id, username, 'admin', 'env_super_admin', NULL, created_at, updated_at
    FROM admin_users
  `);
  if (needsLegacySettingsMigration) {
    db.exec(`
      INSERT OR IGNORE INTO user_settings (user_id, updated_at)
      SELECT id, updated_at
      FROM admin_users
    `);
  }

  const authSessionForeignKeys = (
    db.prepare("PRAGMA foreign_key_list(auth_sessions)").all() as Array<{ table: string }>
  ).map((row) => row.table);
  if (!authSessionForeignKeys.includes("users")) {
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

  const authSessionColumns = (
    db.prepare("PRAGMA table_info(auth_sessions)").all() as Array<{ name: string }>
  ).map((row) => row.name);
  if (!authSessionColumns.includes("purpose")) {
    db.exec("ALTER TABLE auth_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'browser'");
  }
  if (!authSessionColumns.includes("device_name")) {
    db.exec("ALTER TABLE auth_sessions ADD COLUMN device_name TEXT");
  }

  if (needsLegacySettingsMigration) {
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
  if (!settingsColNames.includes("max_assistant_tool_steps")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN max_assistant_tool_steps INTEGER NOT NULL DEFAULT 25");
  }
  if (!settingsColNames.includes("image_generation_backend")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN image_generation_backend TEXT NOT NULL DEFAULT 'disabled'");
  }
  if (!settingsColNames.includes("google_nano_banana_model")) {
    db.exec(
      "ALTER TABLE app_settings ADD COLUMN google_nano_banana_model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-image-preview'"
    );
  }
  if (!settingsColNames.includes("google_nano_banana_api_key_encrypted")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN google_nano_banana_api_key_encrypted TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColNames.includes("comfyui_base_url")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_base_url TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColNames.includes("comfyui_auth_type")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_auth_type TEXT NOT NULL DEFAULT 'none'");
  }
  if (!settingsColNames.includes("comfyui_bearer_token_encrypted")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_bearer_token_encrypted TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColNames.includes("comfyui_workflow_json")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_workflow_json TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColNames.includes("comfyui_prompt_path")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_prompt_path TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColNames.includes("comfyui_negative_prompt_path")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_negative_prompt_path TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColNames.includes("comfyui_width_path")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_width_path TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColNames.includes("comfyui_height_path")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_height_path TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColNames.includes("comfyui_seed_path")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_seed_path TEXT NOT NULL DEFAULT ''");
  }
  if (!settingsColNames.includes("title_generation_mode")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN title_generation_mode TEXT NOT NULL DEFAULT 'same'");
  }
  if (!settingsColNames.includes("title_generation_profile_id")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN title_generation_profile_id TEXT");
  }

  const userSettingsCols = db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>;
  const userSettingsColNames = userSettingsCols.map((column) => column.name);
  if (!userSettingsColNames.includes("stt_engine")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN stt_engine TEXT NOT NULL DEFAULT 'browser'");
  }
  if (!userSettingsColNames.includes("stt_provider")) {
    db.exec(`ALTER TABLE user_settings ADD COLUMN stt_provider TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_STT_PROVIDER}'`);
  }
  if (!userSettingsColNames.includes("stt_language")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN stt_language TEXT NOT NULL DEFAULT 'auto'");
  }
  if (!userSettingsColNames.includes("external_stt_language")) {
    db.exec(`ALTER TABLE user_settings ADD COLUMN external_stt_language TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_STT_LANGUAGE}'`);
  }
  if (!userSettingsColNames.includes("external_stt_api_key_encrypted")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN external_stt_api_key_encrypted TEXT NOT NULL DEFAULT ''");
  }
  if (!userSettingsColNames.includes("web_search_engine")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN web_search_engine TEXT NOT NULL DEFAULT 'exa'");
  }
  if (!userSettingsColNames.includes("exa_api_key_encrypted")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN exa_api_key_encrypted TEXT NOT NULL DEFAULT ''");
  }
  if (!userSettingsColNames.includes("tavily_api_key_encrypted")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN tavily_api_key_encrypted TEXT NOT NULL DEFAULT ''");
  }
  if (!userSettingsColNames.includes("searxng_base_url")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN searxng_base_url TEXT NOT NULL DEFAULT ''");
  }
  if (!userSettingsColNames.includes("max_assistant_tool_steps")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN max_assistant_tool_steps INTEGER NOT NULL DEFAULT 25");
  }
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
  if (!mcpColNames.includes("slug")) {
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
  if (!mcpColNames.includes("is_vision_mcp")) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN is_vision_mcp INTEGER NOT NULL DEFAULT 0");
    backfillVisionMcpServers(db);
  }

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

  const skillCols = db.prepare("PRAGMA table_info(skills)").all() as Array<{ name: string }>;
  const skillColNames = skillCols.map((c) => c.name);
  if (!skillColNames.includes("description")) {
    db.exec("ALTER TABLE skills ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }

  const profileCols = db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>;
  const profileColNames = profileCols.map((c) => c.name);
  if (!profileColNames.includes("provider_config_json")) {
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
    github_account_name: "TEXT",
    github_oauth_nonce: "TEXT"
  };
  const githubProfileCols = db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>;
  const githubProfileColNames = githubProfileCols.map((c) => c.name);
  for (const [colName, colDef] of Object.entries(githubCols)) {
    if (!githubProfileColNames.includes(colName)) {
      db.exec(`ALTER TABLE provider_profiles ADD COLUMN ${colName} ${colDef}`);
    }
  }

  const presetCols = {
    provider_preset_id: "TEXT"
  };
  const presetProfileCols = db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>;
  const presetProfileColNames = presetProfileCols.map((c) => c.name);
  for (const [colName, colDef] of Object.entries(presetCols)) {
    if (!presetProfileColNames.includes(colName)) {
      db.exec(`ALTER TABLE provider_profiles ADD COLUMN ${colName} ${colDef}`);
    }
  }
  }

  const visionProviderCols = db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>;
  if (!visionProviderCols.some((column) => column.name === "vision_provider_profile_id")) {
    db.exec("ALTER TABLE provider_profiles ADD COLUMN vision_provider_profile_id TEXT");
  }

  migrateCompactionEventsTable(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_folder ON conversations(folder_id, sort_order);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_share_token ON conversations(share_token);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_messages_compacted_at ON messages(conversation_id, compacted_at);
    CREATE INDEX IF NOT EXISTS idx_automations_enabled_next_run_at ON automations(enabled, next_run_at);
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
  `);

  const queuedMessagesCols = db.prepare("PRAGMA table_info(queued_messages)").all() as Array<{ name: string }>;
  const queuedMessagesColNames = queuedMessagesCols.map((column) => column.name);
  if (!queuedMessagesColNames.includes("mode")) {
    db.exec("ALTER TABLE queued_messages ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'");
  }

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

  if (needsLegacySettingsMigration) {
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

  const automationRunIndexes = db.prepare("PRAGMA index_list(automation_runs)").all() as Array<{
    name: string;
  }>;
  if (!automationRunIndexes.some((index) => index.name === "idx_automation_runs_one_running")) {
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

  migrateProviderStorage(db);
  if (needsLegacySettingsMigration) {
    migrateIntegrationSettings(db);
    migratePreferenceStorage(db);
  }
  normalizeIntegrationSettingsStorage(db);
  consolidateGlobalIntegrationSettings(db);

  const globalPreferencesCols = db.prepare("PRAGMA table_info(global_preferences)").all() as Array<{ name: string }>;
  if (!globalPreferencesCols.some((column) => column.name === "confirm_external_links")) {
    db.exec("ALTER TABLE global_preferences ADD COLUMN confirm_external_links INTEGER NOT NULL DEFAULT 1");
  }
  const userPreferencesCols = db.prepare("PRAGMA table_info(user_preferences)").all() as Array<{ name: string }>;
  if (!userPreferencesCols.some((column) => column.name === "confirm_external_links")) {
    db.exec("ALTER TABLE user_preferences ADD COLUMN confirm_external_links INTEGER NOT NULL DEFAULT 1");
  }

  if (!globalPreferencesCols.some((column) => column.name === "memories_rigor")) {
    db.exec("ALTER TABLE global_preferences ADD COLUMN memories_rigor TEXT NOT NULL DEFAULT 'balanced'");
  }
  if (!userPreferencesCols.some((column) => column.name === "memories_rigor")) {
    db.exec("ALTER TABLE user_preferences ADD COLUMN memories_rigor TEXT NOT NULL DEFAULT 'balanced'");
  }

  if (!globalPreferencesCols.some((column) => column.name === "tool_call_display")) {
    db.exec("ALTER TABLE global_preferences ADD COLUMN tool_call_display TEXT NOT NULL DEFAULT 'pills'");
  }
  if (!userPreferencesCols.some((column) => column.name === "tool_call_display")) {
    db.exec("ALTER TABLE user_preferences ADD COLUMN tool_call_display TEXT NOT NULL DEFAULT 'pills'");
  }

  if (!globalPreferencesCols.some((column) => column.name === "default_view")) {
    db.exec("ALTER TABLE global_preferences ADD COLUMN default_view TEXT NOT NULL DEFAULT 'chat'");
  }
  if (!userPreferencesCols.some((column) => column.name === "default_view")) {
    db.exec("ALTER TABLE user_preferences ADD COLUMN default_view TEXT NOT NULL DEFAULT 'chat'");
  }

  if (!globalPreferencesCols.some((column) => column.name === "speech_cleanup_enabled")) {
    db.exec("ALTER TABLE global_preferences ADD COLUMN speech_cleanup_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!globalPreferencesCols.some((column) => column.name === "speech_cleanup_profile_id")) {
    db.exec("ALTER TABLE global_preferences ADD COLUMN speech_cleanup_profile_id TEXT");
  }
  if (!globalPreferencesCols.some((column) => column.name === "speech_cleanup_prompt")) {
    db.exec("ALTER TABLE global_preferences ADD COLUMN speech_cleanup_prompt TEXT NOT NULL DEFAULT ''");
  }
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
