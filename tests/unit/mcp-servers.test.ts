import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { getDb, backfillVisionMcpServers } from "@/lib/db";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  listEnabledMcpServers,
  updateMcpServer
} from "@/lib/mcp-servers";
import { updateSettings } from "@/lib/settings";

describe("mcp servers", () => {
  it("creates, lists, updates, and deletes MCP servers", () => {
    const server = createMcpServer({
      name: "Test Server",
      url: "https://mcp.example.com/api",
      headers: { Authorization: "Bearer test123" }
    });

    expect(server.name).toBe("Test Server");
    expect(server.slug).toBe("test_server");
    expect(server.url).toBe("https://mcp.example.com/api");
    expect(server.headers).toEqual({ Authorization: "Bearer test123" });
    expect(server.enabled).toBe(true);

    const all = listMcpServers();
    expect(all).toHaveLength(1);

    const fetched = getMcpServer(server.id);
    expect(fetched?.name).toBe("Test Server");
    expect(fetched?.slug).toBe("test_server");

    updateMcpServer(server.id, { name: "Updated Server", enabled: false });
    const updated = getMcpServer(server.id);
    expect(updated?.name).toBe("Updated Server");
    expect(updated?.slug).toBe("updated_server");
    expect(updated?.enabled).toBe(false);

    deleteMcpServer(server.id);
    expect(listMcpServers()).toHaveLength(0);
    expect(getMcpServer(server.id)).toBeNull();
  });

  it("lists only enabled servers", () => {
    const s1 = createMcpServer({ name: "Enabled", url: "https://a.com" });
    const s2 = createMcpServer({ name: "Disabled", url: "https://b.com" });

    updateMcpServer(s2.id, { enabled: false });

    const enabled = listEnabledMcpServers();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe(s1.id);
  });

  it("creates server without headers", () => {
    const server = createMcpServer({ name: "No Headers", url: "https://c.com" });
    expect(server.headers).toEqual({});
  });

  it("supports stdio servers and preserves nullified fields on update", () => {
    const server = createMcpServer({
      name: "Stdio",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: { TOKEN: "secret" }
    });

    expect(server.url).toBe("");
    expect(server.transport).toBe("stdio");
    expect(server.command).toBe("node");
    expect(server.args).toEqual(["server.js"]);
    expect(server.env).toEqual({ TOKEN: "secret" });

    const updated = updateMcpServer(server.id, {
      command: null,
      args: null,
      env: null
    });

    expect(updated?.command).toBeNull();
    expect(updated?.args).toBeNull();
    expect(updated?.env).toBeNull();
  });

  it("returns null for missing server update", () => {
    const result = updateMcpServer("nonexistent", { name: "X" });
    expect(result).toBeNull();
  });

  it("generates correct slugs from names", () => {
    const cases = [
      { name: "My Exa Server", expectedSlug: "my_exa_server" },
      { name: "exa", expectedSlug: "exa" },
      { name: "  spaces  ", expectedSlug: "spaces" },
      { name: "special!@#chars", expectedSlug: "special_chars" },
      { name: "multiple---dashes", expectedSlug: "multiple_dashes" },
      { name: "UPPERCASE", expectedSlug: "uppercase" },
      { name: "under_score", expectedSlug: "under_score" }
    ];

    for (const { name, expectedSlug } of cases) {
      const server = createMcpServer({ name, url: "https://test.com" });
      expect(server.slug).toBe(expectedSlug);
      deleteMcpServer(server.id);
    }
  });

  it("rejects duplicate slug on create via DB constraint", () => {
    createMcpServer({ name: "Exa", url: "https://a.com" });
    expect(() => {
      createMcpServer({ name: "exa", url: "https://b.com" });
    }).toThrow();
  });
});

describe("mcp servers isVisionMcp", () => {
  it("defaults isVisionMcp to false on create", () => {
    const server = createMcpServer({ name: "Plain Server", url: "https://example.com" });
    expect(server.isVisionMcp).toBe(false);
    expect(getMcpServer(server.id)?.isVisionMcp).toBe(false);
  });

  it("persists isVisionMcp on create and update", () => {
    const server = createMcpServer({ name: "Vision One", url: "https://example.com", isVisionMcp: true });
    expect(server.isVisionMcp).toBe(true);

    const updated = updateMcpServer(server.id, { isVisionMcp: false });
    expect(updated?.isVisionMcp).toBe(false);
    expect(getMcpServer(server.id)?.isVisionMcp).toBe(false);
  });

  it("preserves isVisionMcp when an update omits it", () => {
    const server = createMcpServer({ name: "Vision Two", url: "https://example.com", isVisionMcp: true });
    const updated = updateMcpServer(server.id, { name: "Vision Two Renamed" });
    expect(updated?.isVisionMcp).toBe(true);
  });

  it("backfills isVisionMcp for servers referenced by a profile's vision_mcp_server_id", () => {
    const visionServer = createMcpServer({ name: "Legacy Vision", url: "https://example.com" });
    const otherServer = createMcpServer({ name: "Other", url: "https://example.com" });

    updateSettings({
      defaultProviderProfileId: "profile_a",
      skillsEnabled: true,
      providerProfiles: [
        {
          id: "profile_a",
          name: "A",
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "",
          model: "gpt-test",
          apiMode: "responses",
          systemPrompt: "Be exact.",
          temperature: 0.4,
          maxOutputTokens: 512,
          reasoningEffort: "medium",
          reasoningSummaryEnabled: true,
          modelContextLimit: 16384,
          compactionThreshold: 0.8,
          freshTailCount: 28,
          providerPresetId: null
        }
      ]
    });

    getDb()
      .prepare("UPDATE provider_profiles SET vision_mcp_server_id = ? WHERE id = ?")
      .run(visionServer.id, "profile_a");

    backfillVisionMcpServers(getDb());

    expect(getMcpServer(visionServer.id)?.isVisionMcp).toBe(true);
    expect(getMcpServer(otherServer.id)?.isVisionMcp).toBe(false);
    expect(listMcpServers().filter((s) => s.isVisionMcp)).toHaveLength(1);
  });

  it("backfillVisionMcpServers is a no-op when vision_mcp_server_id column does not exist", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE provider_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_vision_mcp INTEGER NOT NULL DEFAULT 0);
      INSERT INTO mcp_servers VALUES ('s1', 'Server One', 0);
    `);
    backfillVisionMcpServers(db);
    const row = db.prepare("SELECT is_vision_mcp FROM mcp_servers WHERE id = 's1'").get() as { is_vision_mcp: number };
    expect(row.is_vision_mcp).toBe(0);
    db.close();
  });

  it("adds is_vision_mcp and preserves data when migrating a pre-slug schema", () => {
    const dataDir = path.resolve(".test-data");
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "eidon.db");

    const legacyDb = new Database(dbPath);
    const now = new Date().toISOString();
    legacyDb.exec(`
      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
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
    `);
    legacyDb
      .prepare(
        "INSERT INTO mcp_servers (id, name, url, headers, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run("mcp_legacy", "Legacy Server", "https://legacy.example.com", "{}", 1, now, now);
    legacyDb.close();

    const db = getDb();

    const columns = (db.prepare("PRAGMA table_info(mcp_servers)").all() as Array<{ name: string }>).map(
      (column) => column.name
    );
    expect(columns).toEqual(expect.arrayContaining(["slug", "is_vision_mcp"]));

    const survived = getMcpServer("mcp_legacy");
    expect(survived?.name).toBe("Legacy Server");
    expect(survived?.url).toBe("https://legacy.example.com");
    expect(survived?.isVisionMcp).toBe(false);
  });
});
