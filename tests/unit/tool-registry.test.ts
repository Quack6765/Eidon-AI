import { describe, expect, it } from "vitest";

import {
  BUILTIN_TOOL_RECORDS,
  buildToolDefinitions,
  executeToolCall,
  getToolRecord,
  type ToolDefinitionsInput
} from "@/lib/tool-registry";
import { TOOL_TRAITS } from "@/lib/tool-traits";

function definitionsInput(overrides: Partial<ToolDefinitionsInput> = {}): ToolDefinitionsInput {
  return {
    mcpToolSets: [],
    skills: [],
    loadedSkillIds: new Set<string>(),
    memoriesEnabled: true,
    effectiveVisionMode: "none",
    ...overrides
  };
}

function toolNames(input: ToolDefinitionsInput) {
  return buildToolDefinitions(input).map((tool) => tool.function.name);
}

const ALWAYS_ON_TOOLS = [
  "execute_shell_command",
  "run_python",
  "create_automation",
  "request_takeover",
  "request_secret",
  "list_secrets",
  "save_secret",
  "read_page"
];

const SENDING_MCP_TOOL_SET = {
  server: {
    id: "srv_1",
    slug: "gmail",
    name: "Gmail",
    url: "https://mcp.example/gmail",
    headers: [],
    transport: "http",
    command: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastStatus: "connected",
    lastError: null,
    toolCount: 1
  },
  tools: [{ name: "send_message", description: "Send an email" }]
} as unknown as ToolDefinitionsInput["mcpToolSets"][number];

describe("tool registry", () => {
  it("registers every built-in tool exactly once", () => {
    const names = BUILTIN_TOOL_RECORDS.map((record) => record.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(Object.keys(TOOL_TRAITS).sort());
  });

  it("carries the traits declared for each tool", () => {
    for (const record of BUILTIN_TOOL_RECORDS) {
      expect(record.traits).toEqual(TOOL_TRAITS[record.name]);
    }
    expect(getToolRecord("web_search")?.traits.parallelizable).toBe(true);
    expect(getToolRecord("generate_image")?.traits.oncePerTurn).toBe(true);
    expect(getToolRecord("unknown_tool")).toBeUndefined();
  });

  it("derives the always-on tool definitions from the records in registry order", () => {
    const names = toolNames(definitionsInput());
    for (const name of ALWAYS_ON_TOOLS) {
      expect(names).toContain(name);
    }
    expect(names.indexOf("execute_shell_command")).toBeLessThan(names.indexOf("run_python"));
    expect(names.indexOf("run_python")).toBeLessThan(names.indexOf("read_page"));
  });

  it("emits every built-in definition through its record", () => {
    const names = toolNames(
      definitionsInput({
        mcpToolSets: [SENDING_MCP_TOOL_SET],
        skills: [{ id: "skill_1", name: "research", content: "" } as ToolDefinitionsInput["skills"][number]],
        skillManageEnabled: true,
        webSearchEnabled: true,
        visionToolEnabled: true,
        semanticRecallAvailable: true,
        imageGenerationProviderId: "openai_gpt_image",
        botTeam: { isChief: true, roster: [] }
      })
    );
    for (const record of BUILTIN_TOOL_RECORDS) {
      expect(names).toContain(record.name);
    }
    expect(names).toContain("mcp_gmail_send_message");
    expect(names.indexOf("mcp_gmail_send_message")).toBeLessThan(names.indexOf("draft_message"));
  });

  it("omits gated tools when their capability is off", () => {
    const base = toolNames(definitionsInput({ memoriesEnabled: false }));
    expect(base).not.toContain("web_search");
    expect(base).not.toContain("search_workspace");
    expect(base).not.toContain("analyze_image");
    expect(base).not.toContain("generate_image");
    expect(base).not.toContain("draft_message");
    expect(base).not.toContain("load_skill");
    expect(base).not.toContain("skill_manage");
    expect(base).not.toContain("message_bot");
    expect(base).not.toContain("create_memory");

    const enabled = toolNames(
      definitionsInput({
        memoriesEnabled: false,
        skills: [{ id: "skill_1", name: "research", content: "" } as ToolDefinitionsInput["skills"][number]],
        skillManageEnabled: true,
        webSearchEnabled: true,
        semanticRecallAvailable: true
      })
    );
    expect(enabled).toContain("load_skill");
    expect(enabled).toContain("skill_manage");
    expect(enabled).toContain("web_search");
    expect(enabled).toContain("search_workspace");
    expect(enabled).not.toContain("create_memory");
  });

  it("honors the tool allowlist", () => {
    const names = toolNames(definitionsInput({ toolAllowlist: ["read_page", "list_secrets"] }));
    expect(names).toEqual(["list_secrets", "read_page"]);
  });

  it("dispatches a registered tool through its record", async () => {
    const result = await executeToolCall(
      { id: "call_1", name: "check_bot", arguments: JSON.stringify({ bot: "helper" }) },
      {
        input: {},
        timelineSortOrder: 2,
        promptMessages: []
      }
    );
    expect(result.promptMessages).toHaveLength(1);
    expect(result.promptMessages[0]).toMatchObject({ role: "tool", toolCallId: "call_1" });
    expect(result.promptMessages[0].content).toBe(
      "Error: bot status checks are not available in this conversation"
    );
    expect(result.nextSortOrder).toBe(2);
  });

  it("rejects unknown tools and invalid arguments before dispatch", async () => {
    const context = { input: {}, timelineSortOrder: 0, promptMessages: [] };
    const unknown = await executeToolCall(
      { id: "call_1", name: "not_a_tool", arguments: "{}" },
      context
    );
    expect(unknown.promptMessages[0].content).toBe("Unknown tool: not_a_tool");

    const invalid = await executeToolCall(
      { id: "call_2", name: "check_bot", arguments: "{oops" },
      context
    );
    expect(invalid.promptMessages[0].content).toBe("Error: Invalid JSON arguments for tool check_bot");
  });

  it("routes mcp_ tool names to the MCP fallback rather than a record", async () => {
    const result = await executeToolCall(
      { id: "call_1", name: "mcp_missing_tool", arguments: "{}" },
      {
        input: { mcpToolSets: [] },
        timelineSortOrder: 0,
        promptMessages: []
      }
    );
    expect(result.promptMessages[0].content).toBe("The requested MCP tool does not exist.");
  });
});
