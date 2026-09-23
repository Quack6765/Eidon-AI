import { broadcastBotUpdateForMessage } from "@/lib/bot-runs";
import { getMessage, updateMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { tokenizeShellCommand } from "@/lib/shell-tokenizer";
import type { RuntimeAction } from "@/lib/tool-executors";
import type {
  MessageAction,
  ToolApprovalProposalPayload,
  ToolApprovalResolution,
  ToolApprovalRule,
  ToolApprovalScope
} from "@/lib/types";
import { nowIso } from "@/lib/utils";

export const TOOL_APPROVAL_TIMEOUT_MS = 5 * 60_000;

const USER_DENIED_MESSAGE = "Denied: the user declined this action.";
const EXPIRED_MESSAGE = "Denied: the approval request expired before the user decided.";
const STOPPED_MESSAGE = "Denied: the approval request was stopped.";
const UNATTENDED_MESSAGE =
  "Denied: no standing approval covers this action. Unattended runs only execute tools the user has already allowed always.";
const UNAVAILABLE_MESSAGE = "Denied: unable to request user approval for this action.";

const ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPER_WORDS = new Set(["sudo", "env", "command", "exec", "nohup", "time"]);
const RUNNER_WORDS = new Set(["npx", "bunx"]);
const RUNNER_SUBCOMMANDS = new Set(["exec", "dlx"]);
const PACKAGE_RUNNERS = new Set(["pnpm", "yarn"]);
const WRAPPER_VALUE_FLAGS: Record<string, Set<string>> = {
  sudo: new Set(["-u", "-g", "-p", "-C", "-U", "-T", "-r", "-t", "-h"]),
  env: new Set(["-u", "-S"])
};
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "function",
  "select",
  "[[",
  "]]",
  "{",
  "}",
  "(",
  ")",
  "!"
]);

export type ShellCommandClassification = {
  families: string[];
  classified: boolean;
};

function scanShellSegments(command: string) {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let classified = true;

  const pushSegment = () => {
    if (current.trim()) {
      segments.push(current);
    }
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\" && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }

    if (quote) {
      current += character;
      if (character === quote) {
        quote = null;
        continue;
      }
      if (
        quote === '"' &&
        (character === "`" || (character === "$" && command[index + 1] === "("))
      ) {
        classified = false;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      current += character;
      quote = character;
      continue;
    }

    if (character === "`" || (character === "$" && command[index + 1] === "(")) {
      classified = false;
      current += character;
      continue;
    }

    if (character === "(" || character === ")") {
      classified = false;
      current += character;
      continue;
    }

    if (character === "\n" || character === ";" || character === "|" || character === "&") {
      const isRedirectionAmpersand =
        character === "&" &&
        command[index + 1] !== "&" &&
        (command[index - 1] === ">" || command[index - 1] === "<");
      if (isRedirectionAmpersand) {
        current += character;
        continue;
      }
      pushSegment();
      if ((character === "|" || character === "&") && command[index + 1] === character) {
        index += 1;
      }
      continue;
    }

    current += character;
  }

  pushSegment();
  return { segments, classified };
}

function skipFlagWords(words: string[], startIndex: number, wrapper: string) {
  const valueFlags = WRAPPER_VALUE_FLAGS[wrapper];
  let index = startIndex;
  while (index < words.length && words[index].startsWith("-")) {
    const flag = words[index];
    index += 1;
    if (valueFlags?.has(flag) && index < words.length) {
      index += 1;
    }
  }
  return index;
}

function extractCommandFamily(segment: string): string | null {
  const words = tokenizeShellCommand(segment);
  let index = 0;

  while (index < words.length) {
    while (index < words.length && ASSIGNMENT_PATTERN.test(words[index])) {
      index += 1;
    }

    const word = words[index];
    if (!word) {
      return null;
    }

    const normalized = word.toLowerCase();

    if (WRAPPER_WORDS.has(normalized)) {
      index = skipFlagWords(words, index + 1, normalized);
      continue;
    }

    if (RUNNER_WORDS.has(normalized)) {
      index = skipFlagWords(words, index + 1, normalized);
      continue;
    }

    if (
      PACKAGE_RUNNERS.has(normalized) &&
      RUNNER_SUBCOMMANDS.has((words[index + 1] ?? "").toLowerCase())
    ) {
      index = skipFlagWords(words, index + 2, normalized);
      continue;
    }

    break;
  }

  const binary = words[index];
  if (!binary) {
    return null;
  }

  const basename = binary.split(/[\\/]/).at(-1) ?? "";
  if (!basename || SHELL_KEYWORDS.has(basename)) {
    return null;
  }

  return basename;
}

export function classifyShellCommand(command: string): ShellCommandClassification {
  const { segments, classified: scanClassified } = scanShellSegments(command);

  if (!scanClassified || !segments.length) {
    return { families: [], classified: false };
  }

  const families: string[] = [];
  for (const segment of segments) {
    const family = extractCommandFamily(segment);
    if (!family) {
      return { families: [], classified: false };
    }
    if (!families.includes(family)) {
      families.push(family);
    }
  }

  return { families, classified: true };
}

export function mcpToolApprovalFamily(serverSlug: string, toolName: string) {
  return `${serverSlug}:${toolName}`;
}

type ToolApprovalRuleRow = {
  id: string;
  user_id: string | null;
  scope: string;
  family: string;
  created_at: string;
};

function rowToToolApprovalRule(row: ToolApprovalRuleRow): ToolApprovalRule {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope as ToolApprovalScope,
    family: row.family,
    createdAt: row.created_at
  };
}

