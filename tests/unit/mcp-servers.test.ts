import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  listEnabledMcpServers,
  updateMcpServer
} from "@/lib/mcp-servers";

describe("mcp servers", () => {
  it("creates, lists, updates, and deletes MCP servers", () => {
    const server = createMcpServer({
      name: "Test Server",
      url: "https://mcp.example.com/api",
      headers: { Authorization: "Bearer test123" }
    });

    expect(server.name).toBe("Test Server");
    expect(server.url).toBe("https://mcp.example.com/api");
    expect(server.headers).toEqual({ Authorization: "Bearer test123" });
    expect(server.enabled).toBe(true);

    const all = listMcpServers();
    expect(all).toHaveLength(1);

    const fetched = getMcpServer(server.id);
    expect(fetched?.name).toBe("Test Server");

    updateMcpServer(server.id, { name: "Updated Server", enabled: false });
    const updated = getMcpServer(server.id);
    expect(updated?.name).toBe("Updated Server");
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
});
