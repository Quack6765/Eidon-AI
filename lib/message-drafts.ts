import { broadcastBotUpdateForMessage } from "@/lib/bot-runs";
import { getMessage, updateMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { callMcpTool, getToolResultText } from "@/lib/mcp-client";
import { getMcpServer } from "@/lib/mcp-servers";
import { isMessageDraftPayload } from "@/lib/message-draft-display";
import { getSettings } from "@/lib/settings";
import { getConversationManager } from "@/lib/ws-singleton";
import type {
  McpTool,
  McpToolCallResult,
  MessageAction,
  MessageDraftField,
  MessageDraftProposalPayload
} from "@/lib/types";
import { nowIso } from "@/lib/utils";

const MULTILINE_KEY_WORDS = new Set([
  "body",
  "text",
  "content",
  "message",
  "html",
  "markdown",
  "description",
  "comment",
  "note",
  "notes"
]);
const MULTILINE_VALUE_LENGTH = 120;
const NOT_PENDING_MESSAGE = "This draft is no longer waiting to be sent";

type SchemaProperty = {
  title?: unknown;
  enum?: unknown;
};

function splitKeyWords(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function humanizeKey(key: string) {
  const words = splitKeyWords(key).join(" ");
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : key;
}

export function buildMessageDraftFields(tool: McpTool, args: Record<string, unknown>): MessageDraftField[] {
  const properties = (tool.inputSchema?.properties ?? {}) as Record<string, SchemaProperty | undefined>;
  const fields: MessageDraftField[] = [];

  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (Array.isArray(property?.enum)) {
      continue;
    }

    const label =
      typeof property?.title === "string" && property.title.trim() ? property.title.trim() : humanizeKey(key);

    if (typeof value === "string") {
      const multiline =
        MULTILINE_KEY_WORDS.has(splitKeyWords(key).at(-1) ?? "") ||
        value.includes("\n") ||
        value.length > MULTILINE_VALUE_LENGTH;
      fields.push({ key, label, format: multiline ? "multiline" : "text" });
      continue;
    }

    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      fields.push({ key, label, format: "list" });
    }
  }

  return [
    ...fields.filter((field) => field.format !== "multiline"),
    ...fields.filter((field) => field.format === "multiline")
  ];
}

export function applyMessageDraftFieldValues(
  payload: MessageDraftProposalPayload,
  values: Record<string, string> | undefined
) {
  const nextArguments = { ...payload.arguments };

  for (const field of payload.fields) {
    const value = values?.[field.key];
    if (typeof value !== "string") {
      continue;
    }

    nextArguments[field.key] =
      field.format === "list"
        ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
        : field.format === "text"
          ? value.trim()
          : value;
  }

  return nextArguments;
}

function loadMessageDraftAction(actionId: string, userId?: string) {
  const row = (
    userId
      ? getDb()
          .prepare(
            `SELECT ma.id, ma.message_id, ma.kind, ma.status, ma.proposal_state, ma.proposal_payload_json
             FROM message_actions ma
             INNER JOIN messages m ON m.id = ma.message_id
             INNER JOIN conversations c ON c.id = m.conversation_id
             WHERE ma.id = ? AND c.user_id = ?`
          )
          .get(actionId, userId)
      : getDb()
          .prepare(
            `SELECT id, message_id, kind, status, proposal_state, proposal_payload_json
             FROM message_actions WHERE id = ?`
          )
          .get(actionId)
  ) as
    | {
        id: string;
        message_id: string;
        kind: string;
        status: string;
        proposal_state: string | null;
        proposal_payload_json: string | null;
      }
    | undefined;

  if (!row || row.kind !== "draft_message") {
    throw new Error("Draft not found");
  }

  if (row.status !== "pending" || row.proposal_state !== "pending") {
    throw new Error(NOT_PENDING_MESSAGE);
  }

  let payload: unknown = null;
  try {
    payload = row.proposal_payload_json ? JSON.parse(row.proposal_payload_json) : null;
  } catch {
    payload = null;
  }

  if (!isMessageDraftPayload(payload)) {
    throw new Error("Draft content is missing");
  }

  return { actionId: row.id, messageId: row.message_id, payload };
}

