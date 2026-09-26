import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConversation,
  createMessage,
  createMessageAction,
  listMessageActionsForMessageIds
} from "@/lib/conversations";
import { createMcpServer, updateMcpServer } from "@/lib/mcp-servers";
import {
  buildMessageDraftFields,
  discardMessageDraft,
  sendMessageDraft,
  supersedeMessageDraft
} from "@/lib/message-drafts";
import {
  applyMessageDraftFieldValues,
  describeMessageDraftForPrompt,
  getMessageDraftExtraArguments,
  getMessageDraftFieldValue,
  isMessageDraftPayload
} from "@/lib/message-draft-display";
import { buildPromptMessages } from "@/lib/compaction";
import {
  assertOpenApiRequestBody,
  assertOpenApiResponse,
  assertWebSocketMessage
} from "@/tests/fixtures/mobile-contract-validator";
import { buildToolDefinitions } from "@/lib/tool-definitions";
import { executeDraftMessage, isProposalToolCall } from "@/lib/tool-executors";
import { isToolActivityAction } from "@/lib/tool-activity-summary";
import { createLocalUser } from "@/lib/users";
import type { McpServer, McpTool, MessageAction, MessageDraftProposalPayload, PromptMessage } from "@/lib/types";

const { requireUserMock, callMcpToolMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  callMcpToolMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/mcp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp-client")>()),
  callMcpTool: callMcpToolMock
}));

const SEND_EMAIL_TOOL: McpTool = {
  name: "send_email",
  title: "Send email",
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      body: { type: "string" },
      priority: { type: "string", enum: ["low", "normal", "high"] },
      thread_id: { type: "string", title: "Thread" },
      track_opens: { type: "boolean" }
    },
    required: ["to", "subject", "body"]
  }
};

const SEARCH_TOOL: McpTool = {
  name: "search_messages",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  annotations: { readOnlyHint: true }
};

function buildRouteUser(userId: string) {
  return {
    id: userId,
    username: "draft-route-user",
    role: "user" as const,
    authSource: "local" as const,
    passwordManagedBy: "local" as const,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z"
  };
}

async function createFixture(username: string) {
  const user = await createLocalUser({ username, password: "Password123!", role: "user" });
  const conversation = createConversation(undefined, undefined, undefined, user.id);
  const message = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "Here is the draft.",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0
  });
  const server = createMcpServer({ name: `Mail ${username}`, url: "https://mcp.example.com/mail" });
  return { user, conversation, message, server };
}

function buildDraftPayload(
  server: McpServer,
  overrides: Partial<MessageDraftProposalPayload> = {}
): MessageDraftProposalPayload {
  return {
    operation: "message_draft",
    mcpServerId: server.id,
    mcpServerName: server.name,
    mcpToolName: "send_email",
    toolLabel: "Send email",
    arguments: {
      to: ["sarah@example.com"],
      subject: "Q3 recap",
      body: "Hi Sarah,\n\nHere is the recap.",
      track_opens: false
    },
    fields: [
      { key: "to", label: "To", format: "list", required: true },
      { key: "subject", label: "Subject", format: "text", required: true },
      { key: "body", label: "Body", format: "multiline", required: true }
    ],
    ...overrides
  };
}

function createDraftAction(messageId: string, server: McpServer, overrides: Partial<MessageDraftProposalPayload> = {}) {
  return createMessageAction({
    messageId,
    kind: "draft_message",
    status: "pending",
    label: `Message draft for ${server.name}`,
    serverId: server.id,
    toolName: "draft_message",
    arguments: { tool: "mcp_mail_send_email", arguments: {} },
    proposalState: "pending",
    proposalPayload: buildDraftPayload(server, overrides)
  });
}

function readAction(action: MessageAction) {
  return listMessageActionsForMessageIds([action.messageId]).find((candidate) => candidate.id === action.id)!;
}