export function listToolApprovalRules(userId?: string | null): ToolApprovalRule[] {
  const rows = (
    userId
      ? getDb()
          .prepare(
            "SELECT id, user_id, scope, family, created_at FROM tool_approval_rules WHERE user_id = ? ORDER BY created_at"
          )
          .all(userId)
      : getDb()
          .prepare(
            "SELECT id, user_id, scope, family, created_at FROM tool_approval_rules WHERE user_id IS NULL ORDER BY created_at"
          )
          .all()
  ) as ToolApprovalRuleRow[];

  return rows.map(rowToToolApprovalRule);
}

function isToolFamilyApproved(
  userId: string | null | undefined,
  scope: ToolApprovalScope,
  family: string
) {
  const row = userId
    ? getDb()
        .prepare(
          "SELECT id FROM tool_approval_rules WHERE user_id = ? AND scope = ? AND family = ?"
        )
        .get(userId, scope, family)
    : getDb()
        .prepare(
          "SELECT id FROM tool_approval_rules WHERE user_id IS NULL AND scope = ? AND family = ?"
        )
        .get(scope, family);

  return Boolean(row);
}

export function createToolApprovalRules(
  userId: string | null | undefined,
  scope: ToolApprovalScope,
  families: string[]
) {
  const timestamp = nowIso();
  const insert = getDb().prepare(
    "INSERT INTO tool_approval_rules (id, user_id, scope, family, created_at) VALUES (?, ?, ?, ?, ?)"
  );

  for (const family of families) {
    if (isToolFamilyApproved(userId, scope, family)) {
      continue;
    }
    insert.run(createId("tar"), userId ?? null, scope, family, timestamp);
  }
}

export function revokeToolApprovalRule(ruleId: string, userId?: string | null) {
  const result = userId
    ? getDb()
        .prepare("DELETE FROM tool_approval_rules WHERE id = ? AND user_id = ?")
        .run(ruleId, userId)
    : getDb()
        .prepare("DELETE FROM tool_approval_rules WHERE id = ? AND user_id IS NULL")
        .run(ruleId);

  return result.changes > 0;
}

function parseToolApprovalPayload(rawPayload: string | null): ToolApprovalProposalPayload | null {
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Partial<ToolApprovalProposalPayload>;

    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.operation === "tool_approval" &&
      (parsed.scope === "shell" || parsed.scope === "mcp") &&
      Array.isArray(parsed.families) &&
      typeof parsed.classified === "boolean"
    ) {
      return parsed as ToolApprovalProposalPayload;
    }
  } catch {
    return null;
  }

  return null;
}

function loadPendingToolApprovalAction(actionId: string, userId?: string) {
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

  if (!row || row.kind !== "tool_approval") {
    throw new Error("Tool approval not found");
  }

  if (row.status !== "pending" || row.proposal_state !== "pending") {
    throw new Error("Tool approval is no longer pending");
  }

  const proposalPayload = parseToolApprovalPayload(row.proposal_payload_json);
  if (!proposalPayload) {
    throw new Error("Tool approval payload is missing");
  }

  return {
    actionId: row.id,
    messageId: row.message_id,
    proposalPayload
  };
}

type PendingToolApprovalEntry = {
  settle: (approved: boolean) => void;
};

const pendingToolApprovals = new Map<string, PendingToolApprovalEntry>();

function settlePendingToolApproval(actionId: string, approved: boolean) {
  const entry = pendingToolApprovals.get(actionId);
  if (!entry) {
    return false;
  }

  pendingToolApprovals.delete(actionId);
  entry.settle(approved);
  return true;
}

function broadcastToolApprovalUpdate(action: MessageAction) {
  broadcastBotUpdateForMessage(action.messageId);
  void import("@/lib/chat-turn")
    .then(({ getChatEmitter }) => {
      const conversationId = getMessage(action.messageId)?.conversationId;
      if (conversationId) {
        getChatEmitter().emit("delta", conversationId, { type: "action_complete", action });
      }
    })
    .catch(() => undefined);
}

function resolvePendingToolApprovalAction(
  actionId: string,
  payload: ToolApprovalProposalPayload,
  resolution: ToolApprovalResolution,
  resultSummary: string,
  approved: boolean
) {
  const timestamp = nowIso();
  const updated = updateMessageAction(actionId, {
    status: "completed",
    resultSummary,
    completedAt: timestamp,
    proposalState: approved ? "approved" : "dismissed",
    proposalPayload: { ...payload, resolution },
    proposalUpdatedAt: timestamp
  });
  if (updated) {
    broadcastToolApprovalUpdate(updated);
  }
  settlePendingToolApproval(actionId, approved);
}

