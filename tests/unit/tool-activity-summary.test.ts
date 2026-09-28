import { describe, expect, it } from "vitest";

import {
  isMessageBotActionKind,
  isToolActivityAction,
  summarizeToolActivity,
  type ToolActivitySource
} from "@/lib/tool-activity-summary";

function createAction(overrides: Partial<ToolActivitySource> = {}): ToolActivitySource {
  return {
    id: "act_1",
    kind: "mcp_tool_call",
    toolName: "search_docs",
    label: "Search docs",
    detail: "",
    status: "completed",
    arguments: null,
    ...overrides
  };
}

describe("isMessageBotActionKind", () => {
  it("recognises both delegation kinds", () => {
    expect(isMessageBotActionKind("delegate_task")).toBe(true);
    expect(isMessageBotActionKind("message_bot")).toBe(true);
    expect(isMessageBotActionKind("mcp_tool_call")).toBe(false);
  });
});

describe("isToolActivityAction", () => {
  it("keeps tool calls and drops proposals and delegations", () => {
    expect(isToolActivityAction({ kind: "mcp_tool_call" })).toBe(true);
    expect(isToolActivityAction({ kind: "shell_command" })).toBe(true);
    expect(isToolActivityAction({ kind: "create_memory" })).toBe(false);
    expect(isToolActivityAction({ kind: "update_memory" })).toBe(false);
    expect(isToolActivityAction({ kind: "delete_memory" })).toBe(false);
    expect(isToolActivityAction({ kind: "create_automation" })).toBe(false);
    expect(isToolActivityAction({ kind: "delegate_task" })).toBe(false);
    expect(isToolActivityAction({ kind: "message_bot" })).toBe(false);
  });
});

describe("summarizeToolActivity", () => {
  it("returns an empty summary for a turn without calls", () => {
    expect(summarizeToolActivity([])).toEqual({ rows: [], text: "", total: 0 });
  });

  it("buckets web searches, pages read and everything else", () => {
    const summary = summarizeToolActivity([
      createAction({ id: "call_1" }),
      createAction({ id: "call_2", kind: "shell_command", toolName: "execute_shell_command", label: "Local command" }),
      createAction({ id: "search_1", toolName: "web_search", label: "Web search" }),
      createAction({ id: "search_2", toolName: "web_search", label: "Web search" }),
      createAction({ id: "search_3", toolName: "web_search", label: "Web search" }),
      createAction({ id: "search_4", toolName: "web_search", label: "Web search" }),
      createAction({ id: "page_1", toolName: "read_page", label: "Read page" }),
      createAction({ id: "page_2", toolName: "read_page", label: "Read page" }),
      createAction({ id: "page_3", toolName: "read_page", label: "Read page" }),
      createAction({ id: "page_4", toolName: "read_page", label: "Read page" }),
      createAction({ id: "page_5", toolName: "read_page", label: "Read page" }),
      createAction({ id: "page_6", toolName: "read_page", label: "Read page" })
    ]);

    expect(summary.text).toBe("2 tools, 4 web searches, 6 pages read");
    expect(summary.total).toBe(12);
  });

  it("uses singular copy for single counts", () => {
    const summary = summarizeToolActivity([
      createAction({ id: "call_1" }),
      createAction({ id: "search_1", toolName: "web_search", label: "Web search" }),
      createAction({ id: "page_1", toolName: "read_page", label: "Read page" })
    ]);

    expect(summary.text).toBe("1 tool, 1 web search, 1 page read");
  });

  it("omits empty buckets", () => {
    expect(summarizeToolActivity([createAction()]).text).toBe("1 tool");
    expect(
      summarizeToolActivity([createAction({ toolName: "web_search", label: "Web search" })]).text
    ).toBe("1 web search");
    expect(
      summarizeToolActivity([createAction({ toolName: "read_page", label: "Read page" })]).text
    ).toBe("1 page read");
  });

  it("keeps the buckets in a stable order regardless of call order", () => {
    const summary = summarizeToolActivity([
      createAction({ id: "page_1", toolName: "read_page", label: "Read page" }),
      createAction({ id: "search_1", toolName: "web_search", label: "Web search" }),
      createAction({ id: "call_1" })
    ]);

    expect(summary.text).toBe("1 tool, 1 web search, 1 page read");
  });

  it("excludes proposals and delegations from counts and rows", () => {
    const summary = summarizeToolActivity([
      createAction({ id: "memory_1", kind: "create_memory", label: "Create memory proposal" }),
      createAction({ id: "automation_1", kind: "create_automation", label: "Automation proposal" }),
      createAction({ id: "delegate_1", kind: "delegate_task", label: "Messaged Researcher" }),
      createAction({ id: "call_1" })
    ]);

    expect(summary.text).toBe("1 tool");
    expect(summary.rows.map((row) => row.id)).toEqual(["call_1"]);
  });

  it("builds a flat row per call with status and meta", () => {
    const summary = summarizeToolActivity([
      createAction({
        id: "search_1",
        toolName: "web_search",
        label: "Web search",
        detail: "q3 benchmarks; market growth",
        arguments: { queries: ["q3 benchmarks", "market growth"] },
        status: "running"
      }),
      createAction({
        id: "page_1",
        toolName: "read_page",
        label: "Read page",
        detail: "https://example.com/report",
        status: "completed"
      }),
      createAction({
        id: "shell_1",
        kind: "shell_command",
        toolName: "execute_shell_command",
        label: "Local command",
        detail: "npm test\n--runInBand",
        status: "error"
      })
    ]);

    expect(summary.rows).toEqual([
      {
        id: "search_1",
        label: "Web search",
        meta: "q3 benchmarks; market growth",
        status: "running"
      },
      {
        id: "page_1",
        label: "Read page",
        meta: "https://example.com/report",
        status: "completed"
      },
      {
        id: "shell_1",
        label: "Local command",
        meta: "npm test --runInBand",
        status: "error"
      }
    ]);
  });

  it("prefers the web search query over its detail line", () => {
    const summary = summarizeToolActivity([
      createAction({
        toolName: "web_search",
        label: "Web search",
        detail: "q3 benchmarks; market growth",
        arguments: { query: "q3 benchmarks" }
      })
    ]);

    expect(summary.rows[0].meta).toBe("q3 benchmarks");
  });

  it("falls back to detail for a web search without arguments", () => {
    const summary = summarizeToolActivity([
      createAction({
        toolName: "web_search",
        label: "Web search",
        detail: "q3 benchmarks",
        arguments: null
      })
    ]);

    expect(summary.rows[0].meta).toBe("q3 benchmarks");
  });
});
