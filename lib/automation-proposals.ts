import { createAutomation, type CreateAutomationInput } from "@/lib/automations";
import { broadcastBotUpdateForMessage } from "@/lib/bot-runs";
import { updateMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getPersona } from "@/lib/personas";
import { getProviderProfile } from "@/lib/settings";
import type {
  Automation,
  AutomationCalendarFrequency,
  AutomationProposalPayload,
  AutomationScheduleKind,
  MessageAction
} from "@/lib/types";
import { nowIso } from "@/lib/utils";

export type AutomationProposalOverrides = {
  name?: string;
  prompt?: string;
  scheduleKind?: AutomationScheduleKind;
  intervalMinutes?: number | null;
  calendarFrequency?: AutomationCalendarFrequency | null;
  timeOfDay?: string | null;
  daysOfWeek?: number[];
  continuePreviousConversation?: boolean;
};

type PendingAutomationProposalActionRow = {
  id: string;
  message_id: string;
  kind: MessageAction["kind"];
  status: MessageAction["status"];
  proposal_state: MessageAction["proposalState"];
  proposal_payload_json: string | null;
};

export function isAutomationProposalPayload(
  payload: unknown
): payload is AutomationProposalPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<AutomationProposalPayload>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.prompt === "string" &&
    (candidate.scheduleKind === "interval" || candidate.scheduleKind === "calendar") &&
    typeof candidate.providerProfileId === "string" &&
    typeof candidate.continuePreviousConversation === "boolean"
  );
}

function parseAutomationProposalPayload(rawPayload: string | null): AutomationProposalPayload | null {
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    if (!isAutomationProposalPayload(parsed)) {
      return null;
    }

    return {
      name: parsed.name,
      prompt: parsed.prompt,
      scheduleKind: parsed.scheduleKind,
      intervalMinutes: parsed.intervalMinutes ?? null,
      calendarFrequency: parsed.calendarFrequency ?? null,
      timeOfDay: parsed.timeOfDay ?? null,
      daysOfWeek: Array.isArray(parsed.daysOfWeek)
        ? parsed.daysOfWeek.filter((day) => Number.isInteger(day))
        : [],
      providerProfileId: parsed.providerProfileId,
      personaId: typeof parsed.personaId === "string" ? parsed.personaId : null,
      continuePreviousConversation: parsed.continuePreviousConversation,
      automationId: typeof parsed.automationId === "string" ? parsed.automationId : null
    };
  } catch {
    return null;
  }
}

function loadPendingAutomationProposalAction(actionId: string, userId?: string) {
  const row = (userId
    ? getDb()
        .prepare(
          `SELECT
            ma.id,
            ma.message_id,
            ma.kind,
            ma.status,
            ma.proposal_state,
            ma.proposal_payload_json
           FROM message_actions ma
           INNER JOIN messages m ON m.id = ma.message_id
           INNER JOIN conversations c ON c.id = m.conversation_id
           WHERE ma.id = ? AND c.user_id = ?`
        )
        .get(actionId, userId)
    : getDb()
        .prepare(
          `SELECT
            ma.id,
            ma.message_id,
            ma.kind,
            ma.status,
            ma.proposal_state,
            ma.proposal_payload_json
           FROM message_actions ma
           WHERE ma.id = ?`
        )
        .get(actionId)) as PendingAutomationProposalActionRow | undefined;

  if (!row || row.kind !== "create_automation") {
    throw new Error("Automation proposal not found");
  }

  if (row.status !== "pending" || row.proposal_state !== "pending") {
    throw new Error("Automation proposal is no longer pending");
  }

  const proposalPayload = parseAutomationProposalPayload(row.proposal_payload_json);
  if (!proposalPayload) {
    throw new Error("Automation proposal payload is missing");
  }

  return {
    actionId: row.id,
    proposalPayload
  };
}

function applyAutomationProposalOverrides(
  proposalPayload: AutomationProposalPayload,
  overrides?: AutomationProposalOverrides
): AutomationProposalPayload {
  if (!overrides) {
    return proposalPayload;
  }

  const nextName = overrides.name?.trim();
  const nextPrompt = overrides.prompt?.trim();

  return {
    ...proposalPayload,
    name: nextName || proposalPayload.name,
    prompt: nextPrompt || proposalPayload.prompt,
    scheduleKind: overrides.scheduleKind ?? proposalPayload.scheduleKind,
    intervalMinutes:
      overrides.intervalMinutes !== undefined ? overrides.intervalMinutes : proposalPayload.intervalMinutes,
    calendarFrequency:
      overrides.calendarFrequency !== undefined
        ? overrides.calendarFrequency
        : proposalPayload.calendarFrequency,
    timeOfDay: overrides.timeOfDay !== undefined ? overrides.timeOfDay : proposalPayload.timeOfDay,
    daysOfWeek: overrides.daysOfWeek ?? proposalPayload.daysOfWeek,
    continuePreviousConversation:
      overrides.continuePreviousConversation ?? proposalPayload.continuePreviousConversation
  };
}

export function approveAutomationProposal(
  actionId: string,
  overrides?: AutomationProposalOverrides,
  userId?: string
): { action: MessageAction; automation: Automation } {
  const pending = loadPendingAutomationProposalAction(actionId, userId);
  const finalPayload = applyAutomationProposalOverrides(pending.proposalPayload, overrides);

  if (!getProviderProfile(finalPayload.providerProfileId)) {
    throw new Error("Provider profile not found");
  }

  if (finalPayload.personaId && !getPersona(finalPayload.personaId, userId)) {
    throw new Error("Persona not found");
  }

  const createInput: CreateAutomationInput = {
    name: finalPayload.name,
    prompt: finalPayload.prompt,
    providerProfileId: finalPayload.providerProfileId,
    personaId: finalPayload.personaId,
    scheduleKind: finalPayload.scheduleKind,
    intervalMinutes: finalPayload.intervalMinutes,
    calendarFrequency: finalPayload.calendarFrequency,
    timeOfDay: finalPayload.timeOfDay,
    daysOfWeek: finalPayload.daysOfWeek,
    continuePreviousConversation: finalPayload.continuePreviousConversation
  };

  const automation = createAutomation(createInput, userId);

  const timestamp = nowIso();
  const action = updateMessageAction(pending.actionId, {
    status: "completed",
    resultSummary: "Approved",
    completedAt: timestamp,
    proposalState: "approved",
    proposalPayload: { ...finalPayload, automationId: automation.id },
    proposalUpdatedAt: timestamp
  });

  if (!action) {
    throw new Error("Automation proposal not found");
  }

  broadcastBotUpdateForMessage(action.messageId);

  return { action, automation };
}

export function dismissAutomationProposal(actionId: string, userId?: string) {
  const pending = loadPendingAutomationProposalAction(actionId, userId);
  const timestamp = nowIso();
  const action = updateMessageAction(pending.actionId, {
    status: "completed",
    resultSummary: "Ignored",
    completedAt: timestamp,
    proposalState: "dismissed",
    proposalUpdatedAt: timestamp
  });

  if (!action) {
    throw new Error("Automation proposal not found");
  }

  broadcastBotUpdateForMessage(action.messageId);

  return action;
}
