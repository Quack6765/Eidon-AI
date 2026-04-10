import { beforeEach, describe, it, expect, vi } from "vitest";
import { buildCopilotTools } from "@/lib/copilot-tools";
import type { McpServer, McpTool, Skill } from "@/lib/types";

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "mock result" }],
    isError: false
  }),
  getToolResultText: vi.fn().mockReturnValue("mock result")
}));

vi.mock("@/lib/local-shell", () => ({
  executeLocalShellCommand: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    isError: false
  }),
  summarizeShellResult: vi.fn().mockReturnValue("ok")
}));

vi.mock("@/lib/memories", () => ({
  createMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  getMemoryCount: vi.fn().mockReturnValue(0)
}));

vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn().mockReturnValue({ memoriesMaxCount: 100 })
}));

vi.mock("@/lib/skill-metadata", () => ({
  parseSkillContentMetadata: vi.fn().mockReturnValue({ name: "", description: "" })
}));

vi.mock("@/lib/tool-schema-helpers", () => ({
  extractEnumHints: vi.fn().mockReturnValue(""),
  coerceEnumValues: vi.fn((_schema: unknown, args: Record<string, unknown>) => args)
}));

function makeMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "server_1",
    name: "Test Server",
    url: "http://localhost:8080",
    headers: {},
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeMcpTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    name: "read_file",
    description: "Read a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    },
    annotations: { readOnlyHint: true },
    ...overrides
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_browser",
    name: "browser",
    description: "Browse the web",
    content: "# Browser Skill\nNavigate websites and take screenshots.",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeCtx(overrides: Partial<Parameters<typeof buildCopilotTools>[0]> = {}) {
  return {
    mcpToolSets: [],
    skills: [],
    loadedSkillIds: new Set<string>(),
    memoriesEnabled: false,
    onActionStart: vi.fn(),
    onActionComplete: vi.fn(),
    onActionError: vi.fn(),
    ...overrides
  };
}

