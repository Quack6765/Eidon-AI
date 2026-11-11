import type { ToolSet } from "@/lib/tool-definitions";
import type { SkillWriteOrigin } from "./skill-guards";
import type {
  DelegationChain,
  MemoryProposalState,
  MessageActionKind,
  MessageActionStatus,
  PromptMessage,
  ProposalPayload,
  RuntimeAppSettings,
  RuntimeProviderProfile,
  Skill,
  ToolApprovalContext
} from "@/lib/types";

export type RuntimeAction = {
  kind: MessageActionKind;
  status?: MessageActionStatus;
  label: string;
  detail?: string;
  serverId?: string | null;
  skillId?: string | null;
  toolName?: string | null;
  arguments?: Record<string, unknown> | null;
  proposalState?: MemoryProposalState | null;
  proposalPayload?: ProposalPayload | null;
};

export type SuccessfulReadOnlyToolResult = {
  promptResult: string;
};

export type ToolActionPatch = { detail?: string; resultSummary?: string };

export type ToolActionCallbacks = {
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  onActionComplete?: (handle: string | undefined, patch: ToolActionPatch) => Promise<void> | void;
  onActionError?: (handle: string | undefined, patch: ToolActionPatch) => Promise<void> | void;
};

export type ToolExecutionContext = {
  input: ToolActionCallbacks & {
    settings?: RuntimeProviderProfile;
    visionProfile?: RuntimeProviderProfile;
    appSettings?: RuntimeAppSettings;
    skills?: Skill[];
    skillWriteOrigin?: SkillWriteOrigin;
    mcpToolSets?: ToolSet[];
    mcpTimeout?: number;
    conversationId?: string;
    assistantMessageId?: string;
    delegationChain?: DelegationChain;
    abortSignal?: AbortSignal;
    toolApproval?: ToolApprovalContext;
    memoryUserId?: string | null;
  };
  loadedSkillIds?: Set<string>;
  successfulReadOnlyToolResults?: Map<string, SuccessfulReadOnlyToolResult>;
  timelineSortOrder: number;
  promptMessages: PromptMessage[];
  memoryUserId?: string | null;
};

export type ToolExecutionResult = {
  nextSortOrder: number;
  promptMessages: PromptMessage[];
  toolSucceeded?: boolean;
};

export function buildToolResultMessage(toolCallId: string, content: PromptMessage["content"]): PromptMessage {
  return {
    role: "tool",
    toolCallId,
    content
  };
}

export function resolveActionHandle(handle: string | void): string | undefined {
  return typeof handle === "string" ? handle : undefined;
}

export async function emitDeniedAction(
  input: ToolActionCallbacks,
  action: RuntimeAction,
  patch: ToolActionPatch & { resultSummary: string }
) {
  const handle = resolveActionHandle(await input.onActionStart?.(action));
  await input.onActionError?.(handle, patch);
}

export function toolCallResult(
  context: Pick<ToolExecutionContext, "promptMessages">,
  toolCallId: string,
  content: PromptMessage["content"],
  nextSortOrder: number,
  toolSucceeded?: boolean
): ToolExecutionResult {
  return {
    nextSortOrder,
    promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, content)],
    ...(toolSucceeded === undefined ? {} : { toolSucceeded })
  };
}
