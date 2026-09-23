import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  approveToolApproval,
  classifyShellCommand,
  createToolApprovalRules,
  dismissToolApproval,
  listToolApprovalRules,
  mcpToolApprovalFamily,
  requestToolExecutionApproval,
  revokeToolApprovalRule
} from "@/lib/tool-approvals";
import {
  createConversation,
  createMessage,
  createMessageAction,
  getMessageActionKind
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { executeMcpToolCall, executeShellCommand, type RuntimeAction } from "@/lib/tool-executors";
import { createLocalUser } from "@/lib/users";
import type {
  McpServer,
  McpTool,
  MessageActionKind,
  PromptMessage,
  ToolApprovalProposalPayload,
  ToolApprovalResolution
} from "@/lib/types";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

const localShellMocks = vi.hoisted(() => ({
  executeLocalShellCommand: vi.fn()
}));

vi.mock("@/lib/local-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local-shell")>();
  return {
    ...actual,
    executeLocalShellCommand: localShellMocks.executeLocalShellCommand
  };
});

const mcpMocks = vi.hoisted(() => ({
  callMcpTool: vi.fn(),
  getToolResultText: vi.fn()
}));

vi.mock("@/lib/mcp-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp-client")>();
  return {
    ...actual,
    callMcpTool: mcpMocks.callMcpTool,
    getToolResultText: mcpMocks.getToolResultText
  };
});

async function createUserMessageFixture(username: string) {
  const user = await createLocalUser({
    username,
    password: "Password123!",
    role: "user"
  });
  const conversation = createConversation(undefined, undefined, undefined, user.id);
  const message = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0
  });
  return { user, conversation, message };
}

function makeActionStarter(messageId: string) {
  const started: string[] = [];
  const onActionStart = vi.fn(async (action: RuntimeAction) => {
    const persisted = createMessageAction({ messageId, ...action });
    started.push(persisted.id);
    return persisted.id;
  });
  return { onActionStart, started };
}

function shellPayload(command: string): ToolApprovalProposalPayload {
  const classification = classifyShellCommand(command);
  return {
    operation: "tool_approval",
    scope: "shell",
    families: classification.families,
    classified: classification.classified,
    command
  };
}

function readActionRow(actionId: string) {
  return getDb()
    .prepare(
      "SELECT status, proposal_state, proposal_payload_json, result_summary FROM message_actions WHERE id = ?"
    )
    .get(actionId) as {
    status: string;
    proposal_state: string | null;
    proposal_payload_json: string | null;
    result_summary: string;
  };
}

function readActionResolution(actionId: string): ToolApprovalResolution | undefined {
  const row = readActionRow(actionId);
  if (!row.proposal_payload_json) return undefined;
  return (JSON.parse(row.proposal_payload_json) as ToolApprovalProposalPayload).resolution;
}

describe("classifyShellCommand", () => {
  it("extracts the binary family and strips env prefixes and wrappers", () => {
    expect(classifyShellCommand("FOO=1 curl https://example.com")).toEqual({
      families: ["curl"],
      classified: true
    });
    expect(classifyShellCommand("sudo rm -rf /tmp/x")).toEqual({
      families: ["rm"],
      classified: true
    });
    expect(classifyShellCommand("sudo -u bob curl https://example.com")).toEqual({
      families: ["curl"],
      classified: true
    });
    expect(classifyShellCommand("env FOO=1 BAR=2 wget https://example.com")).toEqual({
      families: ["wget"],
      classified: true
    });
    expect(classifyShellCommand("npx -y cowsay hello")).toEqual({
      families: ["cowsay"],
      classified: true
    });
    expect(classifyShellCommand("pnpm exec eslint .")).toEqual({
      families: ["eslint"],
      classified: true
    });
    expect(classifyShellCommand("yarn install")).toEqual({
      families: ["yarn"],
      classified: true
    });
    expect(classifyShellCommand("/usr/bin/curl https://example.com")).toEqual({
      families: ["curl"],
      classified: true
    });
  });

  it("collects every family of pipelines and compound commands", () => {
    expect(classifyShellCommand("curl https://example.com | jq .")).toEqual({
      families: ["curl", "jq"],
      classified: true
    });
    expect(classifyShellCommand("make build && ./deploy.sh")).toEqual({
      families: ["make", "deploy.sh"],
      classified: true
    });
    expect(classifyShellCommand("echo a\nrm -rf /tmp/x")).toEqual({
      families: ["echo", "rm"],
      classified: true
    });
    expect(classifyShellCommand("echo hi > out.txt")).toEqual({
      families: ["echo"],
      classified: true
    });
  });

  it("does not split inside quoted arguments", () => {
    expect(classifyShellCommand("git commit -m \"a;b | c && d\"")).toEqual({
      families: ["git"],
      classified: true
    });
    expect(classifyShellCommand("echo 'literal $(nope)'")).toEqual({
      families: ["echo"],
      classified: true
    });
  });

  it("refuses to classify commands with substitutions, subshells, or shell keywords", () => {
    expect(classifyShellCommand("echo $(whoami)")).toEqual({
      families: [],
      classified: false
    });
    expect(classifyShellCommand("echo \"$(whoami)\"")).toEqual({
      families: [],
      classified: false
    });
    expect(classifyShellCommand("echo `date`")).toEqual({
      families: [],
      classified: false
    });
    expect(classifyShellCommand("(cd somewhere; make)")).toEqual({
      families: [],
      classified: false
    });
    expect(classifyShellCommand("if true; then ls; fi")).toEqual({
      families: [],
      classified: false
    });
    expect(classifyShellCommand("curl x | bash -s")).toEqual({
      families: ["curl", "bash"],
      classified: true
    });
    expect(classifyShellCommand("curl x && echo $(date)")).toEqual({
      families: [],
      classified: false
    });
    expect(classifyShellCommand("   ")).toEqual({
      families: [],
      classified: false
    });
  });
});