function buildExecutorContext(server: McpServer, conversationId?: string) {
  const startedActions: Array<Record<string, unknown>> = [];
  return {
    context: {
      input: {
        mcpToolSets: [{ server, tools: [SEND_EMAIL_TOOL, SEARCH_TOOL] }],
        conversationId,
        onActionStart: async (action: Record<string, unknown>) => {
          startedActions.push(action);
          return "act_draft_new";
        }
      },
      timelineSortOrder: 2,
      promptMessages: [] as PromptMessage[]
    },
    startedActions
  };
}

beforeEach(() => {
  requireUserMock.mockReset();
  callMcpToolMock.mockReset();
});

describe("message draft fields", () => {
  it("turns text arguments into editable fields, headers before the body", () => {
    const fields = buildMessageDraftFields(SEND_EMAIL_TOOL, {
      body: "Hello there",
      to: ["sarah@example.com"],
      subject: "Q3 recap",
      priority: "high",
      thread_id: "t_1",
      track_opens: true
    });

    expect(fields).toEqual([
      { key: "to", label: "To", format: "list", required: true },
      { key: "subject", label: "Subject", format: "text", required: true },
      { key: "thread_id", label: "Thread", format: "text", required: false },
      { key: "body", label: "Body", format: "multiline", required: true }
    ]);
  });

  it("treats long or multi-line values as multiline and humanizes keys", () => {
    const tool: McpTool = { name: "post", inputSchema: { type: "object", properties: {} } };
    const fields = buildMessageDraftFields(tool, {
      channelId: "C123",
      message_id: "m_1",
      summary: "a".repeat(121),
      intro: "one\ntwo",
      messageText: "hi"
    });

    expect(fields).toEqual([
      { key: "channelId", label: "Channel id", format: "text", required: false },
      { key: "message_id", label: "Message id", format: "text", required: false },
      { key: "summary", label: "Summary", format: "multiline", required: false },
      { key: "intro", label: "Intro", format: "multiline", required: false },
      { key: "messageText", label: "Message text", format: "multiline", required: false }
    ]);
  });

  it("applies edits only to known fields and splits list values", () => {
    const payload = buildDraftPayload({ id: "srv", name: "Mail" } as McpServer);
    const next = applyMessageDraftFieldValues(payload, {
      to: " a@example.com, ,b@example.com ",
      subject: "  New subject  ",
      body: "Body stays exact  ",
      track_opens: "true"
    });

    expect(next).toEqual({
      to: ["a@example.com", "b@example.com"],
      subject: "New subject",
      body: "Body stays exact  ",
      track_opens: false
    });
    expect(applyMessageDraftFieldValues(payload, undefined)).toEqual(payload.arguments);
  });

  it("reads field values and non-editable arguments for display", () => {
    const payload = buildDraftPayload({ id: "srv", name: "Mail" } as McpServer, {
      arguments: { to: ["a@example.com", 3, "b@example.com"], subject: 5, track_opens: true, cc: null }
    });

    expect(getMessageDraftFieldValue(payload, payload.fields[0])).toBe("a@example.com, b@example.com");
    expect(getMessageDraftFieldValue(payload, payload.fields[1])).toBe("");
    expect(getMessageDraftExtraArguments(payload)).toEqual([{ key: "track_opens", value: "true" }]);
    expect(isMessageDraftPayload(payload)).toBe(true);
    expect(isMessageDraftPayload({ ...payload, operation: "tool_approval" })).toBe(false);
    expect(isMessageDraftPayload(null)).toBe(false);
  });
});

