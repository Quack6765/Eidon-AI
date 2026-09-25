import type { MessageAction, MessageDraftField, MessageDraftProposalPayload } from "@/lib/types";

export function isMessageDraftPayload(payload: unknown): payload is MessageDraftProposalPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<MessageDraftProposalPayload>;
  return (
    candidate.operation === "message_draft" &&
    typeof candidate.mcpServerId === "string" &&
    typeof candidate.mcpServerName === "string" &&
    typeof candidate.mcpToolName === "string" &&
    typeof candidate.toolLabel === "string" &&
    Boolean(candidate.arguments) &&
    typeof candidate.arguments === "object" &&
    Array.isArray(candidate.fields)
  );
}

export function getMessageDraftFieldValue(payload: MessageDraftProposalPayload, field: MessageDraftField) {
  const value = payload.arguments[field.key];

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join(", ");
  }

  return typeof value === "string" ? value : "";
}

export function getMessageDraftExtraArguments(payload: MessageDraftProposalPayload) {
  const fieldKeys = new Set(payload.fields.map((field) => field.key));

  return Object.entries(payload.arguments)
    .filter(([key, value]) => !fieldKeys.has(key) && value !== undefined && value !== null)
    .map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value)
    }));
}

function describeDraftContent(payload: MessageDraftProposalPayload) {
  const lines = payload.fields.map(
    (field) => `${field.label}: ${getMessageDraftFieldValue(payload, field)}`
  );

  for (const { key, value } of getMessageDraftExtraArguments(payload)) {
    lines.push(`${key}: ${value}`);
  }

  return lines.join("\n");
}

export function describeMessageDraftForPrompt(action: MessageAction) {
  const payload = action.proposalPayload;

  if (!isMessageDraftPayload(payload)) {
    return "Draft details are unavailable.";
  }

  const target = `${payload.mcpServerName} (${payload.toolLabel})`;
  const content = describeDraftContent(payload);

  if (action.proposalState === "approved") {
    return [
      `The user sent draft ${action.id} with ${target}. This is exactly what was sent, including any edits they made:`,
      content,
      action.resultSummary ? `Result: ${action.resultSummary}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (action.proposalState === "dismissed") {
    return `The user discarded draft ${action.id}. Nothing was sent.`;
  }

  if (action.proposalState === "superseded") {
    return `Draft ${action.id} was replaced by a revised draft. Nothing was sent.`;
  }

  if (action.status === "running") {
    return `The user is sending draft ${action.id} with ${target} right now.`;
  }

  if (action.status !== "pending") {
    return `Sending draft ${action.id} with ${target} was interrupted, so it is unknown whether it was delivered. Ask the user to check before drafting it again.`;
  }

  return [
    `Draft ${action.id} for ${target} is still waiting for the user to review and send. Nothing has been sent.`,
    payload.sendError ? `The last send attempt failed: ${payload.sendError}` : "",
    "Current draft:",
    content
  ]
    .filter(Boolean)
    .join("\n");
}
