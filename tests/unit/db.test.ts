import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const dataDir = path.resolve(".test-data");
const dbPath = path.join(dataDir, "eidon.db");

function prepareLegacyDatabase() {
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
    CREATE TABLE skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

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

  db.close();
}

describe("db", () => {
  beforeEach(() => {
    vi.resetModules();
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

  it("migrates legacy schemas and backfills defaults", async () => {
    prepareLegacyDatabase();

    const { getDb } = await import("@/lib/db");
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
    const mcpColumns = (db.prepare("PRAGMA table_info(mcp_servers)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const skillColumns = (db.prepare("PRAGMA table_info(skills)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const automationColumns = (db.prepare("PRAGMA table_info(automations)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    const automationRunColumns = (db.prepare("PRAGMA table_info(automation_runs)").all() as Array<{ name: string }>)
      .map((column) => column.name);
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
    expect(mcpColumns).toEqual(expect.arrayContaining(["transport", "command", "args", "env", "slug"]));
    expect(skillColumns).toContain("description");
    expect(automationColumns).toEqual(
      expect.arrayContaining(["prompt", "schedule_kind", "next_run_at", "enabled"])
    );
    expect(automationRunColumns).toEqual(
      expect.arrayContaining(["automation_id", "conversation_id", "scheduled_for", "status"])
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
