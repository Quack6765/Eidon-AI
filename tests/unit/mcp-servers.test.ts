import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { getDb, backfillVisionMcpServers } from "@/lib/db";
import { createMcpServer, getMcpServer, updateMcpServer, listMcpServers } from "@/lib/mcp-servers";
import { updateSettings } from "@/lib/settings";

describe("mcp-servers isVisionMcp", () => {
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

  it("persists args and env on update", () => {
    const server = createMcpServer({ name: "Args Server", url: "https://example.com", transport: "stdio", command: "node", args: ["script.js"], env: { KEY: "value" } });
    const updated = updateMcpServer(server.id, { args: ["new.js"], env: { KEY2: "v2" }, command: "python" });
    expect(updated?.args).toEqual(["new.js"]);
    expect(updated?.env).toEqual({ KEY2: "v2" });
  });

  it("clears args and env to null on update", () => {
    const server = createMcpServer({ name: "Null Args", url: "https://example.com", transport: "stdio", args: ["x"], env: { A: "b" } });
    const updated = updateMcpServer(server.id, { args: null, env: null });
    expect(updated?.args).toBeNull();
    expect(updated?.env).toBeNull();
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
});