describe("draft_message tool", () => {
  it("is offered only when a connected tool can send", () => {
    const server = { id: "srv", slug: "mail", name: "Mail", isVisionMcp: false } as McpServer;
    const baseInput = {
      skills: [],
      loadedSkillIds: new Set<string>(),
      memoriesEnabled: false,
      effectiveVisionMode: "none" as const
    };

    const withSender = buildToolDefinitions({ ...baseInput, mcpToolSets: [{ server, tools: [SEND_EMAIL_TOOL] }] });
    const readOnlyOnly = buildToolDefinitions({ ...baseInput, mcpToolSets: [{ server, tools: [SEARCH_TOOL] }] });

    expect(withSender.map((tool) => tool.function.name)).toContain("draft_message");
    expect(readOnlyOnly.map((tool) => tool.function.name)).not.toContain("draft_message");
    expect(isProposalToolCall("draft_message")).toBe(true);
    expect(isToolActivityAction({ kind: "draft_message" })).toBe(false);
  });

  it("creates a pending draft and tells the model nothing was sent", async () => {
    const { server } = await createFixture("draft-exec");
    const { context, startedActions } = buildExecutorContext(server);

    const result = await executeDraftMessage(
      "call_draft_1",
      {
        tool: `mcp_${server.slug}_send_email`,
        arguments: { to: ["sarah@example.com"], subject: "Q3 recap", body: "Hi Sarah", priority: "HIGH" }
      },
      context
    );

    expect(startedActions).toHaveLength(1);
    expect(startedActions[0]).toEqual(
      expect.objectContaining({
        kind: "draft_message",
        status: "pending",
        serverId: server.id,
        toolName: "draft_message",
        proposalState: "pending",
        proposalPayload: expect.objectContaining({
          operation: "message_draft",
          mcpServerId: server.id,
          mcpToolName: "send_email",
          toolLabel: "Send email",
          arguments: { to: ["sarah@example.com"], subject: "Q3 recap", body: "Hi Sarah", priority: "high" }
        })
      })
    );
    const toolResult = result.promptMessages.at(-1)?.content;
    expect(toolResult).toContain("Draft act_draft_new is ready");
    expect(toolResult).toContain("Nothing has been sent");
    expect(result.nextSortOrder).toBe(3);
    expect(callMcpToolMock).not.toHaveBeenCalled();
  });

  it("rejects calls it cannot turn into a reviewable draft", async () => {
    const { server } = await createFixture("draft-exec-errors");
    const { context, startedActions } = buildExecutorContext(server);
    const run = (args: Record<string, unknown>) =>
      executeDraftMessage("call_bad", args, context).then((result) => String(result.promptMessages.at(-1)?.content));

    await expect(run({ arguments: {} })).resolves.toContain("tool is required");
    await expect(run({ tool: `mcp_${server.slug}_send_email`, arguments: [] })).resolves.toContain(
      "arguments must be an object"
    );
    await expect(run({ tool: "mcp_unknown_send", arguments: {} })).resolves.toContain("is not a connected tool");
    await expect(run({ tool: "send_email", arguments: {} })).resolves.toContain("is not a connected tool");
    await expect(run({ tool: `mcp_${server.slug}_search_messages`, arguments: { query: "x" } })).resolves.toContain(
      "is read-only"
    );
    await expect(
      run({ tool: `mcp_${server.slug}_send_email`, arguments: { to: ["a@example.com"] } })
    ).resolves.toContain("missing required arguments for");
    await expect(
      run({
        tool: `mcp_${server.slug}_send_email`,
        arguments: { to: 4, subject: 5, body: 6 }
      })
    ).resolves.toContain("has no text for the user to review");
    expect(startedActions).toHaveLength(0);
  });

  it("withdraws the draft it replaces, but only inside the same conversation", async () => {
    const { conversation, message, server } = await createFixture("draft-exec-replace");
    const other = await createFixture("draft-exec-replace-other");
    const previous = createDraftAction(message.id, server);
    const foreign = createDraftAction(other.message.id, other.server);
    const { context } = buildExecutorContext(server, conversation.id);
    const args = {
      tool: `mcp_${server.slug}_send_email`,
      arguments: { to: ["sarah@example.com"], subject: "Q3 recap v2", body: "Shorter" }
    };

    const replaced = await executeDraftMessage("call_v2", { ...args, replaces_draft_id: previous.id }, context);
    const refused = await executeDraftMessage("call_v3", { ...args, replaces_draft_id: foreign.id }, context);

    expect(replaced.promptMessages.at(-1)?.content).toContain(`Draft ${previous.id} was withdrawn`);
    expect(readAction(previous)).toEqual(
      expect.objectContaining({ status: "completed", proposalState: "superseded" })
    );
    expect(refused.promptMessages.at(-1)?.content).toContain(`Draft ${foreign.id} was not replaced`);
    expect(readAction(foreign)).toEqual(expect.objectContaining({ status: "pending", proposalState: "pending" }));
    expect(supersedeMessageDraft(previous.id, conversation.id)).toBe(false);
  });
});

