import { updateMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import {
  createMemory,
  deleteMemory,
  getMemory,
  getMemoryCount,
  updateMemory
} from "@/lib/memories";
import { getSettings } from "@/lib/settings";
import type {
  MemoryCategory,
  MemoryProposalPayload,
  MessageAction,
  UserMemory
} from "@/lib/types";

const VALID_MEMORY_CATEGORIES: MemoryCategory[] = [
  "personal",
  "preference",
  "work",
  "location",
  "other"
];

function toProposalMemorySnapshot(memory: UserMemory) {
  return {
    id: memory.id,
    content: memory.content,
    category: memory.category
  };
}

const MEMORY_PROPOSAL_KINDS = new Set(["create_memory", "update_memory", "delete_memory"]);

type PendingMemoryProposalActionRow = {
  id: string;
  message_id: string;
  kind: MessageAction["kind"];
  status: MessageAction["status"];
  server_id: string | null;
  skill_id: string | null;
  tool_name: string | null;
  label: string;
  detail: string;
  arguments_json: string | null;
  result_summary: string;
  sort_order: number;
  started_at: string;
  completed_at: string | null;
  proposal_state: MessageAction["proposalState"];
  proposal_payload_json: string | null;
  proposal_updated_at: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function parseProposalPayload(rawPayload: string | null): MemoryProposalPayload | null {
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Partial<MemoryProposalPayload>;

    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.operation === "create" || parsed.operation === "update" || parsed.operation === "delete") &&
      "targetMemoryId" in parsed
    ) {
      return parsed as MemoryProposalPayload;
    }
  } catch {
    return null;
  }

  return null;
}

function loadPendingMemoryProposalAction(actionId: string, userId?: string) {
  const row = (userId
    ? getDb()
        .prepare(
          `SELECT
            ma.id,
            ma.message_id,
            ma.kind,
            ma.status,
            ma.server_id,
            ma.skill_id,
            ma.tool_name,
            ma.label,
            ma.detail,
            ma.arguments_json,
            ma.result_summary,
            ma.sort_order,
            ma.started_at,
            ma.completed_at,
            ma.proposal_state,
            ma.proposal_payload_json,
            ma.proposal_updated_at
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
            ma.server_id,
            ma.skill_id,
            ma.tool_name,
            ma.label,
            ma.detail,
            ma.arguments_json,
            ma.result_summary,
            ma.sort_order,
            ma.started_at,
            ma.completed_at,
            ma.proposal_state,
            ma.proposal_payload_json,
            ma.proposal_updated_at
           FROM message_actions ma
           WHERE ma.id = ?`
        )
        .get(actionId)) as PendingMemoryProposalActionRow | undefined;

  if (!row || !MEMORY_PROPOSAL_KINDS.has(row.kind)) {
    throw new Error("Memory proposal not found");
  }

  if (row.status !== "pending" || row.proposal_state !== "pending") {
    throw new Error("Memory proposal is no longer pending");
  }

  const proposalPayload = parseProposalPayload(row.proposal_payload_json);
  if (!proposalPayload) {
    throw new Error("Memory proposal payload is missing");
  }

  return {
    actionId: row.id,
    messageId: row.message_id,
    proposalPayload
  };
}

function applyProposalOverrides(
  proposalPayload: MemoryProposalPayload,
  overrides?: { content?: string; category?: MemoryCategory }
) {
  if (!overrides || !proposalPayload.proposedMemory) {
    return proposalPayload;
  }

  return {
    ...proposalPayload,
    proposedMemory: {
      content: overrides.content?.trim() || proposalPayload.proposedMemory.content,
      category: overrides.category ?? proposalPayload.proposedMemory.category
    }
  };
}

function ensureCurrentMemorySnapshotMatches(
  liveMemory: UserMemory,
  proposalPayload: MemoryProposalPayload
) {
  const snapshot = proposalPayload.currentMemory;

  if (!snapshot) {
    throw new Error("Memory proposal payload is missing");
  }

  if (liveMemory.content !== snapshot.content || liveMemory.category !== snapshot.category) {
    throw new Error("Target memory changed since this proposal was created");
  }
}

