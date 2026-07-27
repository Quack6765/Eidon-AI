import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const dataDir = path.resolve(".test-data");
const dbPath = path.join(dataDir, "eidon.db");

function openLegacyDatabase(options: { userSettingsColumns?: string[] } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbPath);
  const now = new Date().toISOString();

  db.exec(`
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
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
      updated_at TEXT NOT NULL
    );
    CREATE TABLE provider_profiles (
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE user_memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE automations (
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
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      headers TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE message_actions (
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
    CREATE TABLE skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  if (options.userSettingsColumns?.length) {
    db.exec(
      `CREATE TABLE user_settings (
        ${options.userSettingsColumns
          .map((column) =>
            column === "user_id"
              ? "user_id TEXT NOT NULL PRIMARY KEY"
              : column === "default_provider_profile_id"
                ? "default_provider_profile_id TEXT"
                : column === "skills_enabled"
                  ? "skills_enabled INTEGER NOT NULL DEFAULT 1"
                  : column === "conversation_retention"
                    ? "conversation_retention TEXT NOT NULL DEFAULT 'forever'"
                    : column === "auto_compaction"
                      ? "auto_compaction INTEGER NOT NULL DEFAULT 1"
                      : column === "memories_enabled"
                        ? "memories_enabled INTEGER NOT NULL DEFAULT 1"
                        : column === "memories_max_count"
                          ? "memories_max_count INTEGER NOT NULL DEFAULT 100"
                          : column === "mcp_timeout"
                            ? "mcp_timeout INTEGER NOT NULL DEFAULT 120000"
                            : column === "stt_engine"
                              ? "stt_engine TEXT NOT NULL DEFAULT 'browser'"
                              : column === "stt_language"
                                ? "stt_language TEXT NOT NULL DEFAULT 'auto'"
                                : column === "updated_at"
                                  ? "updated_at TEXT NOT NULL"
                                  : `${column} TEXT`
          )
          .join(",\n        ")}
      );`
    );
  }

  db.prepare(
    `INSERT INTO app_settings (
      id,
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
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    1,
    "https://api.example.com/v1",
    "encrypted",
    "gpt-5-mini",
    "responses",
    "Be exact",
    0.2,
    512,
    "medium",
    1,
    16000,
    0.8,
    12,
    now
  );

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
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "profile_existing",
    "Existing",
    "https://api.example.com/v1",
    "encrypted",
    "gpt-5-mini",
    "responses",
    "Be exact",
    0.2,
    512,
    "medium",
    1,
    16000,
    0.8,
    12,
    now,
    now
  );

  db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("conv_legacy", "Legacy chat", now, now);

  db.prepare("INSERT INTO folders (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("folder_legacy", "Legacy folder", 0, now, now);
  db.prepare("INSERT INTO personas (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("persona_legacy", "Legacy persona", "Persona content", now, now);
  db.prepare(
    "INSERT INTO user_memories (id, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run("memory_legacy", "Memory content", "general", now, now);
  db.prepare(
    `INSERT INTO automations (
      id,
      name,
      prompt,
      provider_profile_id,
      persona_id,
      schedule_kind,
      interval_minutes,
      calendar_frequency,
      time_of_day,
      days_of_week,
      enabled,
      next_run_at,
      last_scheduled_for,
      last_started_at,
      last_finished_at,
      last_status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "automation_legacy",
    "Legacy automation",
    "Do the thing",
    "profile_existing",
    null,
    "interval",
    60,
    null,
    null,
    "[]",
    1,
    null,
    null,
    null,
    null,
    null,
    now,
    now
  );

  db.prepare(
    "INSERT INTO mcp_servers (id, name, url, headers, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("mcp_legacy", "Legacy MCP", "https://mcp.example.com", "{}", 1, now, now);
  db.prepare(
    "INSERT INTO mcp_servers (id, name, url, headers, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("mcp_legacy_duplicate", "Legacy MCP", "https://mcp-2.example.com", "{}", 1, now, now);

  db.prepare(
    "INSERT INTO skills (id, name, content, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    "skill_frontmatter",
    "Temporary Name",
    `---
name: Browser Agent
description: Use for browser workflows.
---

# Browser Agent`,
    1,
    now,
    now
  );

  db.prepare(
    "INSERT INTO skills (id, name, content, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    "skill_derived",
    "Release Notes",
    "# Release Notes\nSummarize notable product changes.",
    1,
    now,
    now
  );

  return db;
}

function prepareLegacyDatabase() {
  const db = openLegacyDatabase();
  db.close();
}

describe("db", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("adds memory proposal columns to message_actions", async () => {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const columns = db.prepare("PRAGMA table_info(message_actions)").all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["proposal_state", "proposal_payload_json", "proposal_updated_at"])
    );
  });

  it("adds multi-user tables and owner columns", async () => {
    const { getDb } = await import("@/lib/db");
    const db = getDb();

    const userColumns = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const userSettingsColumns = (
      db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const conversationColumns = (
      db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const folderColumns = (db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const personaColumns = (db.prepare("PRAGMA table_info(personas)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const memoryColumns = (
      db.prepare("PRAGMA table_info(user_memories)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const legacyAutomationColumns = (
      db.prepare("PRAGMA table_info(automations)").all() as Array<{ name: string }>
    ).map((column) => column.name);

    expect(userColumns).toEqual(
      expect.arrayContaining(["username", "role", "auth_source", "password_hash"])
    );
    expect(userSettingsColumns).toEqual(
      expect.arrayContaining([
        "user_id",
        "default_provider_profile_id",
        "conversation_retention",
        "mcp_timeout"
      ])
    );
    expect(conversationColumns).toContain("user_id");
    expect(folderColumns).toContain("user_id");
    expect(personaColumns).toContain("user_id");
    expect(memoryColumns).toContain("user_id");
    expect(legacyAutomationColumns).toContain("user_id");
  });

  it("adds speech-to-text columns to user_settings during migration", async () => {
    const legacyDb = openLegacyDatabase({
      userSettingsColumns: [
        "user_id",
        "default_provider_profile_id",
        "skills_enabled",
        "conversation_retention",
        "auto_compaction",
        "memories_enabled",
        "memories_max_count",
        "mcp_timeout",
        "updated_at"
      ]
    });
    legacyDb.close();

    const { getDb } = await import("@/lib/db");
    const db = getDb();

    const userSettingsColumns = (
      db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>
    ).map((column) => column.name);

    expect(userSettingsColumns).toEqual(
      expect.arrayContaining(["stt_engine", "stt_language"])
    );
  });

  it("adds web search columns to user_settings during migration", async () => {
    const legacyDb = openLegacyDatabase({
      userSettingsColumns: [
        "user_id",
        "default_provider_profile_id",
        "skills_enabled",
        "conversation_retention",
        "auto_compaction",
        "memories_enabled",
        "memories_max_count",
        "mcp_timeout",
        "stt_engine",
        "stt_language",
        "updated_at"
      ]
    });
    legacyDb.close();

    const { getDb } = await import("@/lib/db");
    const db = getDb();

    const userSettingsColumns = (
      db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>
    ).map((column) => column.name);

    expect(userSettingsColumns).toEqual(
      expect.arrayContaining([
        "web_search_engine",
        "exa_api_key_encrypted",
        "tavily_api_key_encrypted",
        "searxng_base_url"
      ])
    );
  });

  it("migrates legacy schemas and backfills defaults", async () => {
    prepareLegacyDatabase();

    const { getDb, migrate } = await import("@/lib/db");
    const db = getDb();

    const userColumns = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const userSettingsColumns = (
      db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const conversationColumns = (db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const folderColumns = (db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const personaColumns = (db.prepare("PRAGMA table_info(personas)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const memoryColumns = (
      db.prepare("PRAGMA table_info(user_memories)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const legacyAutomationColumns = (
      db.prepare("PRAGMA table_info(automations)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const settingsColumns = (db.prepare("PRAGMA table_info(app_settings)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const providerProfileColumns = (
      db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const mcpColumns = (db.prepare("PRAGMA table_info(mcp_servers)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const skillColumns = (db.prepare("PRAGMA table_info(skills)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const automationColumns = (db.prepare("PRAGMA table_info(automations)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const automationRunColumns = (db.prepare("PRAGMA table_info(automation_runs)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const messageActionColumns = (
      db.prepare("PRAGMA table_info(message_actions)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const automationIndexes = (db.prepare("PRAGMA index_list(automations)").all() as Array<{ name: string }>)
      .map((index) => index.name);
    const automationRunIndexes = (
      db.prepare("PRAGMA index_list(automation_runs)").all() as Array<{ name: string }>
    ).map((index) => index.name);
    const authSessionForeignKeys = (
      db.prepare("PRAGMA foreign_key_list(auth_sessions)").all() as Array<{ table: string }>
    ).map((row) => row.table);

    expect(conversationColumns).toEqual(
      expect.arrayContaining([
        "user_id",
        "folder_id",
        "sort_order",
        "provider_profile_id",
        "title_generation_status",
        "tool_execution_mode",
        "automation_id",
        "automation_run_id",
        "conversation_origin"
      ])
    );
    expect(userColumns).toEqual(
      expect.arrayContaining(["id", "username", "role", "auth_source", "password_hash"])
    );
    expect(userSettingsColumns).toEqual(
      expect.arrayContaining([
        "user_id",
        "default_provider_profile_id",
        "skills_enabled",
        "conversation_retention",
        "auto_compaction",
        "memories_enabled",
        "memories_max_count",
        "mcp_timeout",
        "updated_at"
      ])
    );
    expect(folderColumns).toContain("user_id");
    expect(personaColumns).toContain("user_id");
    expect(memoryColumns).toContain("user_id");
    expect(legacyAutomationColumns).toContain("user_id");
    expect(authSessionForeignKeys).toContain("users");
    expect(authSessionForeignKeys).not.toContain("admin_users");
    expect(settingsColumns).toEqual(
      expect.arrayContaining(["default_provider_profile_id", "skills_enabled"])
    );
    expect(providerProfileColumns).toContain("github_oauth_nonce");
    expect(() => migrate(db)).not.toThrow();
    expect((
      db.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{ name: string }>
    ).filter((column) => column.name === "github_oauth_nonce")).toHaveLength(1);
    expect(mcpColumns).toEqual(expect.arrayContaining(["transport", "command", "args", "env", "slug"]));
    expect(skillColumns).toContain("description");
    expect(automationColumns).toEqual(
      expect.arrayContaining(["prompt", "schedule_kind", "next_run_at", "enabled"])
    );
    expect(automationRunColumns).toEqual(
      expect.arrayContaining(["automation_id", "conversation_id", "scheduled_for", "status"])
    );
    expect(messageActionColumns).toEqual(
      expect.arrayContaining(["proposal_state", "proposal_payload_json", "proposal_updated_at"])
    );
    expect(automationIndexes).toContain("idx_automations_enabled_next_run_at");
    expect(automationRunIndexes).toEqual(
      expect.arrayContaining([
        "idx_automation_runs_automation_scheduled_for",
        "idx_automation_runs_status_scheduled_for"
      ])
    );

    const conversation = db
      .prepare(
        `SELECT
          provider_profile_id,
          title_generation_status,
          automation_id,
          automation_run_id,
          conversation_origin
         FROM conversations
         WHERE id = ?`
      )
      .get("conv_legacy") as {
      provider_profile_id: string | null;
      title_generation_status: string;
      automation_id: string | null;
      automation_run_id: string | null;
      conversation_origin: string;
    };
    const appSettings = db
      .prepare("SELECT default_provider_profile_id, skills_enabled FROM app_settings WHERE id = 1")
      .get() as {
      default_provider_profile_id: string;
      skills_enabled: number;
    };
    const skillFrontmatter = db
      .prepare("SELECT name, description FROM skills WHERE id = ?")
      .get("skill_frontmatter") as { name: string; description: string };
    const skillDerived = db
      .prepare("SELECT name, description FROM skills WHERE id = ?")
      .get("skill_derived") as { name: string; description: string };
    const builtinSkill = db
      .prepare("SELECT name, description FROM skills WHERE id = ?")
      .get("builtin-agent-browser") as { name: string; description: string } | undefined;
    const migratedMcpServers = db
      .prepare("SELECT id, slug FROM mcp_servers ORDER BY id ASC")
      .all() as Array<{ id: string; slug: string }>;

    expect(appSettings.default_provider_profile_id).toBe("profile_existing");
    expect(appSettings.skills_enabled).toBe(1);
    expect(conversation.provider_profile_id).toBe("profile_existing");
    expect(conversation.title_generation_status).toBe("completed");
    expect(conversation.automation_id).toBeNull();
    expect(conversation.automation_run_id).toBeNull();
    expect(conversation.conversation_origin).toBe("manual");
    expect(skillFrontmatter).toEqual({
      name: "Browser Agent",
      description: "Use for browser workflows."
    });
    expect(skillDerived).toEqual({
      name: "Release Notes",
      description: "Summarize notable product changes."
    });
    expect(builtinSkill?.name).toBe("Agent Browser");
    expect(migratedMcpServers).toEqual([
      { id: "mcp_legacy", slug: "legacy_mcp" },
      { id: "mcp_legacy_duplicate", slug: "legacy_mcp_2" }
    ]);
  });

  it("reconciles interrupted state only during explicit guarded runtime bootstrap", async () => {
    const dbModule = await import("@/lib/db");
    const conversations = await import("@/lib/conversations");
    const automations = await import("@/lib/automations");
    const conversation = conversations.createConversation();
    const assistantMessage = conversations.createMessage({
      conversationId: conversation.id,
      role: "assistant",
      status: "streaming"
    });
    const action = conversations.createMessageAction({
      messageId: assistantMessage.id,
      kind: "mcp_tool_call",
      label: "Interrupted action",
      status: "running"
    });
    const queuedMessage = conversations.createQueuedMessage({
      conversationId: conversation.id,
      content: "Interrupted follow-up"
    });
    const pendingQueuedMessage = conversations.createQueuedMessage({
      conversationId: conversation.id,
      content: "Pending during restart"
    });
    conversations.claimNextQueuedMessageForDispatch(conversation.id);
    const automation = automations.createAutomation({
      name: "Interrupted automation",
      prompt: "Run",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 5,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });
    const automationRun = automations.createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-07-12T12:00:00.000Z",
      triggerSource: "manual_run"
    });
    automations.updateAutomationRunStatus(automationRun.id, {
      status: "running",
      startedAt: "2026-07-12T12:00:00.000Z"
    });
    const db = dbModule.getDb();
    db.prepare(
      `UPDATE conversations
       SET is_active = 1, title_generation_status = 'running'
       WHERE id = ?`
    ).run(conversation.id);

    dbModule.migrate(db);
    expect(
      db.prepare("SELECT is_active FROM conversations WHERE id = ?").get(conversation.id)
    ).toEqual({ is_active: 1 });
    expect(db.prepare("SELECT status FROM messages WHERE id = ?").get(assistantMessage.id)).toEqual({
      status: "streaming"
    });

    dbModule.resetDbForTests();
    const reopened = dbModule.getDb();
    expect(
      reopened.prepare("SELECT is_active FROM conversations WHERE id = ?").get(conversation.id)
    ).toEqual({ is_active: 1 });
    expect(reopened.prepare("SELECT status FROM automation_runs WHERE id = ?").get(automationRun.id)).toEqual({
      status: "running"
    });

    const runtimeBootstrap = await import("@/lib/runtime-bootstrap");
    runtimeBootstrap.resetRuntimeBootstrapForTests();
    const bootstrapResult = runtimeBootstrap.bootstrapRuntimeState();
    const recoveredConversation = reopened
      .prepare("SELECT is_active, title_generation_status FROM conversations WHERE id = ?")
      .get(conversation.id) as { is_active: number; title_generation_status: string };
    const recoveredMessage = reopened
      .prepare("SELECT status FROM messages WHERE id = ?")
      .get(assistantMessage.id) as { status: string };
    const recoveredAction = reopened
      .prepare("SELECT status, completed_at FROM message_actions WHERE id = ?")
      .get(action.id) as { status: string; completed_at: string | null };
    const recoveredQueue = reopened
      .prepare("SELECT status, processing_started_at FROM queued_messages WHERE id = ?")
      .get(queuedMessage.id) as { status: string; processing_started_at: string | null };
    const recoveredPendingQueue = reopened
      .prepare("SELECT status, processing_started_at FROM queued_messages WHERE id = ?")
      .get(pendingQueuedMessage.id) as { status: string; processing_started_at: string | null };
    const recoveredRun = reopened
      .prepare("SELECT status, finished_at FROM automation_runs WHERE id = ?")
      .get(automationRun.id) as { status: string; finished_at: string | null };

    expect(recoveredConversation).toEqual({ is_active: 0, title_generation_status: "failed" });
    expect(recoveredMessage.status).toBe("error");
    expect(recoveredAction.status).toBe("error");
    expect(recoveredAction.completed_at).not.toBeNull();
    expect(recoveredQueue).toEqual({ status: "failed", processing_started_at: null });
    expect(recoveredPendingQueue).toEqual({ status: "pending", processing_started_at: null });
    expect(recoveredRun.status).toBe("failed");
    expect(recoveredRun.finished_at).not.toBeNull();
    expect(bootstrapResult).toMatchObject({
      recovered: {
        conversations: 1,
        messages: 1,
        actions: 1,
        titles: 1,
        queuedMessages: 1,
        automationRuns: 1
      }
    });

    const laterConversation = conversations.createConversation("Live after bootstrap");
    conversations.setConversationActive(laterConversation.id, true);
    expect(runtimeBootstrap.bootstrapRuntimeState()).toBeNull();
    expect(conversations.getConversation(laterConversation.id)?.isActive).toBe(true);
  });

  it("recovers exact partial compaction copies but rejects conflicting duplicate ids", async () => {
    const { migrate } = await import("@/lib/db-migrations");
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    const timestamp = "2026-07-12T12:00:00.000Z";
    db.prepare(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).run("conv_partial_rebuild", "Migration recovery", timestamp, timestamp);
    db.prepare(
      `INSERT INTO messages (
        id, conversation_id, role, content, thinking_content, status, created_at
      ) VALUES (?, ?, ?, ?, '', 'completed', ?)`
    ).run("msg_partial_start", "conv_partial_rebuild", "user", "Start", timestamp);
    db.prepare(
      `INSERT INTO messages (
        id, conversation_id, role, content, thinking_content, status, created_at
      ) VALUES (?, ?, ?, ?, '', 'completed', ?)`
    ).run("msg_partial_end", "conv_partial_rebuild", "assistant", "End", timestamp);
    db.prepare(
      `INSERT INTO memory_nodes (
        id, conversation_id, type, depth, content, source_start_message_id,
        source_end_message_id, source_token_count, summary_token_count,
        child_node_ids, superseded_by_node_id, created_at
      ) VALUES (?, ?, 'leaf_summary', 0, 'Summary', ?, ?, 2, 1, '[]', NULL, ?)`
    ).run(
      "mem_partial_rebuild",
      "conv_partial_rebuild",
      "msg_partial_start",
      "msg_partial_end",
      timestamp
    );
    db.prepare(
      `INSERT INTO compaction_events (
        id, conversation_id, node_id, source_start_message_id,
        source_end_message_id, notice_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      "cmp_partial_rebuild",
      "conv_partial_rebuild",
      "mem_partial_rebuild",
      "msg_partial_start",
      "msg_partial_end",
      timestamp
    );
    db.pragma("foreign_keys = OFF");
    db.exec(`
      ALTER TABLE compaction_events RENAME TO compaction_events_old;
      CREATE TABLE compaction_events AS SELECT * FROM compaction_events_old WHERE 0;
      INSERT INTO compaction_events SELECT * FROM compaction_events_old;
    `);

    migrate(db);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM compaction_events").get()
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'compaction_events_old'")
        .get()
    ).toBeUndefined();
    const sourceForeignKeys = (
      db.prepare("PRAGMA foreign_key_list(compaction_events)").all() as Array<{
        from: string;
        table: string;
      }>
    ).filter((row) => row.from.startsWith("source_"));
    expect(sourceForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "source_start_message_id", table: "messages" }),
        expect.objectContaining({ from: "source_end_message_id", table: "messages" })
      ])
    );
    const rootPage = (
      db
        .prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'compaction_events'")
        .get() as { rootpage: number }
    ).rootpage;

    migrate(db);
    expect(
      db
        .prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'compaction_events'")
        .get()
    ).toEqual({ rootpage: rootPage });
    expect(db.prepare("SELECT COUNT(*) AS count FROM compaction_events").get()).toEqual({ count: 1 });

    db.pragma("foreign_keys = OFF");
    db.exec(`
      ALTER TABLE compaction_events RENAME TO compaction_events_old;
      CREATE TABLE compaction_events AS SELECT * FROM compaction_events_old;
      UPDATE compaction_events
      SET created_at = '2026-07-12T13:00:00.000Z'
      WHERE id = 'cmp_partial_rebuild';
    `);
    db.pragma("foreign_keys = ON");

    expect(() => migrate(db)).toThrow(
      "Unable to migrate compaction events: conflicting duplicate id cmp_partial_rebuild"
    );
    db.close();
  });

  it("fails migration loudly instead of accepting invalid compaction-event rows", async () => {
    const { migrate } = await import("@/lib/db-migrations");
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
    db.pragma("foreign_keys = OFF");
    db.exec("ALTER TABLE compaction_events RENAME TO compaction_events_old");
    db.prepare(
      `INSERT INTO compaction_events_old (
        id, conversation_id, node_id, source_start_message_id,
        source_end_message_id, notice_message_id, created_at
      ) VALUES ('cmp_invalid', 'conv_missing', 'mem_missing', 'msg_missing', 'msg_missing', NULL, ?)`
    ).run("2026-07-12T12:00:00.000Z");
    db.pragma("foreign_keys = ON");

    expect(() => migrate(db)).toThrow();
    db.close();
  });

  it("reuses the same database instance until reset is called", async () => {
    const dbModule = await import("@/lib/db");

    const first = dbModule.getDb();
    const second = dbModule.getDb();

    expect(second).toBe(first);

    dbModule.resetDbForTests();

    const third = dbModule.getDb();

    expect(third).not.toBe(first);

    dbModule.resetDbForTests();
    dbModule.resetDbForTests();
  });
});
