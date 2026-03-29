import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { DEFAULT_SETTINGS, SETTINGS_ROW_ID } from "@/lib/constants";
import { env } from "@/lib/env";

const BUILTIN_AGENT_BROWSER_SKILL = {
  id: "builtin-agent-browser",
  name: "Agent Browser",
  content: `# Agent Browser

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
  const convCols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  const convColNames = convCols.map((c) => c.name);
  if (!convColNames.includes("folder_id")) {
    db.exec("ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL");
  }
  if (!convColNames.includes("sort_order")) {
    db.exec("ALTER TABLE conversations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }

  // Migration: add transport, command, args, env columns to mcp_servers
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

  // Seed built-in skills if they don't exist
  const builtinSkills = [BUILTIN_AGENT_BROWSER_SKILL];
  const insertSkill = db.prepare(
    `INSERT OR IGNORE INTO skills (id, name, content, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  );
  const now = new Date().toISOString();
  for (const skill of builtinSkills) {
    insertSkill.run(skill.id, skill.name, skill.content, now, now);
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
