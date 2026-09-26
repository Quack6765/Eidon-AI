import { broadcastActionUpdate } from "@/lib/action-broadcast";
import { runBrowserSessionCommand, type BrowserSessionTarget } from "@/lib/agent-computer";
import { conversationBrowserTarget, hasComputerStream, typeComputerText } from "@/lib/agent-computer-relay";
import { updateMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { normalizeLoginLabel, normalizeLoginOrigin, readSavedLogin, saveLogin } from "@/lib/saved-logins";
import { rememberSecretForRedaction } from "@/lib/secret-redaction";
import { settleUserGate, waitForUserGate } from "@/lib/user-gate";
import type { RuntimeAction } from "@/lib/tool-executors";
import type { SecretRequestProposalPayload, SecretRequestResolution } from "@/lib/types";
import { nowIso } from "@/lib/utils";

export const SECRET_REQUEST_TIMEOUT_MS = 30 * 60_000;
export const MAX_SECRET_CHARS = 1_000;

type SecretOutcome = { resolution: SecretRequestResolution; saved?: boolean };

const RESOLUTION_SUMMARIES: Record<SecretRequestResolution, string> = {
  filled: "Filled in",
  declined: "You declined",
  expired: "Nobody answered within 30 minutes",
  stopped: "Stopped before you answered"
};

export class SecretRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "SecretRequestError";
  }
}

function parsePayload(raw: string | null) {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as SecretRequestProposalPayload;
    return payload.operation === "secret_request" ? payload : null;
  } catch {
    return null;
  }
}

function readRecordedOutcome(actionId: string): SecretOutcome | null {
  const row = getDb()
    .prepare("SELECT proposal_state, proposal_payload_json FROM message_actions WHERE id = ?")
    .get(actionId) as { proposal_state: string | null; proposal_payload_json: string | null } | undefined;
  if (!row || row.proposal_state === "pending") return null;
  const payload = parsePayload(row?.proposal_payload_json ?? null);
  return payload?.resolution ? { resolution: payload.resolution, saved: payload.saved } : null;
}

function resolveSecretCard(actionId: string, payload: SecretRequestProposalPayload, outcome: SecretOutcome) {
  const timestamp = nowIso();
  const action = updateMessageAction(actionId, {
    status: "completed",
    resultSummary: RESOLUTION_SUMMARIES[outcome.resolution],
    completedAt: timestamp,
    proposalState: outcome.resolution === "filled" ? "approved" : "dismissed",
    proposalPayload: { ...payload, resolution: outcome.resolution, ...(outcome.saved ? { saved: true } : {}) },
    proposalUpdatedAt: timestamp
  });
  if (action) broadcastActionUpdate(action);
  return action;
}

function describeOutcome(payload: SecretRequestProposalPayload, outcome: SecretOutcome) {
  if (outcome.resolution === "filled") {
    return `The user entered the ${payload.label} into ${payload.target} on ${payload.origin}${
      outcome.saved ? " and saved it for next time" : ""
    }. You can't see the value. Continue, for example by submitting the form.`;
  }
  if (outcome.resolution === "declined") {
    return `The user declined to enter the ${payload.label}. Don't ask for it again in this task.`;
  }
  if (outcome.resolution === "expired") {
    return `Nobody entered the ${payload.label} within 30 minutes. Tell the user what you still need and stop.`;
  }
  return `The request for the ${payload.label} was stopped. Don't continue the sign-in.`;
}

async function readBrowserOrigin(target: BrowserSessionTarget) {
  const result = await runBrowserSessionCommand(target, ["get", "url", "--json"]);
  if (!result.ok) return null;
  const line = result.output
    .split("\n")
    .reverse()
    .find((entry) => entry.trim().startsWith("{"));
  try {
    const url = (JSON.parse(line ?? "") as { data?: { url?: unknown } }).data?.url;
    return typeof url === "string" ? normalizeLoginOrigin(url) : null;
  } catch {
    return null;
  }
}

async function fillSecret(target: BrowserSessionTarget, origin: string, selector: string, value: string) {
  const actual = await readBrowserOrigin(target);
  if (actual !== origin) {
    throw new SecretRequestError(
      actual
        ? `The bot's browser is on ${actual}, not ${origin}, so Eidon didn't type it.`
        : "Eidon couldn't read the bot's browser address, so it didn't type it.",
      409
    );
  }
  const focused = await runBrowserSessionCommand(target, ["focus", selector]);
  if (!focused.ok) {
    throw new SecretRequestError("Eidon couldn't find the field the bot pointed at, so it didn't type it.", 409);
  }
  await typeComputerText(target, value);
}