describe("sending and discarding drafts", () => {
  it("sends the edited draft through the connector exactly once", async () => {
    const { user, message, server } = await createFixture("draft-send");
    const draft = createDraftAction(message.id, server);
    callMcpToolMock.mockResolvedValue({ content: [{ type: "text", text: "Message sent: id 42" }] });

    const action = await sendMessageDraft(
      draft.id,
      { to: "sarah@example.com, lee@example.com", body: "Hi both" },
      user.id
    );

    expect(callMcpToolMock).toHaveBeenCalledTimes(1);
    expect(callMcpToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: server.id }),
      "send_email",
      { to: ["sarah@example.com", "lee@example.com"], subject: "Q3 recap", body: "Hi both", track_opens: false },
      expect.any(Number)
    );
    expect(action).toEqual(
      expect.objectContaining({
        status: "completed",
        proposalState: "approved",
        resultSummary: "Message sent: id 42",
        proposalPayload: expect.objectContaining({
          arguments: expect.objectContaining({ body: "Hi both" }),
          sendError: null
        })
      })
    );
    await expect(sendMessageDraft(draft.id, undefined, user.id)).rejects.toThrow("no longer waiting");
    expect(callMcpToolMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a second send while the first is still in flight", async () => {
    const { user, message, server } = await createFixture("draft-send-race");
    const draft = createDraftAction(message.id, server);
    let finish: (value: unknown) => void = () => undefined;
    callMcpToolMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const first = sendMessageDraft(draft.id, undefined, user.id);
    await Promise.resolve();

    expect(readAction(draft).status).toBe("running");
    await expect(sendMessageDraft(draft.id, undefined, user.id)).rejects.toThrow("no longer waiting");
    expect(() => discardMessageDraft(draft.id, user.id)).toThrow("no longer waiting");

    finish({ content: [{ type: "text", text: "ok" }] });
    await expect(first).resolves.toEqual(expect.objectContaining({ proposalState: "approved" }));
    expect(callMcpToolMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed draft editable with the error and the user's edits", async () => {
    const { user, message, server } = await createFixture("draft-send-fail");
    const draft = createDraftAction(message.id, server);
    callMcpToolMock.mockResolvedValueOnce({ content: [{ type: "text", text: "Invalid recipient" }], isError: true });

    const failed = await sendMessageDraft(draft.id, { subject: "Edited" }, user.id);

    expect(failed).toEqual(
      expect.objectContaining({
        status: "pending",
        proposalState: "pending",
        proposalPayload: expect.objectContaining({
          sendError: "Invalid recipient",
          arguments: expect.objectContaining({ subject: "Edited" })
        })
      })
    );

    callMcpToolMock.mockRejectedValueOnce(new Error("socket closed"));
    const thrown = await sendMessageDraft(draft.id, undefined, user.id);
    expect(thrown.proposalPayload).toEqual(expect.objectContaining({ sendError: "socket closed" }));

    callMcpToolMock.mockResolvedValueOnce({ content: [], isError: true });
    const empty = await sendMessageDraft(draft.id, undefined, user.id);
    expect(empty.proposalPayload).toEqual(expect.objectContaining({ sendError: "Tool call failed." }));

    callMcpToolMock.mockResolvedValueOnce({ content: [{ type: "text", text: "sent" }] });
    const retried = await sendMessageDraft(draft.id, undefined, user.id);
    expect(retried).toEqual(expect.objectContaining({ proposalState: "approved" }));
    expect(retried.proposalPayload).toEqual(expect.objectContaining({ sendError: null }));
  });

  it("refuses to send when an edit empties a required field", async () => {
    const { user, message, server } = await createFixture("draft-send-required");
    const draft = createDraftAction(message.id, server);

    await expect(sendMessageDraft(draft.id, { to: " , ", subject: "  " }, user.id)).rejects.toThrow(
      "To, Subject can't be empty"
    );
    expect(readAction(draft)).toEqual(expect.objectContaining({ status: "pending", proposalState: "pending" }));
    expect(callMcpToolMock).not.toHaveBeenCalled();
  });

  it("does not send when the connector is gone or turned off", async () => {
    const { user, message, server } = await createFixture("draft-send-disabled");
    const draft = createDraftAction(message.id, server);
    const orphan = createDraftAction(message.id, server, { mcpServerId: "mcp_missing" });
    updateMcpServer(server.id, { enabled: false });

    await expect(sendMessageDraft(draft.id, undefined, user.id)).rejects.toThrow("is not connected");
    await expect(sendMessageDraft(orphan.id, undefined, user.id)).rejects.toThrow("is not connected");
    expect(readAction(draft)).toEqual(expect.objectContaining({ status: "pending", proposalState: "pending" }));
    expect(callMcpToolMock).not.toHaveBeenCalled();
  });

  it("discards a draft without sending and scopes drafts to their owner", async () => {
    const { user, message, server } = await createFixture("draft-discard");
    const stranger = await createLocalUser({ username: "draft-discard-stranger", password: "Password123!", role: "user" });
    const draft = createDraftAction(message.id, server);
    const broken = createMessageAction({
      messageId: message.id,
      kind: "draft_message",
      status: "pending",
      label: "Broken draft",
      proposalState: "pending",
      proposalPayload: null
    });
    const memory = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Memory",
      proposalState: "pending"
    });

    expect(() => discardMessageDraft(draft.id, stranger.id)).toThrow("Draft not found");
    expect(() => discardMessageDraft(memory.id, user.id)).toThrow("Draft not found");
    expect(() => discardMessageDraft(broken.id, user.id)).toThrow("Draft content is missing");

    const discarded = discardMessageDraft(draft.id);
    expect(discarded).toEqual(
      expect.objectContaining({ status: "completed", proposalState: "dismissed", resultSummary: "Discarded" })
    );
    expect(() => discardMessageDraft(draft.id)).toThrow("no longer waiting");
    expect(callMcpToolMock).not.toHaveBeenCalled();
  });

  it("sends and discards through the message-action routes", async () => {
    const { user, message, server } = await createFixture("draft-routes");
    requireUserMock.mockResolvedValue(buildRouteUser(user.id));
    const toSend = createDraftAction(message.id, server);
    const toDiscard = createDraftAction(message.id, server);
    callMcpToolMock.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

    const { POST: approve } = await import("@/app/api/message-actions/[actionId]/approve/route");
    const { POST: dismiss } = await import("@/app/api/message-actions/[actionId]/dismiss/route");
    const sent = await approve(
      new Request(`http://localhost/api/message-actions/${toSend.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: { subject: "From route" } })
      }),
      { params: Promise.resolve({ actionId: toSend.id }) }
    );
    const discarded = await dismiss(
      new Request(`http://localhost/api/message-actions/${toDiscard.id}/dismiss`, { method: "POST" }),
      { params: Promise.resolve({ actionId: toDiscard.id }) }
    );
    const again = await approve(
      new Request(`http://localhost/api/message-actions/${toSend.id}/approve`, { method: "POST" }),
      { params: Promise.resolve({ actionId: toSend.id }) }
    );

    expect(sent.status).toBe(200);
    const sentBody = (await sent.json()) as { action: MessageAction };
    expect(sentBody.action.proposalState).toBe("approved");
    assertOpenApiRequestBody("/message-actions/{actionId}/approve", "post", { fields: { subject: "From route" } });
    assertOpenApiResponse("/message-actions/{actionId}/approve", "post", 200, { data: sentBody });
    assertWebSocketMessage("ServerMessage", {
      type: "delta",
      conversationId: message.conversationId,
      event: { type: "action_complete", action: { ...sentBody.action, timelineKind: "action" } }
    });
    expect(callMcpToolMock.mock.calls[0][2]).toEqual(expect.objectContaining({ subject: "From route" }));
    expect(discarded.status).toBe(200);
    expect(((await discarded.json()) as { action: MessageAction }).action.proposalState).toBe("dismissed");
    expect(again.status).toBe(400);
  });
});

