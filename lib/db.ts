import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { DEFAULT_SETTINGS, SETTINGS_ROW_ID } from "@/lib/constants";
import { env } from "@/lib/env";

let database: Database.Database | null = null;

function getDatabasePath() {
  const dir = path.resolve(env.HERMES_DATA_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "hermes.db");
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
      folder_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
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
      notice_message_id TEXT NOT NULL,
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
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_folder ON conversations(folder_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_messages_compacted_at ON messages(conversation_id, compacted_at);
    CREATE INDEX IF NOT EXISTS idx_memory_nodes_conversation_depth ON memory_nodes(conversation_id, depth, created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_nodes_superseded ON memory_nodes(conversation_id, superseded_by_node_id);
    CREATE INDEX IF NOT EXISTS idx_folders_sort_order ON folders(sort_order);
  `);

  // Migration: add folder_id and sort_order columns to existing conversations table
  const cols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  const colNames = cols.map((c) => c.name);
  if (!colNames.includes("folder_id")) {
    db.exec("ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL");
  }
  if (!colNames.includes("sort_order")) {
    db.exec("ALTER TABLE conversations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }

  db.prepare(
      `INSERT OR IGNORE INTO app_settings (
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
      ) VALUES (
        @id,
        @apiBaseUrl,
        '',
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
        @updatedAt
      )`
    ).run({
      id: SETTINGS_ROW_ID,
      ...DEFAULT_SETTINGS,
      reasoningSummaryEnabled: DEFAULT_SETTINGS.reasoningSummaryEnabled ? 1 : 0,
      updatedAt: new Date().toISOString()
    });
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