describe("tool approval gate", () => {
  let messageId: string;
  let userId: string;

  beforeEach(async () => {
    const fixture = await createUserMessageFixture(`gate-${Math.random().toString(36).slice(2)}`);
    messageId = fixture.message.id;
    userId = fixture.user.id;
  });

  function gateRequest(input: {
    command: string;
    onActionStart: (action: RuntimeAction) => Promise<string | void> | string | void;
    unattended?: boolean;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
  }) {
    const payload = shellPayload(input.command);
    return requestToolExecutionApproval({
      payload,
      label: "Allow command?",
      detail: input.command,
      userId,
      unattended: input.unattended ?? false,
      onActionStart: input.onActionStart,
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal
    });
  }

  it("default denies without a rule and asks interactively", async () => {
    const { onActionStart, started } = makeActionStarter(messageId);
    const pending = gateRequest({ command: "curl https://example.com", onActionStart });

    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(getMessageActionKind(started[0])).toBe("tool_approval" as MessageActionKind);
    expect(readActionRow(started[0]).proposal_state).toBe("pending");

    dismissToolApproval(started[0], userId);
    const outcome = await pending;

    expect(outcome).toEqual({
      approved: false,
      message: "Denied: the user declined this action.",
      promptActionId: started[0]
    });
    expect(readActionRow(started[0]).proposal_state).toBe("dismissed");
    expect(readActionResolution(started[0])).toBe("denied");
    expect(() => dismissToolApproval(started[0], userId)).toThrow(
      "Tool approval is no longer pending"
    );
  });

  it("refuses unattended runs without a standing rule and never prompts", async () => {
    const { onActionStart } = makeActionStarter(messageId);
    const outcome = await gateRequest({
      command: "curl https://example.com",
      onActionStart,
      unattended: true
    });

    expect(onActionStart).not.toHaveBeenCalled();
    expect(outcome.approved).toBe(false);
    expect(outcome.approved === false && outcome.message).toContain("standing approval");
  });

  it("allow once runs only this call and prompts again for the next variant", async () => {
    const first = makeActionStarter(messageId);
    const pending = gateRequest({ command: "curl https://a.example", onActionStart: first.onActionStart });
    await vi.waitFor(() => expect(first.started).toHaveLength(1));

    approveToolApproval(first.started[0], undefined, userId);
    expect(await pending).toEqual({ approved: true });
    expect(listToolApprovalRules(userId)).toHaveLength(0);

    const second = makeActionStarter(messageId);
    const nextPending = gateRequest({
      command: "curl https://b.example",
      onActionStart: second.onActionStart
    });
    await vi.waitFor(() => expect(second.started).toHaveLength(1));
    expect(second.started[0]).not.toBe(first.started[0]);

    dismissToolApproval(second.started[0], userId);
    expect((await nextPending).approved).toBe(false);
  });

  it("allow always grants a wildcard that covers the same family with different arguments", async () => {
    const first = makeActionStarter(messageId);
    const pending = gateRequest({
      command: "curl https://a.example -X GET",
      onActionStart: first.onActionStart
    });
    await vi.waitFor(() => expect(first.started).toHaveLength(1));

    approveToolApproval(first.started[0], { allowAlways: true }, userId);
    expect(await pending).toEqual({ approved: true });

    const rules = listToolApprovalRules(userId);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(
      expect.objectContaining({ scope: "shell", family: "curl", userId })
    );

    const second = makeActionStarter(messageId);
    const outcome = await gateRequest({
      command: "curl https://other.example -X POST -d @payload.json",
      onActionStart: second.onActionStart
    });

    expect(outcome).toEqual({ approved: true });
    expect(second.onActionStart).not.toHaveBeenCalled();
  });

  it("allow always on a pipeline grants every family in the command", async () => {
    const starter = makeActionStarter(messageId);
    const pending = gateRequest({
      command: "curl https://a.example | jq .",
      onActionStart: starter.onActionStart
    });
    await vi.waitFor(() => expect(starter.started).toHaveLength(1));

    approveToolApproval(starter.started[0], { allowAlways: true }, userId);
    await pending;

    expect(listToolApprovalRules(userId).map((rule) => rule.family).sort()).toEqual([
      "curl",
      "jq"
    ]);

    const second = makeActionStarter(messageId);
    const outcome = await gateRequest({ command: "jq .data", onActionStart: second.onActionStart });
    expect(outcome).toEqual({ approved: true });
    expect(second.onActionStart).not.toHaveBeenCalled();
  });

  it("revoking a wildcard rule requires approval again", async () => {
    createToolApprovalRules(userId, "shell", ["curl"]);
    const first = makeActionStarter(messageId);
    expect(
      await gateRequest({ command: "curl https://a.example", onActionStart: first.onActionStart })
    ).toEqual({ approved: true });

    const rule = listToolApprovalRules(userId)[0];
    expect(revokeToolApprovalRule(rule.id, userId)).toBe(true);
    expect(listToolApprovalRules(userId)).toHaveLength(0);
    expect(revokeToolApprovalRule(rule.id, userId)).toBe(false);

    const second = makeActionStarter(messageId);
    const pending = gateRequest({
      command: "curl https://b.example",
      onActionStart: second.onActionStart
    });
    await vi.waitFor(() => expect(second.started).toHaveLength(1));
    dismissToolApproval(second.started[0], userId);
    expect((await pending).approved).toBe(false);
  });

  it("never wildcard-allows unclassified commands", async () => {
    const { onActionStart, started } = makeActionStarter(messageId);
    const pending = gateRequest({
      command: "echo $(hostname)",
      onActionStart,
      timeoutMs: 5_000
    });
    await vi.waitFor(() => expect(started).toHaveLength(1));

    expect(() => approveToolApproval(started[0], { allowAlways: true }, userId)).toThrow(
      "no command family"
    );

    approveToolApproval(started[0], undefined, userId);
    expect(await pending).toEqual({ approved: true });
    expect(listToolApprovalRules(userId)).toHaveLength(0);
  });

  it("expires a pending request after the timeout without executing", async () => {
    const { onActionStart, started } = makeActionStarter(messageId);
    const outcome = await gateRequest({
      command: "curl https://slow.example",
      onActionStart,
      timeoutMs: 25
    });

    expect(started).toHaveLength(1);
    expect(outcome).toEqual({
      approved: false,
      message: "Denied: the approval request expired before the user decided.",
      promptActionId: started[0]
    });
    expect(readActionRow(started[0]).proposal_state).toBe("dismissed");
    expect(readActionResolution(started[0])).toBe("expired");
    expect(() => approveToolApproval(started[0], undefined, userId)).toThrow(
      "Tool approval is no longer pending"
    );
  });

  it("resolves a pending request as stopped when the turn is aborted", async () => {
    const { onActionStart, started } = makeActionStarter(messageId);
    const controller = new AbortController();
    const pending = gateRequest({
      command: "curl https://slow.example",
      onActionStart,
      abortSignal: controller.signal
    });
    await vi.waitFor(() => expect(started).toHaveLength(1));

    controller.abort();
    const outcome = await pending;

    expect(outcome).toEqual({
      approved: false,
      message: "Denied: the approval request was stopped.",
      promptActionId: started[0]
    });
    expect(readActionResolution(started[0])).toBe("stopped");
  });

  it("adopts a decision that lands before the request starts waiting", async () => {
    const onActionStart = vi.fn(async (action: RuntimeAction) => {
      const persisted = createMessageAction({ messageId, ...action });
      approveToolApproval(persisted.id, { allowAlways: true }, userId);
      return persisted.id;
    });

    const outcome = await gateRequest({
      command: "curl https://fast.example",
      onActionStart
    });

    expect(outcome).toEqual({ approved: true });
    expect(listToolApprovalRules(userId)).toHaveLength(1);
  });

  it("lets unattended runs use standing rules without prompting", async () => {
    createToolApprovalRules(userId, "shell", ["curl"]);
    const { onActionStart } = makeActionStarter(messageId);
    const outcome = await gateRequest({
      command: "curl https://a.example -X POST",
      onActionStart,
      unattended: true
    });

    expect(outcome).toEqual({ approved: true });
    expect(onActionStart).not.toHaveBeenCalled();
  });
});