export async function requestComputerSecret(input: {
  conversationId?: string;
  userId?: string | null;
  label: string;
  origin: string;
  target: string;
  save?: boolean;
  replaceSaved?: boolean;
  abortSignal?: AbortSignal;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  onWaitChange?: (waiting: boolean) => Promise<void> | void;
}) {
  const origin = normalizeLoginOrigin(input.origin);
  if (!origin) return "Error: origin must be the page's web origin, for example https://example.com.";
  const selector = input.target.trim();
  if (!selector) return "Error: target must be the field to fill, for example @e5 from a snapshot or #password.";
  const label = normalizeLoginLabel(input.label) || "password";
  if (!input.conversationId) return "Secrets can't be requested in this conversation. Ask the user to do the step themselves.";
  const browser = conversationBrowserTarget(input.conversationId);
  if (!hasComputerStream(browser)) {
    return "Your browser is not open yet. Open the page with the field first (agent-browser open <url>), then call request_secret again.";
  }

  if (input.userId && !input.replaceSaved) {
    const saved = readSavedLogin(input.userId, origin, label);
    if (saved !== null) {
      try {
        await fillSecret(browser, origin, selector, saved);
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : "Eidon couldn't fill the saved value."}`;
      }
      rememberSecretForRedaction(input.conversationId, saved);
      return `Eidon filled the saved ${label} for ${origin} into ${selector} without asking the user. You can't see the value. If it turns out to be wrong, call request_secret again with replace_saved: true.`;
    }
  }

  const payload: SecretRequestProposalPayload = {
    operation: "secret_request",
    label,
    origin,
    target: selector,
    save: Boolean(input.save)
  };
  const handle = await input.onActionStart?.({
    kind: "secret_request",
    status: "pending",
    label: `Enter your ${label}`,
    detail: origin,
    proposalState: "pending",
    proposalPayload: payload
  });
  const actionId = typeof handle === "string" ? handle : "";
  if (!actionId) return "Secrets can't be requested in this conversation. Ask the user to do the step themselves.";

  await input.onWaitChange?.(true);
  try {
    const outcome = await waitForUserGate<SecretOutcome>(actionId, {
      timeoutMs: SECRET_REQUEST_TIMEOUT_MS,
      abortSignal: input.abortSignal,
      readRecorded: () => readRecordedOutcome(actionId),
      onExpire: () => {
        resolveSecretCard(actionId, payload, { resolution: "expired" });
        return { resolution: "expired" };
      },
      onStop: () => {
        resolveSecretCard(actionId, payload, { resolution: "stopped" });
        return { resolution: "stopped" };
      }
    });
    return describeOutcome(payload, outcome);
  } finally {
    await input.onWaitChange?.(false);
  }
}

function loadPendingSecretRequest(actionId: string, userId: string) {
  const row = getDb()
    .prepare(
      `SELECT ma.kind, ma.status, ma.proposal_state, ma.proposal_payload_json, m.conversation_id
       FROM message_actions ma
       INNER JOIN messages m ON m.id = ma.message_id
       INNER JOIN conversations c ON c.id = m.conversation_id
       WHERE ma.id = ? AND c.user_id = ?`
    )
    .get(actionId, userId) as
    | { kind: string; status: string; proposal_state: string | null; proposal_payload_json: string | null; conversation_id: string }
    | undefined;
  const payload = row?.kind === "secret_request" ? parsePayload(row.proposal_payload_json) : null;
  if (!row || !payload) throw new SecretRequestError("Secret request not found", 404);
  if (row.status !== "pending" || row.proposal_state !== "pending") {
    throw new SecretRequestError("This request is no longer waiting for an answer.", 409);
  }
  return { payload, conversationId: row.conversation_id };
}

export async function submitComputerSecret(actionId: string, userId: string, input: { value: string; save: boolean }) {
  const { payload, conversationId } = loadPendingSecretRequest(actionId, userId);
  await fillSecret(conversationBrowserTarget(conversationId), payload.origin, payload.target, input.value);
  rememberSecretForRedaction(conversationId, input.value);
  if (input.save) saveLogin(userId, payload.origin, payload.label, input.value);
  const outcome: SecretOutcome = { resolution: "filled", saved: input.save };
  const action = resolveSecretCard(actionId, payload, outcome);
  settleUserGate(actionId, outcome);
  return action;
}

export function declineComputerSecret(actionId: string, userId: string) {
  const { payload } = loadPendingSecretRequest(actionId, userId);
  const outcome: SecretOutcome = { resolution: "declined" };
  const action = resolveSecretCard(actionId, payload, outcome);
  settleUserGate(actionId, outcome);
  return action;
}