function makeAppSettings(overrides: Partial<import("@/lib/types").AppSettings> = {}) {
  return {
    defaultProviderProfileId: "profile_default",
    skillsEnabled: true,
    conversationRetention: "forever" as const,
    autoCompaction: true,
    memoriesEnabled: true,
    memoriesMaxCount: 100,
    mcpTimeout: 30000,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("buildCopilotTools", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { callMcpTool, getToolResultText } = await import("@/lib/mcp-client");
    const { executeLocalShellCommand, summarizeShellResult } = await import("@/lib/local-shell");
    const { getMemoryCount } = await import("@/lib/memories");
    const { getSettings } = await import("@/lib/settings");
    const { parseSkillContentMetadata } = await import("@/lib/skill-metadata");
    const { coerceEnumValues } = await import("@/lib/tool-schema-helpers");

    vi.mocked(callMcpTool).mockResolvedValue({
      content: [{ type: "text", text: "mock result" }],
      isError: false
    });
    vi.mocked(getToolResultText).mockReturnValue("mock result");
    vi.mocked(executeLocalShellCommand).mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      isError: false
    });
    vi.mocked(summarizeShellResult).mockReturnValue("ok");
    vi.mocked(getMemoryCount).mockReturnValue(0);
    vi.mocked(getSettings).mockReturnValue(makeAppSettings());
    vi.mocked(parseSkillContentMetadata).mockReturnValue({
      name: "",
      description: "",
      shellCommandPrefixes: []
    });
    vi.mocked(coerceEnumValues).mockImplementation((_schema: unknown, args: Record<string, unknown>) => args);
  });

  it("creates copilot tools from MCP tool sets", () => {
    const ctx = makeCtx({
      mcpToolSets: [{ server: makeMcpServer(), tools: [makeMcpTool()] }]
    });

    const tools = buildCopilotTools(ctx);

    expect(tools.length).toBeGreaterThanOrEqual(2);
    const mcpTool = tools.find((t) => t.name === "mcp_server_1_read_file");
    expect(mcpTool).toBeDefined();
    expect(mcpTool!.description).toContain("read_file");
    expect(mcpTool!.handler).toBeInstanceOf(Function);
    expect(mcpTool!.skipPermission).toBe(true);
    expect(mcpTool!.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    });
  });

  it("creates shell, skill, and memory tools", () => {
    const ctx = makeCtx({
      skills: [makeSkill()],
      memoriesEnabled: true
    });

    const tools = buildCopilotTools(ctx);
    const names = tools.map((t) => t.name);

    expect(names).toContain("execute_shell_command");
    expect(names).toContain("load_skill");
    expect(names).toContain("create_memory");
    expect(names).toContain("update_memory");
    expect(names).toContain("delete_memory");
  });

  it("omits memory tools when memories are disabled", () => {
    const ctx = makeCtx({ memoriesEnabled: false });

    const tools = buildCopilotTools(ctx);
    const names = tools.map((t) => t.name);

    expect(names).not.toContain("create_memory");
    expect(names).not.toContain("update_memory");
    expect(names).not.toContain("delete_memory");
  });

  it("omits load_skill when no skills are provided", () => {
    const ctx = makeCtx({ skills: [] });

    const tools = buildCopilotTools(ctx);
    const names = tools.map((t) => t.name);

    expect(names).not.toContain("load_skill");
  });

  it("always includes shell tool", () => {
    const ctx = makeCtx();

    const tools = buildCopilotTools(ctx);

    expect(tools.find((t) => t.name === "execute_shell_command")).toBeDefined();
  });

  it("marks built-in name replacements as explicit overrides", () => {
    const ctx = makeCtx({
      skills: [makeSkill()]
    });

    const tools = buildCopilotTools(ctx);
    const shellTool = tools.find((t) => t.name === "execute_shell_command");
    const loadSkillTool = tools.find((t) => t.name === "load_skill");

    expect(shellTool?.overridesBuiltInTool).toBe(true);
    expect(loadSkillTool?.overridesBuiltInTool).toBe(true);
  });

  it("creates MCP tools with sanitized server id in function name", () => {
    const ctx = makeCtx({
      mcpToolSets: [{
        server: makeMcpServer({ id: "my-server/v2" }),
        tools: [makeMcpTool({ name: "search" })]
      }]
    });

    const tools = buildCopilotTools(ctx);

    expect(tools.find((t) => t.name === "mcp_my_server_v2_search")).toBeDefined();
  });

  it("annotates read-only MCP tools in description", () => {
    const ctx = makeCtx({
      mcpToolSets: [{
        server: makeMcpServer(),
        tools: [makeMcpTool({ annotations: { readOnlyHint: true } })]
      }]
    });

    const tools = buildCopilotTools(ctx);
    const mcpTool = tools.find((t) => t.name === "mcp_server_1_read_file");

    expect(mcpTool!.description).toContain("(read-only)");
  });

  it("falls back to empty object parameters when an MCP tool has no schema", () => {
    const ctx = makeCtx({
      mcpToolSets: [{
        server: makeMcpServer(),
        tools: [makeMcpTool({ inputSchema: undefined, annotations: {} })]
      }]
    });

    const tools = buildCopilotTools(ctx);
    const mcpTool = tools.find((t) => t.name === "mcp_server_1_read_file");

    expect(mcpTool?.parameters).toEqual({ type: "object", properties: {} });
  });

  it("handles MCP tool calls without args or schema", async () => {
    const onActionStart = vi.fn();
    const ctx = makeCtx({
      mcpToolSets: [{
        server: makeMcpServer(),
        tools: [makeMcpTool({ inputSchema: undefined, annotations: {} })]
      }],
      onActionStart
    });

    const tools = buildCopilotTools(ctx);
    const mcpTool = tools.find((t) => t.name === "mcp_server_1_read_file")!;

    await mcpTool.handler!(
      undefined,
      { sessionId: "s1", toolCallId: "tc1", toolName: "mcp_server_1_read_file", arguments: {} }
    );

    expect(onActionStart).toHaveBeenCalledWith(expect.objectContaining({
      detail: "",
      arguments: {}
    }));
  });

  it("calls onActionStart and onActionComplete when MCP tool handler executes", async () => {
    const onActionStart = vi.fn().mockResolvedValue("handle_1");
    const onActionComplete = vi.fn();
    const ctx = makeCtx({
      mcpToolSets: [{ server: makeMcpServer(), tools: [makeMcpTool()] }],
      onActionStart,
      onActionComplete
    });

    const tools = buildCopilotTools(ctx);
    const mcpTool = tools.find((t) => t.name === "mcp_server_1_read_file")!;

    const result = await mcpTool.handler!({ path: "/tmp/test.txt" }, { sessionId: "s1", toolCallId: "tc1", toolName: "mcp_server_1_read_file", arguments: { path: "/tmp/test.txt" } });

    expect(result).toBe("mock result");
    expect(onActionStart).toHaveBeenCalledWith(expect.objectContaining({
      kind: "mcp_tool_call",
      toolName: "read_file"
    }));
    expect(onActionComplete).toHaveBeenCalledWith("handle_1", expect.any(Object));
  });

  it("truncates structured MCP arguments in action summaries", async () => {
    const onActionStart = vi.fn();
    const onActionComplete = vi.fn();
    const ctx = makeCtx({
      mcpToolSets: [{ server: makeMcpServer(), tools: [makeMcpTool({ name: "search" })] }],
      onActionStart,
      onActionComplete
    });

    const tools = buildCopilotTools(ctx);
    const mcpTool = tools.find((t) => t.name === "mcp_server_1_search")!;

    await mcpTool.handler!(
      {
        filters: {
          tags: Array.from({ length: 40 }, (_, index) => `tag-${index}`)
        }
      },
      { sessionId: "s1", toolCallId: "tc1", toolName: "mcp_server_1_search", arguments: {} }
    );

    expect(onActionStart).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringMatching(/^{"filters":/)
    }));
    expect(onActionComplete).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        detail: expect.stringContaining("...")
      })
    );
  });

  it("calls onActionError when MCP tool result has isError", async () => {
    const { callMcpTool, getToolResultText } = await import("@/lib/mcp-client");
    vi.mocked(callMcpTool).mockResolvedValueOnce({
      content: [{ type: "text", text: "tool error" }],
      isError: true
    });
    vi.mocked(getToolResultText).mockReturnValueOnce("tool error");

    const onActionError = vi.fn();
    const ctx = makeCtx({
      mcpToolSets: [{ server: makeMcpServer(), tools: [makeMcpTool()] }],
      onActionError
    });

    const tools = buildCopilotTools(ctx);
    const mcpTool = tools.find((t) => t.name === "mcp_server_1_read_file")!;

    await mcpTool.handler!({ path: "/bad" }, { sessionId: "s1", toolCallId: "tc1", toolName: "mcp_server_1_read_file", arguments: { path: "/bad" } });

    expect(onActionError).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it("returns error string when shell command is empty", async () => {
    const ctx = makeCtx();

    const tools = buildCopilotTools(ctx);
    const shellTool = tools.find((t) => t.name === "execute_shell_command")!;

    const result = await shellTool.handler!({ command: "" }, { sessionId: "s1", toolCallId: "tc1", toolName: "execute_shell_command", arguments: { command: "" } });

    expect(result).toBe("Error: Shell command is required.");
  });

  it("records successful shell command execution", async () => {
    const { executeLocalShellCommand, summarizeShellResult } = await import("@/lib/local-shell");
    vi.mocked(executeLocalShellCommand).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "ready",
      stderr: "",
      timedOut: false,
      isError: false
    });
    vi.mocked(summarizeShellResult).mockReturnValueOnce("ready");

    const onActionStart = vi.fn().mockResolvedValue("shell_1");
    const onActionComplete = vi.fn();
    const ctx = makeCtx({ onActionStart, onActionComplete });

    const tools = buildCopilotTools(ctx);
    const shellTool = tools.find((t) => t.name === "execute_shell_command")!;

    const result = await shellTool.handler!(
      { command: "echo ready", timeout_ms: 5000 },
      { sessionId: "s1", toolCallId: "tc1", toolName: "execute_shell_command", arguments: {} }
    );

    expect(result).toContain("Status: success");
    expect(onActionStart).toHaveBeenCalledWith(expect.objectContaining({
      detail: "echo ready"
    }));
    expect(onActionComplete).toHaveBeenCalledWith("shell_1", {
      detail: "echo ready",
      resultSummary: "ready"
    });
  });

  it("records shell command error results", async () => {
    const { executeLocalShellCommand, summarizeShellResult } = await import("@/lib/local-shell");
    vi.mocked(executeLocalShellCommand).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "permission denied",
      timedOut: false,
      isError: true
    });
    vi.mocked(summarizeShellResult).mockReturnValueOnce("permission denied");

    const onActionError = vi.fn();
    const ctx = makeCtx({ onActionError });

    const tools = buildCopilotTools(ctx);
    const shellTool = tools.find((t) => t.name === "execute_shell_command")!;

    const result = await shellTool.handler!(
      { command: "rm protected-file" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "execute_shell_command", arguments: {} }
    );

    expect(result).toContain("Status: error");
    expect(onActionError).toHaveBeenCalledWith(undefined, {
      detail: "rm protected-file",
      resultSummary: "permission denied"
    });
  });

  it("returns shell execution exceptions as tool errors", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    vi.mocked(executeLocalShellCommand).mockRejectedValueOnce(new Error("spawn failed"));

    const onActionError = vi.fn();
    const ctx = makeCtx({ onActionError });

    const tools = buildCopilotTools(ctx);
    const shellTool = tools.find((t) => t.name === "execute_shell_command")!;

    const result = await shellTool.handler!(
      { command: "boom" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "execute_shell_command", arguments: {} }
    );

    expect(result).toBe("Error: spawn failed");
    expect(onActionError).toHaveBeenCalledWith(undefined, {
      detail: "boom",
      resultSummary: "spawn failed"
    });
  });

  it("shortens long shell commands in action details", async () => {
    const longCommand = `echo ${"x".repeat(160)}`;
    const onActionStart = vi.fn();
    const ctx = makeCtx({ onActionStart });

    const tools = buildCopilotTools(ctx);
    const shellTool = tools.find((t) => t.name === "execute_shell_command")!;

    await shellTool.handler!(
      { command: longCommand },
      { sessionId: "s1", toolCallId: "tc1", toolName: "execute_shell_command", arguments: {} }
    );

    expect(onActionStart).toHaveBeenCalledWith(expect.objectContaining({
      detail: `${longCommand.slice(0, 137)}...`
    }));
  });

  it("falls back to the generic shell failure message for non-Error throws", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    vi.mocked(executeLocalShellCommand).mockRejectedValueOnce("boom");

    const tools = buildCopilotTools(makeCtx());
    const shellTool = tools.find((t) => t.name === "execute_shell_command")!;

    const result = await shellTool.handler!(
      { command: "boom" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "execute_shell_command", arguments: {} }
    );

    expect(result).toBe("Error: Shell command execution failed");
  });

  it("returns a helpful error when a skill cannot be found", async () => {
    const ctx = makeCtx({
      skills: [makeSkill({ name: "browser" })]
    });

    const tools = buildCopilotTools(ctx);
    const loadSkillTool = tools.find((t) => t.name === "load_skill")!;

    const result = await loadSkillTool.handler!(
      { skill_name: "research" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "load_skill", arguments: {} }
    );

    expect(result).toContain('Skill "research" not found.');
    expect(result).toContain("browser");
  });

  it("falls back to the persisted skill description when metadata is empty", async () => {
    const skill = makeSkill({
      name: "browser",
      description: "Persisted description",
      content: "plain skill content"
    });
    const onActionStart = vi.fn().mockResolvedValue(42);
    const ctx = makeCtx({
      skills: [skill],
      onActionStart
    });

    const tools = buildCopilotTools(ctx);
    const loadSkillTool = tools.find((t) => t.name === "load_skill")!;

    const result = await loadSkillTool.handler!(
      { skill_name: "browser" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "load_skill", arguments: {} }
    );

    expect(result).toContain("Description: Persisted description");
  });

  it("handles load_skill calls with missing args", async () => {
    const ctx = makeCtx({
      skills: [makeSkill({ name: "browser" })]
    });

    const tools = buildCopilotTools(ctx);
    const loadSkillTool = tools.find((t) => t.name === "load_skill")!;

    const result = await loadSkillTool.handler!(
      undefined,
      { sessionId: "s1", toolCallId: "tc1", toolName: "load_skill", arguments: {} }
    );

    expect(result).toContain('Skill "" not found.');
  });

  it("returns early when a skill is already loaded", async () => {
    const skill = makeSkill();
    const ctx = makeCtx({
      skills: [skill],
      loadedSkillIds: new Set([skill.id])
    });

    const tools = buildCopilotTools(ctx);
    const loadSkillTool = tools.find((t) => t.name === "load_skill")!;

    const result = await loadSkillTool.handler!(
      { skill_name: skill.name },
      { sessionId: "s1", toolCallId: "tc1", toolName: "load_skill", arguments: {} }
    );

    expect(result).toBe("This skill is already loaded.");
  });

  it("loads a skill by metadata name and returns its metadata description", async () => {
    const { parseSkillContentMetadata } = await import("@/lib/skill-metadata");
    vi.mocked(parseSkillContentMetadata).mockImplementation((content: string) => {
      if (content === "research skill content") {
        return {
          name: "Deep Research",
          description: "Investigate a topic thoroughly",
          shellCommandPrefixes: []
        };
      }
      return { name: "", description: "", shellCommandPrefixes: [] };
    });

    const skill = makeSkill({
      name: "research",
      description: "fallback description",
      content: "research skill content"
    });
    const onActionComplete = vi.fn();
    const ctx = makeCtx({
      skills: [skill],
      onActionComplete
    });

    const tools = buildCopilotTools(ctx);
    const loadSkillTool = tools.find((t) => t.name === "load_skill")!;

    const result = await loadSkillTool.handler!(
      { skill_name: "deep research" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "load_skill", arguments: {} }
    );

    expect(result).toContain("Skill loaded: Deep Research");
    expect(result).toContain("Description: Investigate a topic thoroughly");
    expect(ctx.loadedSkillIds.has(skill.id)).toBe(true);
    expect(onActionComplete).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ resultSummary: "Skill instructions loaded." })
    );
  });

  it("returns error string when memory content is empty", async () => {
    const ctx = makeCtx({ memoriesEnabled: true });

    const tools = buildCopilotTools(ctx);
    const createMemoryTool = tools.find((t) => t.name === "create_memory")!;

    const result = await createMemoryTool.handler!({ content: "", category: "other" }, { sessionId: "s1", toolCallId: "tc1", toolName: "create_memory", arguments: { content: "", category: "other" } });

    expect(result).toBe("Error: content is required");
  });

  it("blocks memory creation when the configured limit is reached", async () => {
    const { getMemoryCount } = await import("@/lib/memories");
    const { getSettings } = await import("@/lib/settings");
    vi.mocked(getMemoryCount).mockReturnValueOnce(3);
    vi.mocked(getSettings).mockReturnValueOnce(makeAppSettings({ memoriesMaxCount: 3 }));

    const ctx = makeCtx({ memoriesEnabled: true });

    const tools = buildCopilotTools(ctx);
    const createMemoryTool = tools.find((t) => t.name === "create_memory")!;

    const result = await createMemoryTool.handler!(
      { content: "Favorite editor is Vim", category: "preference" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "create_memory", arguments: {} }
    );

    expect(result).toBe("Memory limit reached (3/3). Update or delete an existing memory instead.");
  });

  it("creates memories with invalid categories normalized to other", async () => {
    const { createMemory } = await import("@/lib/memories");
    const onActionComplete = vi.fn();
    const ctx = makeCtx({ memoriesEnabled: true, onActionComplete });

    const tools = buildCopilotTools(ctx);
    const createMemoryTool = tools.find((t) => t.name === "create_memory")!;

    const result = await createMemoryTool.handler!(
      { content: "Works in Toronto", category: "city" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "create_memory", arguments: {} }
    );

    expect(result).toBe("Memory saved: Works in Toronto [other]");
    expect(createMemory).toHaveBeenCalledWith("Works in Toronto", "other");
    expect(onActionComplete).toHaveBeenCalledWith(undefined, { resultSummary: "Saved as other" });
  });

  it("defaults omitted memory categories and limits", async () => {
    const { createMemory } = await import("@/lib/memories");
    const { getSettings } = await import("@/lib/settings");
    vi.mocked(getSettings).mockReturnValueOnce(makeAppSettings({ memoriesMaxCount: undefined as unknown as number }));

    const onActionStart = vi.fn().mockResolvedValue(7);
    const ctx = makeCtx({ memoriesEnabled: true, onActionStart });

    const tools = buildCopilotTools(ctx);
    const createMemoryTool = tools.find((t) => t.name === "create_memory")!;

    const result = await createMemoryTool.handler!(
      { content: "Lives near the office" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "create_memory", arguments: {} }
    );

    expect(result).toBe("Memory saved: Lives near the office [other]");
    expect(createMemory).toHaveBeenCalledWith("Lives near the office", "other");
  });

  it("records create memory failures without interrupting the tool response", async () => {
    const { createMemory } = await import("@/lib/memories");
    vi.mocked(createMemory).mockImplementationOnce(() => {
      throw "write failed";
    });

    const onActionError = vi.fn();
    const ctx = makeCtx({ memoriesEnabled: true, onActionError });

    const tools = buildCopilotTools(ctx);
    const createMemoryTool = tools.find((t) => t.name === "create_memory")!;

    const result = await createMemoryTool.handler!(
      { content: "Prefers concise answers", category: "preference" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "create_memory", arguments: {} }
    );

    expect(result).toBe("Memory saved: Prefers concise answers [preference]");
    expect(onActionError).toHaveBeenCalledWith(undefined, { resultSummary: "Failed to create memory" });
  });

  it("returns error string when update memory id is missing", async () => {
    const ctx = makeCtx({ memoriesEnabled: true });

    const tools = buildCopilotTools(ctx);
    const updateMemoryTool = tools.find((t) => t.name === "update_memory")!;

    const result = await updateMemoryTool.handler!({ id: "", content: "test" }, { sessionId: "s1", toolCallId: "tc1", toolName: "update_memory", arguments: { id: "", content: "test" } });

    expect(result).toBe("Error: id and content are required");
  });

  it("updates a memory with an explicit category", async () => {
    const { updateMemory } = await import("@/lib/memories");
    const onActionComplete = vi.fn();
    const ctx = makeCtx({ memoriesEnabled: true, onActionComplete });

    const tools = buildCopilotTools(ctx);
    const updateMemoryTool = tools.find((t) => t.name === "update_memory")!;

    const result = await updateMemoryTool.handler!(
      { id: "mem_1", content: "Prefers dark mode", category: "preference" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "update_memory", arguments: {} }
    );

    expect(result).toBe("Memory updated: Prefers dark mode");
    expect(updateMemory).toHaveBeenCalledWith("mem_1", {
      content: "Prefers dark mode",
      category: "preference"
    });
    expect(onActionComplete).toHaveBeenCalledWith(undefined, {
      detail: "Prefers dark mode",
      resultSummary: "Updated"
    });
  });

  it("records update memory failures without interrupting the tool response", async () => {
    const { updateMemory } = await import("@/lib/memories");
    vi.mocked(updateMemory).mockImplementationOnce(() => {
      throw "cannot update";
    });

    const onActionError = vi.fn();
    const ctx = makeCtx({ memoriesEnabled: true, onActionError });

    const tools = buildCopilotTools(ctx);
    const updateMemoryTool = tools.find((t) => t.name === "update_memory")!;

    const result = await updateMemoryTool.handler!(
      { id: "mem_1", content: "Updated detail" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "update_memory", arguments: {} }
    );

    expect(result).toBe("Memory updated: Updated detail");
    expect(onActionError).toHaveBeenCalledWith(undefined, { resultSummary: "Failed to update memory" });
  });

  it("returns update memory validation errors when args are missing", async () => {
    const ctx = makeCtx({ memoriesEnabled: true });

    const tools = buildCopilotTools(ctx);
    const updateMemoryTool = tools.find((t) => t.name === "update_memory")!;

    const result = await updateMemoryTool.handler!(
      undefined,
      { sessionId: "s1", toolCallId: "tc1", toolName: "update_memory", arguments: {} }
    );

    expect(result).toBe("Error: id and content are required");
  });

  it("returns error string when delete memory id is missing", async () => {
    const ctx = makeCtx({ memoriesEnabled: true });

    const tools = buildCopilotTools(ctx);
    const deleteMemoryTool = tools.find((t) => t.name === "delete_memory")!;

    const result = await deleteMemoryTool.handler!({ id: "" }, { sessionId: "s1", toolCallId: "tc1", toolName: "delete_memory", arguments: { id: "" } });

    expect(result).toBe("Error: id is required");
  });

  it("deletes a memory and records completion", async () => {
    const { deleteMemory } = await import("@/lib/memories");
    const onActionComplete = vi.fn();
    const ctx = makeCtx({ memoriesEnabled: true, onActionComplete });

    const tools = buildCopilotTools(ctx);
    const deleteMemoryTool = tools.find((t) => t.name === "delete_memory")!;

    const result = await deleteMemoryTool.handler!(
      { id: "mem_1" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "delete_memory", arguments: {} }
    );

    expect(result).toBe("Memory deleted: mem_1");
    expect(deleteMemory).toHaveBeenCalledWith("mem_1");
    expect(onActionComplete).toHaveBeenCalledWith(undefined, { resultSummary: "Deleted" });
  });

  it("records delete memory failures without interrupting the tool response", async () => {
    const { deleteMemory } = await import("@/lib/memories");
    vi.mocked(deleteMemory).mockImplementationOnce(() => {
      throw "cannot delete";
    });

    const onActionError = vi.fn();
    const ctx = makeCtx({ memoriesEnabled: true, onActionError });

    const tools = buildCopilotTools(ctx);
    const deleteMemoryTool = tools.find((t) => t.name === "delete_memory")!;

    const result = await deleteMemoryTool.handler!(
      { id: "mem_1" },
      { sessionId: "s1", toolCallId: "tc1", toolName: "delete_memory", arguments: {} }
    );

    expect(result).toBe("Memory deleted: mem_1");
    expect(onActionError).toHaveBeenCalledWith(undefined, { resultSummary: "Failed to delete memory" });
  });

  it("returns delete memory validation errors when args are missing", async () => {
    const ctx = makeCtx({ memoriesEnabled: true });

    const tools = buildCopilotTools(ctx);
    const deleteMemoryTool = tools.find((t) => t.name === "delete_memory")!;

    const result = await deleteMemoryTool.handler!(
      undefined,
      { sessionId: "s1", toolCallId: "tc1", toolName: "delete_memory", arguments: {} }
    );

    expect(result).toBe("Error: id is required");
  });
});