export function approveMemoryProposal(
  actionId: string,
  overrides?: { content?: string; category?: MemoryCategory },
  userId?: string
) {
  const pending = loadPendingMemoryProposalAction(actionId, userId);
  const finalPayload = applyProposalOverrides(pending.proposalPayload, overrides);

  if (finalPayload.operation === "create") {
    const proposedMemory = finalPayload.proposedMemory;
    if (!proposedMemory) {
      throw new Error("Memory proposal payload is missing");
    }

    const settings = getSettings();
    const currentCount = getMemoryCount(userId);

    if (currentCount >= settings.memoriesMaxCount) {
      throw new Error(
        `Memory limit reached (${currentCount}/${settings.memoriesMaxCount}). Update or delete an existing memory instead.`
      );
    }

    createMemory(proposedMemory.content, proposedMemory.category, userId);
  }

  if (finalPayload.operation === "update") {
    const targetMemoryId = finalPayload.targetMemoryId;
    const proposedMemory = finalPayload.proposedMemory;

    if (!targetMemoryId || !proposedMemory) {
      throw new Error("Memory proposal payload is missing");
    }

    const liveMemory = getMemory(targetMemoryId, userId);

    if (!liveMemory) {
      throw new Error("Target memory no longer exists");
    }

    ensureCurrentMemorySnapshotMatches(liveMemory, finalPayload);

    const updated = updateMemory(
      targetMemoryId,
      {
        content: proposedMemory.content,
        category: proposedMemory.category
      },
      userId
    );

    if (!updated) {
      throw new Error("Target memory no longer exists");
    }
  }

  if (finalPayload.operation === "delete") {
    const targetMemoryId = finalPayload.targetMemoryId;

    if (!targetMemoryId) {
      throw new Error("Memory proposal payload is missing");
    }

    const liveMemory = getMemory(targetMemoryId, userId);

    if (!liveMemory) {
      throw new Error("Target memory no longer exists");
    }

    ensureCurrentMemorySnapshotMatches(liveMemory, finalPayload);

    deleteMemory(targetMemoryId, userId);
  }

  const timestamp = nowIso();
  const action = updateMessageAction(pending.actionId, {
    status: "completed",
    resultSummary: "Approved",
    completedAt: timestamp,
    proposalState: "approved",
    proposalPayload: finalPayload,
    proposalUpdatedAt: timestamp
  });

  if (!action) {
    throw new Error("Memory proposal not found");
  }

  return action;
}

export function dismissMemoryProposal(actionId: string, userId?: string) {
  const pending = loadPendingMemoryProposalAction(actionId, userId);
  const timestamp = nowIso();
  const action = updateMessageAction(pending.actionId, {
    status: "completed",
    resultSummary: "Ignored",
    completedAt: timestamp,
    proposalState: "dismissed",
    proposalUpdatedAt: timestamp
  });

  if (!action) {
    throw new Error("Memory proposal not found");
  }

  return action;
}

export function normalizeMemoryCategory(category: unknown): MemoryCategory {
  const normalizedValue = typeof category === "string" ? category.trim().toLowerCase() : "";

  return VALID_MEMORY_CATEGORIES.includes(normalizedValue as MemoryCategory)
    ? (normalizedValue as MemoryCategory)
    : "other";
}

export function buildCreateMemoryProposal(input: {
  content: string;
  category: unknown;
}): MemoryProposalPayload {
  return {
    operation: "create",
    targetMemoryId: null,
    proposedMemory: {
      content: input.content.trim(),
      category: normalizeMemoryCategory(input.category)
    }
  };
}

export function buildUpdateMemoryProposal(input: {
  memory: UserMemory;
  content: string;
  category?: unknown;
}): MemoryProposalPayload {
  return {
    operation: "update",
    targetMemoryId: input.memory.id,
    currentMemory: toProposalMemorySnapshot(input.memory),
    proposedMemory: {
      content: input.content.trim(),
      category: input.category === undefined
        ? input.memory.category
        : normalizeMemoryCategory(input.category)
    }
  };
}

export function buildDeleteMemoryProposal(memory: UserMemory): MemoryProposalPayload {
  return {
    operation: "delete",
    targetMemoryId: memory.id,
    currentMemory: toProposalMemorySnapshot(memory)
  };
}
