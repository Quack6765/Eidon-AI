import { buildMcpToolsDescription } from "@/lib/mcp-client";
import type { McpServer } from "@/lib/types";

describe("MCP client utilities", () => {
  it("builds tool description for MCP servers", () => {
    const server: McpServer = {
      id: "test",
      name: "Test Server",
      url: "https://mcp.example.com",
      headers: {},
      transport: "streamable_http",
      command: null,
      args: null,
      env: null,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const result = buildMcpToolsDescription([
      {
        server,
        tools: [
          {
            name: "search",
            description: "Search the web",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"]
            }
          }
        ]
      }
    ]);

    expect(result).toContain("Test Server");
    expect(result).toContain("search");
    expect(result).toContain("Search the web");
    expect(result).toContain("query");
  });

  it("returns empty string for no tools", () => {
    const server: McpServer = {
      id: "test",
      name: "Empty",
      url: "https://mcp.example.com",
      headers: {},
      transport: "streamable_http",
      command: null,
      args: null,
      env: null,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const result = buildMcpToolsDescription([{ server, tools: [] }]);
    expect(result).toBe("");
  });
});