describe("draft outcomes in later turns", () => {
  it("tells the model what happened to each draft", async () => {
    const { message, server } = await createFixture("draft-replay");
    const base = readAction(createDraftAction(message.id, server));

    const pending = describeMessageDraftForPrompt({
      ...base,
      proposalPayload: buildDraftPayload(server, { sendError: "Invalid recipient" })
    });
    const sent = describeMessageDraftForPrompt({ ...base, status: "completed", proposalState: "approved", resultSummary: "id 42" });
    const sentQuietly = describeMessageDraftForPrompt({ ...base, status: "completed", proposalState: "approved", resultSummary: "" });

    expect(pending).toContain(`Draft ${base.id} for ${server.name} (Send email) is still waiting`);
    expect(pending).toContain("The last send attempt failed: Invalid recipient");
    expect(pending).toContain("To: sarah@example.com");
    expect(pending).toContain("track_opens: false");
    expect(sent).toContain("This is exactly what was sent");
    expect(sent).toContain("Subject: Q3 recap");
    expect(sent).toContain("Result: id 42");
    expect(sentQuietly).not.toContain("Result:");
    expect(describeMessageDraftForPrompt({ ...base, status: "completed", proposalState: "dismissed" })).toContain(
      "discarded"
    );
    expect(describeMessageDraftForPrompt({ ...base, status: "completed", proposalState: "superseded" })).toContain(
      "replaced by a revised draft"
    );
    expect(describeMessageDraftForPrompt({ ...base, status: "running" })).toContain("right now");
    expect(describeMessageDraftForPrompt({ ...base, status: "error" })).toContain("interrupted");
    expect(describeMessageDraftForPrompt({ ...base, proposalPayload: null })).toBe("Draft details are unavailable.");
  });

  it("replays every draft into the next prompt, whatever its state", async () => {
    const { conversation, message, server } = await createFixture("draft-replay-prompt");
    const draft = readAction(createDraftAction(message.id, server));

    const promptMessages = buildPromptMessages({
      systemPrompt: "Be exact.",
      messages: [
        {
          id: "msg_user",
          conversationId: conversation.id,
          role: "user",
          content: "Draft a recap to Sarah",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 0,
          systemKind: null,
          compactedAt: null,
          createdAt: "2026-09-25T00:00:00.000Z"
        },
        {
          id: message.id,
          conversationId: conversation.id,
          role: "assistant",
          content: "Here is the draft.",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 0,
          systemKind: null,
          compactedAt: null,
          createdAt: "2026-09-25T00:00:01.000Z",
          actions: [draft]
        }
      ],
      activeMemoryNodes: []
    });

    const assistant = promptMessages.find((entry) => entry.role === "assistant");
    const toolResult = promptMessages.find((entry) => entry.role === "tool");
    expect(assistant?.toolCalls).toEqual([
      expect.objectContaining({ id: draft.id, name: "draft_message" })
    ]);
    expect(toolResult?.content).toContain("is still waiting for the user to review and send");
  });
});