describe("gated tool executors", () => {
  let messageId: string;
  let userId: string;

  beforeEach(async () => {
    const fixture = await createUserMessageFixture(`exec-${Math.random().toString(36).slice(2)}`);
    messageId = fixture.message.id;
    userId = fixture.user.id;
    localShellMocks.executeLocalShellCommand.mockReset();
    localShellMocks.executeLocalShellCommand.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      isError: false
    });
    mcpMocks.callMcpTool.mockReset();
    mcpMocks.callMcpTool.mockResolvedValue({ content: [], isError: false });
    mcpMocks.getToolResultText.mockReset();
    mcpMocks.getToolResultText.mockReturnValue("mock result");
  });

  function shellContext(input: {
    onActionStart: (action: RuntimeAction) => Promise<string | void> | string | void;
    unattended?: boolean;
  }) {
    return {
      input: {
        toolApproval: { userId, unattended: input.unattended ?? true },
        onActionStart: input.onActionStart
      },
      timelineSortOrder: 0,
      promptMessages: [] as PromptMessage[]
    };
  }

  it("does not execute a shell command without approval and tells the agent", async () => {
    const { onActionStart } = makeActionStarter(messageId);
    const result = await executeShellCommand(
      "call_shell",
      { command: "curl https://exfil.example" },
      shellContext({ onActionStart, unattended: true })
    );

    expect(localShellMocks.executeLocalShellCommand).not.toHaveBeenCalled();
    expect(result.promptMessages.at(-1)).toEqual(
      expect.objectContaining({ role: "tool" })
    );
    expect(JSON.stringify(result.promptMessages.at(-1))).toContain("Denied");
  });

  it("executes a shell command covered by a standing rule", async () => {
    createToolApprovalRules(userId, "shell", ["curl"]);
    const { onActionStart } = makeActionStarter(messageId);
    const result = await executeShellCommand(
      "call_shell",
      { command: "curl https://example.com" },
      shellContext({ onActionStart })
    );

    expect(localShellMocks.executeLocalShellCommand).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.promptMessages.at(-1))).toContain("Local shell command result");
  });

  it("executes a shell command after an interactive allow once", async () => {
    const onActionStart = vi.fn(async (action: RuntimeAction) => {
      const persisted = createMessageAction({ messageId, ...action });
      if (persisted.kind === "tool_approval") {
        approveToolApproval(persisted.id, undefined, userId);
      }
      return persisted.id;
    });

    const result = await executeShellCommand(
      "call_shell",
      { command: "echo hello" },
      shellContext({ onActionStart, unattended: false })
    );

    expect(localShellMocks.executeLocalShellCommand).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.promptMessages.at(-1))).toContain("Local shell command result");
  });

  it("does not execute an MCP tool without approval", async () => {
    const server: McpServer = {
      id: "srv_1",
      name: "Test Server",
      slug: "test_server",
      url: "http://localhost:9999",
      headers: {},
      transport: "streamable_http",
      command: null,
      args: null,
      env: null,
      enabled: true,
      isVisionMcp: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const tool: McpTool = {
      name: "ping",
      description: "Ping",
      inputSchema: { type: "object", properties: {} }
    };
    const { onActionStart } = makeActionStarter(messageId);

    const result = await executeMcpToolCall(
      "call_mcp",
      "mcp_test_server_ping",
      {},
      {
        input: {
          mcpToolSets: [{ server, tools: [tool] }],
          toolApproval: { userId, unattended: true },
          onActionStart
        },
        successfulReadOnlyToolResults: new Map(),
        timelineSortOrder: 0,
        promptMessages: [] as PromptMessage[]
      }
    );

    expect(mcpMocks.callMcpTool).not.toHaveBeenCalled();
    expect(JSON.stringify(result.promptMessages.at(-1))).toContain("Denied");
  });

  it("executes an MCP tool covered by a standing per-tool rule", async () => {
    const server: McpServer = {
      id: "srv_2",
      name: "Test Server",
      slug: "test_server",
      url: "http://localhost:9999",
      headers: {},
      transport: "streamable_http",
      command: null,
      args: null,
      env: null,
      enabled: true,
      isVisionMcp: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const tool: McpTool = {
      name: "ping",
      description: "Ping",
      inputSchema: { type: "object", properties: {} }
    };
    createToolApprovalRules(userId, "mcp", [mcpToolApprovalFamily(server.slug, tool.name)]);
    const { onActionStart } = makeActionStarter(messageId);

    await executeMcpToolCall(
      "call_mcp",
      "mcp_test_server_ping",
      {},
      {
        input: {
          mcpToolSets: [{ server, tools: [tool] }],
          toolApproval: { userId, unattended: true },
          onActionStart
        },
        successfulReadOnlyToolResults: new Map(),
        timelineSortOrder: 0,
        promptMessages: [] as PromptMessage[]
      }
    );

    expect(mcpMocks.callMcpTool).toHaveBeenCalledTimes(1);
  });
});