export function approveToolApproval(
  actionId: string,
  options?: { allowAlways?: boolean },
  userId?: string
) {
  const pending = loadPendingToolApprovalAction(actionId, userId);
  const allowAlways = options?.allowAlways === true;

  if (allowAlways) {
    if (!pending.proposalPayload.classified || !pending.proposalPayload.families.length) {
      throw new Error("This command has no command family and cannot be allowed always");
    }
    createToolApprovalRules(userId ?? null, pending.proposalPayload.scope, pending.proposalPayload.families);
  }

  const timestamp = nowIso();
  const action = updateMessageAction(pending.actionId, {
    status: "completed",
    resultSummary: allowAlways ? "Allowed always" : "Allowed once",
    completedAt: timestamp,
    proposalState: "approved",
    proposalPayload: {
      ...pending.proposalPayload,
      resolution: allowAlways ? "always" : "once"
    },
    proposalUpdatedAt: timestamp
  });

  if (!action) {
    throw new Error("Tool approval not found");
  }

  broadcastToolApprovalUpdate(action);
  settlePendingToolApproval(pending.actionId, true);
  return action;
}

export function dismissToolApproval(actionId: string, userId?: string) {
  const pending = loadPendingToolApprovalAction(actionId, userId);
  const timestamp = nowIso();
  const action = updateMessageAction(pending.actionId, {
    status: "completed",
    resultSummary: "Denied",
    completedAt: timestamp,
    proposalState: "dismissed",
    proposalPayload: {
      ...pending.proposalPayload,
      resolution: "denied"
    },
    proposalUpdatedAt: timestamp
  });

  if (!action) {
    throw new Error("Tool approval not found");
  }

  broadcastToolApprovalUpdate(action);
  settlePendingToolApproval(pending.actionId, false);
  return action;
}

export type ToolApprovalGateOutcome =
  | { approved: true }
  | { approved: false; message: string; promptActionId?: string };

export async function requestToolExecutionApproval(params: {
  payload: ToolApprovalProposalPayload;
  label: string;
  detail: string;
  userId: string | null | undefined;
  unattended: boolean;
  abortSignal?: AbortSignal;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  timeoutMs?: number;
}): Promise<ToolApprovalGateOutcome> {
  const { payload, userId } = params;

  if (
    payload.classified &&
    payload.families.length &&
    payload.families.every((family) => isToolFamilyApproved(userId, payload.scope, family))
  ) {
    return { approved: true };
  }

  if (params.unattended || !params.onActionStart) {
    return {
      approved: false,
      message: params.unattended ? UNATTENDED_MESSAGE : UNAVAILABLE_MESSAGE
    };
  }

  const handle = await params.onActionStart({
    kind: "tool_approval",
    status: "pending",
    label: params.label,
    detail: params.detail,
    proposalState: "pending",
    proposalPayload: payload
  });
  const actionId = typeof handle === "string" ? handle : "";

  if (!actionId) {
    return { approved: false, message: UNAVAILABLE_MESSAGE };
  }

  if (params.abortSignal?.aborted) {
    return { approved: false, message: STOPPED_MESSAGE, promptActionId: actionId };
  }

  return await new Promise<ToolApprovalGateOutcome>((resolve) => {
    let settled = false;

    const finish = (outcome: ToolApprovalGateOutcome) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      params.abortSignal?.removeEventListener("abort", handleAbort);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      pendingToolApprovals.delete(actionId);
      resolvePendingToolApprovalAction(actionId, payload, "expired", "Approval request expired", false);
      finish({ approved: false, message: EXPIRED_MESSAGE, promptActionId: actionId });
    }, params.timeoutMs ?? TOOL_APPROVAL_TIMEOUT_MS);
    timer.unref?.();

    function handleAbort() {
      pendingToolApprovals.delete(actionId);
      resolvePendingToolApprovalAction(actionId, payload, "stopped", "Approval request stopped", false);
      finish({ approved: false, message: STOPPED_MESSAGE, promptActionId: actionId });
    }

    params.abortSignal?.addEventListener("abort", handleAbort, { once: true });

    pendingToolApprovals.set(actionId, {
      settle: (approved) => {
        finish(
          approved
            ? { approved: true }
            : { approved: false, message: USER_DENIED_MESSAGE, promptActionId: actionId }
        );
      }
    });

    const recordedRow = getDb()
      .prepare("SELECT proposal_state FROM message_actions WHERE id = ?")
      .get(actionId) as { proposal_state: string | null } | undefined;
    if (recordedRow?.proposal_state === "approved") {
      settlePendingToolApproval(actionId, true);
    } else if (recordedRow?.proposal_state === "dismissed") {
      settlePendingToolApproval(actionId, false);
    }
  });
}