function broadcastMessageDraftUpdate(action: MessageAction) {
  broadcastBotUpdateForMessage(action.messageId);
  const conversationId = getMessage(action.messageId)?.conversationId;
  if (conversationId) {
    getConversationManager().broadcast(conversationId, {
      type: "delta",
      conversationId,
      event: { type: "action_complete", action }
    });
  }
}

export async function sendMessageDraft(
  actionId: string,
  values: Record<string, string> | undefined,
  userId?: string
) {
  const draft = loadMessageDraftAction(actionId, userId);
  const server = getMcpServer(draft.payload.mcpServerId);

  if (!server || !server.enabled) {
    throw new Error(`${draft.payload.mcpServerName} is not connected. Turn it back on in Settings, then send again.`);
  }

  const payload: MessageDraftProposalPayload = {
    ...draft.payload,
    arguments: applyMessageDraftFieldValues(draft.payload, values),
    sendError: null
  };
  const claimedAt = nowIso();
  const claimed = getDb()
    .prepare(
      `UPDATE message_actions
       SET status = 'running', proposal_payload_json = ?, proposal_updated_at = ?
       WHERE id = ? AND kind = 'draft_message' AND status = 'pending' AND proposal_state = 'pending'`
    )
    .run(JSON.stringify(payload), claimedAt, draft.actionId).changes;

  if (!claimed) {
    throw new Error(NOT_PENDING_MESSAGE);
  }

  let result: McpToolCallResult;
  try {
    result = await callMcpTool(server, payload.mcpToolName, payload.arguments, getSettings().mcpTimeout);
  } catch (error) {
    result = {
      content: [{ type: "text", text: error instanceof Error ? error.message : "Sending failed" }],
      isError: true
    };
  }

  const resultText = getToolResultText(result).trim();
  const finishedAt = nowIso();
  const action = result.isError
    ? updateMessageAction(draft.actionId, {
        status: "pending",
        proposalPayload: { ...payload, sendError: resultText },
        proposalUpdatedAt: finishedAt
      })
    : updateMessageAction(draft.actionId, {
        status: "completed",
        resultSummary: resultText,
        completedAt: finishedAt,
        proposalState: "approved",
        proposalPayload: payload,
        proposalUpdatedAt: finishedAt
      });

  if (!action) {
    throw new Error("Draft not found");
  }

  broadcastMessageDraftUpdate(action);
  return action;
}

export function discardMessageDraft(actionId: string, userId?: string) {
  const draft = loadMessageDraftAction(actionId, userId);
  const timestamp = nowIso();
  const action = updateMessageAction(draft.actionId, {
    status: "completed",
    resultSummary: "Discarded",
    completedAt: timestamp,
    proposalState: "dismissed",
    proposalUpdatedAt: timestamp
  });

  if (!action) {
    throw new Error("Draft not found");
  }

  broadcastMessageDraftUpdate(action);
  return action;
}

export function supersedeMessageDraft(actionId: string, conversationId: string) {
  const row = getDb()
    .prepare(
      `SELECT ma.id FROM message_actions ma
       INNER JOIN messages m ON m.id = ma.message_id
       WHERE ma.id = ? AND m.conversation_id = ? AND ma.kind = 'draft_message'
         AND ma.status = 'pending' AND ma.proposal_state = 'pending'`
    )
    .get(actionId, conversationId);

  if (!row) {
    return false;
  }

  const timestamp = nowIso();
  const action = updateMessageAction(actionId, {
    status: "completed",
    resultSummary: "Replaced by a revised draft",
    completedAt: timestamp,
    proposalState: "superseded",
    proposalUpdatedAt: timestamp
  });

  if (action) {
    broadcastMessageDraftUpdate(action);
  }
  return true;
}