describe("tool approval routes", () => {
  function buildRouteUser(id: string) {
    return {
      id,
      username: "tool-approval-route-user",
      role: "user" as const,
      authSource: "local" as const,
      passwordManagedBy: "local" as const,
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z"
    };
  }

  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("approves with allow always through the route and records the rule", async () => {
    const { user, message } = await createUserMessageFixture("tool-approve-route");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));
    const created = createMessageAction({
      messageId: message.id,
      kind: "tool_approval",
      status: "pending",
      label: "Allow \"curl\" commands?",
      detail: "curl https://example.com",
      proposalState: "pending",
      proposalPayload: shellPayload("curl https://example.com")
    });

    const { POST } = await import("@/app/api/message-actions/[actionId]/approve/route");
    const response = await POST(
      new Request(`http://localhost/api/message-actions/${created.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowAlways: true })
      }),
      { params: Promise.resolve({ actionId: created.id }) }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      action?: { id: string; proposalState: string };
    };
    expect(payload.action).toEqual(
      expect.objectContaining({ id: created.id, proposalState: "approved" })
    );
    expect(listToolApprovalRules(user.id)).toEqual([
      expect.objectContaining({ scope: "shell", family: "curl" })
    ]);
  });

  it("denies through the dismiss route without creating rules", async () => {
    const { user, message } = await createUserMessageFixture("tool-dismiss-route");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));
    const created = createMessageAction({
      messageId: message.id,
      kind: "tool_approval",
      status: "pending",
      label: "Allow \"curl\" commands?",
      detail: "curl https://example.com",
      proposalState: "pending",
      proposalPayload: shellPayload("curl https://example.com")
    });

    const { POST } = await import("@/app/api/message-actions/[actionId]/dismiss/route");
    const response = await POST(
      new Request(`http://localhost/api/message-actions/${created.id}/dismiss`, {
        method: "POST"
      }),
      { params: Promise.resolve({ actionId: created.id }) }
    );

    expect(response.status).toBe(200);
    expect(readActionRow(created.id).proposal_state).toBe("dismissed");
    expect(listToolApprovalRules(user.id)).toHaveLength(0);
  });

  it("lists and revokes standing rules through the tool-approvals routes", async () => {
    const { user } = await createUserMessageFixture("tool-rules-route");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));
    createToolApprovalRules(user.id, "shell", ["curl"]);

    const { GET } = await import("@/app/api/tool-approvals/route");
    const listResponse = await GET();
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as {
      rules: Array<{ id: string; family: string }>;
    };
    expect(listPayload.rules).toEqual([
      expect.objectContaining({ scope: "shell", family: "curl" })
    ]);

    const ruleId = listPayload.rules[0].id;
    const { DELETE } = await import("@/app/api/tool-approvals/[ruleId]/route");
    const revokeResponse = await DELETE(
      new Request(`http://localhost/api/tool-approvals/${ruleId}`, { method: "DELETE" }),
      { params: Promise.resolve({ ruleId }) }
    );
    expect(revokeResponse.status).toBe(200);
    expect(listToolApprovalRules(user.id)).toHaveLength(0);

    const missingResponse = await DELETE(
      new Request(`http://localhost/api/tool-approvals/${ruleId}`, { method: "DELETE" }),
      { params: Promise.resolve({ ruleId }) }
    );
    expect(missingResponse.status).toBe(404);
  });
});
