import { broadcastActionUpdate } from "@/lib/action-broadcast";
import {
  clearComputerHandoff,
  conversationBrowserTarget,
  getComputerHandoff,
  hasComputerStream,
  registerComputerHandoff,
  setComputerControl
} from "@/lib/agent-computer-relay";
import { updateMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { settleUserGate, waitForUserGate } from "@/lib/user-gate";
import type { RuntimeAction } from "@/lib/tool-executors";
import type { ComputerHandoffProposalPayload, ComputerHandoffResolution } from "@/lib/types";
import { nowIso } from "@/lib/utils";

export const COMPUTER_HANDOFF_TIMEOUT_MS = 30 * 60_000;

type HandoffOutcome = { resolution: ComputerHandoffResolution; note?: string };

const RESOLUTION_SUMMARIES: Record<ComputerHandoffResolution, string> = {
  returned: "You returned control",
  expired: "Nobody took over within 30 minutes",
  stopped: "Stopped before you returned control"
};

function readRecordedOutcome(actionId: string): HandoffOutcome | null {
  const row = getDb()
    .prepare("SELECT proposal_state, proposal_payload_json FROM message_actions WHERE id = ?")
    .get(actionId) as { proposal_state: string | null; proposal_payload_json: string | null } | undefined;
  if (!row || row.proposal_state === "pending" || !row.proposal_payload_json) return null;
  try {
    const payload = JSON.parse(row.proposal_payload_json) as ComputerHandoffProposalPayload;
    return payload.resolution ? { resolution: payload.resolution, note: payload.note } : null;
  } catch {
    return null;
  }
}

function resolveHandoffCard(actionId: string, payload: ComputerHandoffProposalPayload, outcome: HandoffOutcome) {
  const timestamp = nowIso();
  const updated = updateMessageAction(actionId, {
    status: "completed",
    resultSummary: RESOLUTION_SUMMARIES[outcome.resolution],
    completedAt: timestamp,
    proposalState: outcome.resolution === "returned" ? "approved" : "dismissed",
    proposalPayload: { ...payload, resolution: outcome.resolution, ...(outcome.note ? { note: outcome.note } : {}) },
    proposalUpdatedAt: timestamp
  });
  if (updated) broadcastActionUpdate(updated);
  return outcome;
}

function describeOutcome(outcome: HandoffOutcome) {
  if (outcome.resolution === "returned") {
    return `The user completed the step in the browser and returned control. Continue from the page as they left it.${
      outcome.note ? ` Their note: ${outcome.note}` : ""
    }`;
  }
  if (outcome.resolution === "expired") {
    return "Nobody took over the browser within 30 minutes. Tell the user what you still need them to do there and stop.";
  }
  return "The hand-off was stopped before the user returned control. Do not continue the step in the browser.";
}

export async function requestComputerHandoff(input: {
  conversationId?: string;
  reason: string;
  abortSignal?: AbortSignal;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  onWaitChange?: (waiting: boolean) => Promise<void> | void;
}) {
  const target = conversationBrowserTarget(input.conversationId);
  if (input.conversationId && !hasComputerStream(target)) {
    return "Your browser is not open yet. Open the page that needs the user first (agent-browser open <url>), then call request_takeover again.";
  }
  const payload: ComputerHandoffProposalPayload = { operation: "computer_handoff", reason: input.reason };
  const handle = await input.onActionStart?.({
    kind: "computer_handoff",
    status: "pending",
    label: "Your turn in the browser",
    detail: input.reason,
    proposalState: "pending",
    proposalPayload: payload
  });
  const actionId = typeof handle === "string" ? handle : "";
  if (!actionId) {
    return "The browser can't be handed to the user in this conversation. Ask them to do the step themselves.";
  }

  registerComputerHandoff(target, actionId);
  setComputerControl(target, "user");
  await input.onWaitChange?.(true);
  try {
    const outcome = await waitForUserGate<HandoffOutcome>(actionId, {
      timeoutMs: COMPUTER_HANDOFF_TIMEOUT_MS,
      abortSignal: input.abortSignal,
      readRecorded: () => readRecordedOutcome(actionId),
      onExpire: () => resolveHandoffCard(actionId, payload, { resolution: "expired" }),
      onStop: () => resolveHandoffCard(actionId, payload, { resolution: "stopped" })
    });
    return describeOutcome(outcome);
  } finally {
    clearComputerHandoff(target, actionId);
    setComputerControl(target, "bot");
    await input.onWaitChange?.(false);
  }
}

export function takeComputerControl(conversationId: string) {
  setComputerControl(conversationBrowserTarget(conversationId), "user");
}

export function returnComputerControl(conversationId: string, note?: string) {
  const target = conversationBrowserTarget(conversationId);
  const actionId = getComputerHandoff(target);
  setComputerControl(target, "bot");
  if (!actionId) return;

  const row = getDb()
    .prepare("SELECT proposal_payload_json FROM message_actions WHERE id = ? AND proposal_state = 'pending'")
    .get(actionId) as { proposal_payload_json: string | null } | undefined;
  if (!row?.proposal_payload_json) return;
  const payload = JSON.parse(row.proposal_payload_json) as ComputerHandoffProposalPayload;
  const trimmedNote = note?.trim().slice(0, 1_000) || undefined;
  const outcome = resolveHandoffCard(actionId, payload, { resolution: "returned", note: trimmedNote });
  settleUserGate(actionId, outcome);
}
