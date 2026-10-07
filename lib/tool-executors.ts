import { resolveAbsoluteImagePathPart } from "@/lib/attachments";
import { searchWorkspace } from "@/lib/semantic-index";
import { streamProviderResponse } from "@/lib/provider";
import { getMemory as getMemoryRecord, getMemoryCount } from "@/lib/memories";
import {
  buildCreateMemoryProposal,
  buildDeleteMemoryProposal,
  buildUpdateMemoryProposal,
  normalizeMemoryCategory
} from "@/lib/memory-proposals";
import { assertFutureRunAt, assertValidSchedule } from "@/lib/automations";
import { describeSchedule } from "@/lib/automation-display";
import { getSettings } from "@/lib/settings";
import { executeLocalShellCommand, getShellCommandLabel, resolveShellWorkspaceDir, summarizeShellResult } from "@/lib/local-shell";
import { callMcpTool, getToolResultText } from "@/lib/mcp-client";
import { coerceEnumValues } from "@/lib/tool-schema-helpers";
import { getWebSearchPipeline } from "@/lib/web-search-catalog";
import { readWebPage } from "@/lib/web-read";
import {
  getPipelineUserContext,
  runWebSearchPipeline
} from "@/lib/web-search-pipeline";
import { throwIfChatTurnAborted as throwIfAborted } from "@/lib/chat-turn-control";
import { MAX_RUNTIME_TOOL_RESULT_CHARS, truncateText } from "@/lib/bounded-text";
import { attachScreenshot, prepareScreenshotArtifact, type AttachedScreenshot } from "@/lib/browser-screenshots";
import { getLatestUserRequestText } from "./prompt-analysis";
import { getSkillResolvedDescription, getSkillResolvedName } from "./skill-runtime";
import {
  archiveLibrarySkill,
  createLibrarySkill,
  ensureLibraryReady,
  findLibrarySkill,
  getSkillLibraryDir,
  hardDeleteLibrarySkill,
  listLibrarySkills,
  normalizeSkillRef,
  parseSkillId,
  patchLibrarySkillFile,
  removeLibrarySupportFile,
  rewriteLibrarySkill,
  skillRefCategory,
  skillRefLeaf,
  writeLibrarySupportFile
} from "./skill-library";
import { evaluateSkillGuards, type SkillWriteOrigin } from "./skill-guards";
import { normalizeSkillOperation, SKILL_MANAGE_BATCH_MAX_OPS, type SkillOperation } from "./skill-operation";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type ToolSet, getToolLabel, buildArgumentsSummary, buildShellDetail } from "./tool-definitions";
import {
  classifyShellCommand,
  mcpToolApprovalFamily,
  requestToolExecutionApproval
} from "@/lib/tool-approvals";
import { buildToolApprovalPromptHeading } from "@/lib/tool-approval-display";
import { buildMessageDraftFields, supersedeMessageDraft } from "@/lib/message-drafts";
import { executeCheckBot, executeMessageBot, executeCreateBotTool, executeUpdateBotTool, executeUpdateOwnInstructionsTool } from "./bot-delegation";
import { getBotByConversationId } from "./bots";
import type { MemoryScope } from "@/lib/memories";
import {
  prepareBrowserEnv,
  resolveBrowserExecutable,
  sandboxScratchDirs,
  type BrowserSessionTarget
} from "@/lib/agent-computer";
import { conversationBrowserTarget, getComputerControl, setComputerCaption } from "@/lib/agent-computer-relay";
import { requestComputerHandoff } from "@/lib/computer-handoff";
import { requestComputerSecret } from "@/lib/computer-secrets";
import { resolveBotSandbox, type BotSandbox } from "./bot-sandbox";
import { egressProxyEnv, ensureEgressProxy } from "@/lib/egress-proxy";
import { redactSecrets, rememberSecretForRedaction } from "@/lib/secret-redaction";
import {
  listVaultEntries,
  readVaultSecret,
  resolveVaultEnv,
  saveVaultSecretForAgent,
  type VaultEntry,
  type VaultEnvRequest
} from "@/lib/vault";
import type {
  AutomationCalendarFrequency,
  AutomationScheduleKind,
  McpServer,
  McpTool,
  MessageActionStatus,
  MemoryProposalState,
  MessageActionKind,
  MessageDraftProposalPayload,
  ProposalPayload,
  DelegationChain,
  ToolApprovalContext,
  ToolApprovalProposalPayload,
  RuntimeAppSettings,
  RuntimeProviderProfile,
  ProviderToolCall,
  PromptMessage,
  PromptImageContentPart,
  Skill
} from "@/lib/types";

type RuntimeAction = {
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

type SuccessfulReadOnlyToolResult = {
  promptResult: string;
};

export type { RuntimeAction, SuccessfulReadOnlyToolResult };

export function buildToolResultMessage(toolCallId: string, content: PromptMessage["content"]): PromptMessage {
  return {
    role: "tool",
    toolCallId,
    content
  };
}

export function isProposalToolCall(name: string) {
  return (
    name === "create_memory" ||
    name === "update_memory" ||
    name === "delete_memory" ||
    name === "create_automation" ||
    name === "draft_message"
  );
}

function buildShellResultForPrompt(input: { command: string; resultSummary: string; isError: boolean }) {
  return [
    "Local shell command result",
    `Command: ${input.command}`,
    `Status: ${input.isError ? "error" : "success"}`,
    "Result:",
    input.resultSummary
  ].join("\n");
}

export async function executeWebSearch(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      settings?: RuntimeProviderProfile;
      appSettings?: RuntimeAppSettings;
      mcpTimeout?: number;
      conversationId?: string;
      assistantMessageId?: string;
      abortSignal?: AbortSignal;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const query = String(args.query ?? "").trim();
  const queries = Array.isArray(args.queries)
    ? args.queries
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const maxResults =
    typeof args.max_results === "number" && Number.isFinite(args.max_results)
      ? Math.max(1, Math.min(10, Math.round(args.max_results)))
      : undefined;

  if (!context.input.appSettings) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: Web search is not configured.");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  if (!query && !queries.length) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: query is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const pipeline = getWebSearchPipeline(context.input.appSettings.webSearch.configuration);
  const detail = truncateText(
    queries.length ? queries.join("; ") : query,
    300
  );

  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: "Web search",
    detail,
    serverId: "integration_web_search",
    toolName: "web_search",
    arguments: {
      ...(query ? { query } : {}),
      ...(queries.length ? { queries } : {}),
      ...(maxResults !== undefined ? { max_results: maxResults } : {})
    }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const result = await runWebSearchPipeline({
      query,
      queries,
      mode: pipeline.mode,
      maxQueries: pipeline.maxQueries ?? 4,
      maxResults,
      settings: context.input.appSettings,
      providerProfile: context.input.settings,
      userContext: getPipelineUserContext(context.promptMessages),
      mcpTimeout: context.input.mcpTimeout,
      abortSignal: context.input.abortSignal,
      assistantMessageId: context.input.assistantMessageId,
      conversationId: context.input.conversationId
    });
    throwIfAborted(context.input.abortSignal);

    sortOrder += 1;
    await context.input.onActionComplete?.(actionHandle, {
      detail,
      resultSummary: result.resultSummary
    });

    const resultMsg = buildToolResultMessage(toolCallId, result.resultSummary);
    return {
      nextSortOrder: sortOrder,
      promptMessages: [...context.promptMessages, resultMsg],
      toolSucceeded: !result.resultSummary.startsWith("Error:")
    };
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = error instanceof Error ? error.message : "Web search failed";
    await context.input.onActionError?.(actionHandle, {
      detail,
      resultSummary: message
    });
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return {
      nextSortOrder: sortOrder,
      promptMessages: [...context.promptMessages, resultMsg],
      toolSucceeded: false
    };
  }
}

export async function executeReadPage(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      appSettings?: RuntimeAppSettings;
      abortSignal?: AbortSignal;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const url = String(args.url ?? "").trim();
  const maxChars =
    typeof args.max_chars === "number" && Number.isFinite(args.max_chars) ? args.max_chars : undefined;

  if (!url) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: url is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: false };
  }

  const detail = truncateText(url, 300);
  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: "Read page",
    detail,
    serverId: "integration_web_search",
    toolName: "read_page",
    arguments: { url, ...(maxChars !== undefined ? { max_chars: maxChars } : {}) }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const content = await readWebPage({
      url,
      maxChars,
      settings: context.input.appSettings,
      abortSignal: context.input.abortSignal
    });
    throwIfAborted(context.input.abortSignal);

    sortOrder += 1;
    const title = content.startsWith("# ") ? content.slice(2, content.indexOf("\n")).trim() : "";
    await context.input.onActionComplete?.(actionHandle, {
      detail,
      resultSummary: `${title || "Page"} (${content.length.toLocaleString("en-US")} chars)`
    });

    const resultMsg = buildToolResultMessage(toolCallId, content);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: true };
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = error instanceof Error ? error.message : "Page could not be read";
    await context.input.onActionError?.(actionHandle, { detail, resultSummary: message });
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: false };
  }
}

export async function executeImageGeneration(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      settings?: RuntimeProviderProfile;
      appSettings?: RuntimeAppSettings;
      mcpTimeout?: number;
      conversationId?: string;
      assistantMessageId?: string;
      abortSignal?: AbortSignal;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const prompt = String(args.prompt ?? "").trim();
  let actionHandle: string | undefined;
  let createdAttachmentIds: string[] = [];
  const appSettings = context.input.appSettings;
  const conversationId = context.input.conversationId;
  const assistantMessageId = context.input.assistantMessageId;

  const requestText = getLatestUserRequestText(context.promptMessages);

  if (!context.input.settings || !appSettings || !conversationId || !assistantMessageId) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: image generation is not configured");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: false };
  }

  try {
    const initialDetail = prompt || requestText || "Generate image";
    const handle = await context.input.onActionStart?.({
      kind: "image_generation",
      label: "Generate image",
      detail: initialDetail
    });
    actionHandle = typeof handle === "string" ? handle : undefined;

    const { compileImageInstruction } = await import("@/lib/image-generation/compile-image-instruction");
    const { generateImages } = await import("@/lib/image-generation/provider");
    const { resolveEditInputImages } = await import("@/lib/image-generation/edit-inputs");
    const { parseImageSlotOverrides } = await import("@/lib/image-generation/slots");
    const { prepareCompositeStage } = await import("@/lib/image-generation/composite");
    const { renameGeneratedImages } = await import("@/lib/image-generation/generated-filenames");
    const { createAttachments } = await import("@/lib/attachments");
    const { bindAttachmentsToMessage } = await import("@/lib/attachments");
    const instruction = await compileImageInstruction({
      settings: context.input.settings,
      promptMessages: context.promptMessages,
      conversationId,
      abortSignal: context.input.abortSignal
    });
    throwIfAborted(context.input.abortSignal);

    const imageOverrides = parseImageSlotOverrides(args.images);
    const needsInputImages = instruction.mode === "edit"
      || Boolean(instruction.placement)
      || Boolean(imageOverrides?.length);
    const inputImages = needsInputImages
      ? resolveEditInputImages(context.promptMessages, conversationId, imageOverrides)
      : undefined;
    throwIfAborted(context.input.abortSignal);
    if (needsInputImages && (!inputImages || !inputImages.length)) {
      throw new Error("No reference image was available to edit");
    }

    const compositeStage = inputImages?.length
      ? await prepareCompositeStage({ slots: inputImages, placement: instruction.placement })
      : undefined;
    throwIfAborted(context.input.abortSignal);

    const backendResult = compositeStage?.directResult
      ? {
          assistantText: instruction.assistantText || "",
          images: renameGeneratedImages([compositeStage.directResult])
        }
      : await generateImages({
          settings: appSettings,
          instruction,
          inputImages: compositeStage?.slots ?? inputImages,
          mask: compositeStage?.mask,
          abortSignal: context.input.abortSignal
        });
    throwIfAborted(context.input.abortSignal);

    const attachments = await createAttachments(
      conversationId,
      backendResult.images.map((img) => ({
        filename: img.filename,
        mimeType: img.mimeType,
        bytes: img.bytes
      }))
    );
    createdAttachmentIds = attachments.map((attachment) => attachment.id);
    throwIfAborted(context.input.abortSignal);

    bindAttachmentsToMessage(
      conversationId,
      assistantMessageId,
      attachments.map((a) => a.id)
    );

    const editedImageCount = inputImages?.length ?? 0;
    const roleSummary = (compositeStage?.slots ?? inputImages ?? [])
      .map((image) => image.label)
      .filter(Boolean)
      .join(" + ");
    const resultSummary = `${editedImageCount ? "Edited" : "Generated"} ${backendResult.images.length} image${backendResult.images.length === 1 ? "" : "s"}${roleSummary ? ` using ${roleSummary}` : ""}: ${attachments.map((a) => a.filename).join(", ")}`;

    sortOrder += 1;
    await context.input.onActionComplete?.(actionHandle, {
      detail: instruction.imagePrompt || prompt,
      resultSummary
    });
    throwIfAborted(context.input.abortSignal);

    const resultMsg = buildToolResultMessage(
      toolCallId,
      `Successfully ${editedImageCount ? "edited" : "generated"} ${backendResult.images.length} image${backendResult.images.length === 1 ? "" : "s"}. ${resultSummary}`
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: true };
  } catch (error) {
    if (createdAttachmentIds.length) {
      const { deleteAttachmentById } = await import("@/lib/attachments");
      createdAttachmentIds.forEach((attachmentId) => {
        try {
          deleteAttachmentById(attachmentId, { allowAssigned: true });
        } catch {}
      });
      createdAttachmentIds = [];
    }
    throwIfAborted(context.input.abortSignal);
    const message = error instanceof Error ? error.message : "Image generation failed";
    await context.input.onActionError?.(actionHandle, {
      detail: prompt,
      resultSummary: message
    });
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: false };
  }
}

function resolveMcpToolFunction(
  functionName: string,
  toolSets: ToolSet[]
): { server: McpServer; tool: McpTool } | null {
  if (!functionName.startsWith("mcp_")) {
    return null;
  }

  const withoutPrefix = functionName.slice(4);
  const toolSetsBySpecificity = [...toolSets].sort(
    (left, right) => right.server.slug.length - left.server.slug.length
  );

  for (const { server, tools } of toolSetsBySpecificity) {
    if (withoutPrefix.startsWith(server.slug + "_")) {
      const toolName = withoutPrefix.slice(server.slug.length + 1);
      const tool = tools.find((t) => t.name === toolName);
      if (tool) {
        return { server, tool };
      }
    }
  }

  return null;
}

export async function executeMcpToolCall(
  toolCallId: string,
  functionName: string,
  args: Record<string, unknown>,
  context: {
    input: {
      mcpToolSets: ToolSet[];
      mcpTimeout?: number;
      conversationId?: string;
      abortSignal?: AbortSignal;
      toolApproval?: ToolApprovalContext;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    successfulReadOnlyToolResults: Map<string, SuccessfulReadOnlyToolResult>;
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const { server: resolvedServer, tool: resolvedTool } =
    resolveMcpToolFunction(functionName, context.input.mcpToolSets) ?? {};

  if (!resolvedServer || !resolvedTool) {
    const resultMsg = buildToolResultMessage(toolCallId, "The requested MCP tool does not exist.");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const successfulReadOnlyToolKey = `${resolvedServer.id}:${resolvedTool.name}`;
  const repeatedReadOnlyToolResult =
    resolvedTool.annotations?.readOnlyHint === true
      ? context.successfulReadOnlyToolResults.get(successfulReadOnlyToolKey)
      : undefined;

  if (repeatedReadOnlyToolResult) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      [
        "Repeated read-only tool call suppressed.",
        "Reuse the previous successful result already available for this tool.",
        "",
        repeatedReadOnlyToolResult.promptResult
      ].join("\n")
    );

    return {
      nextSortOrder: sortOrder,
      promptMessages: [...context.promptMessages, resultMsg]
    };
  }

  const correctedArgs = coerceEnumValues(resolvedTool.inputSchema ?? {}, args);

  const approvalPayload: ToolApprovalProposalPayload = {
    operation: "tool_approval",
    scope: "mcp",
    families: [mcpToolApprovalFamily(resolvedServer.slug, resolvedTool.name)],
    classified: true,
    mcpServerId: resolvedServer.id,
    mcpServerName: resolvedServer.name,
    mcpToolName: resolvedTool.name,
    arguments: correctedArgs
  };
  const approval = await requestToolExecutionApproval({
    payload: approvalPayload,
    label: buildToolApprovalPromptHeading(approvalPayload),
    detail: getToolLabel(resolvedTool),
    userId: context.input.toolApproval?.userId ?? null,
    unattended: context.input.toolApproval?.unattended ?? true,
    timeoutMs: context.input.toolApproval?.timeoutMs,
    onWaitChange: context.input.toolApproval?.onWaitChange,
    abortSignal: context.input.abortSignal,
    onActionStart: context.input.onActionStart
  });

  if (!approval.approved) {
    if (!approval.promptActionId) {
      const denialHandle = await context.input.onActionStart?.({
        kind: "mcp_tool_call",
        label: getToolLabel(resolvedTool),
        detail: buildArgumentsSummary(correctedArgs),
        serverId: resolvedServer.id,
        toolName: resolvedTool.name,
        arguments: correctedArgs
      });
      const denialActionHandle = typeof denialHandle === "string" ? denialHandle : undefined;
      await context.input.onActionError?.(denialActionHandle, {
        detail: buildArgumentsSummary(correctedArgs),
        resultSummary: approval.message
      });
    }
    const resultMsg = buildToolResultMessage(toolCallId, approval.message);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: getToolLabel(resolvedTool),
    detail: buildArgumentsSummary(correctedArgs),
    serverId: resolvedServer.id,
    toolName: resolvedTool.name,
    arguments: correctedArgs
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  const result = context.input.abortSignal
    ? await callMcpTool(
        resolvedServer,
        resolvedTool.name,
        correctedArgs,
        context.input.mcpTimeout,
        context.input.abortSignal
      )
    : await callMcpTool(resolvedServer, resolvedTool.name, correctedArgs, context.input.mcpTimeout);
  throwIfAborted(context.input.abortSignal);
  const resultText = redactSecrets(context.input.conversationId, getToolResultText(result));

  sortOrder += 1;

  if (result.isError) {
    await context.input.onActionError?.(actionHandle, { detail: buildArgumentsSummary(correctedArgs), resultSummary: resultText });
  } else {
    await context.input.onActionComplete?.(actionHandle, { detail: buildArgumentsSummary(correctedArgs), resultSummary: resultText });
  }

  if (!result.isError && resolvedTool.annotations?.readOnlyHint === true) {
    context.successfulReadOnlyToolResults.set(successfulReadOnlyToolKey, {
      promptResult: resultText
    });
  }

  const resultMsg = buildToolResultMessage(toolCallId, resultText);

  return {
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, resultMsg]
  };
}

export async function executeLoadSkill(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      abortSignal?: AbortSignal;
      skills: Skill[];
      conversationId?: string;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    loadedSkillIds: Set<string>;
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const skillName = String(args.skill_name ?? "").trim().toLowerCase();

  let skill = context.input.skills.find(
    (candidate) => getSkillResolvedName(candidate).toLowerCase() === skillName
  );

  let workspaceSkills: Skill[] = [];
  if (!skill) {
    const bot = context.input.conversationId
      ? getBotByConversationId(context.input.conversationId)
      : null;
    workspaceSkills = bot ? listLibrarySkills(bot.userId ?? null) : [];
    skill = workspaceSkills.find(
      (candidate) => getSkillResolvedName(candidate).toLowerCase() === skillName
    );
  }

  if (!skill || context.loadedSkillIds.has(skill.id)) {
    const availableNames = [
      ...new Set(
        [...context.input.skills, ...workspaceSkills]
          .map((s) => getSkillResolvedName(s))
          .filter(Boolean)
      )
    ].join(", ");
    const resultMsg = buildToolResultMessage(
      toolCallId,
      skill ? "This skill is already loaded." : `Skill "${skillName}" not found. Available: ${availableNames}`
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const skillContent = await loadSkillIntoTurn(skill, context.input, context.loadedSkillIds);
  sortOrder += 1;

  const resultMsg = buildToolResultMessage(toolCallId, skillContent);
  return {
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, resultMsg]
  };
}

export async function loadSkillIntoTurn(
  skill: Skill,
  input: {
    abortSignal?: AbortSignal;
    onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
    onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
  },
  loadedSkillIds: Set<string>
) {
  throwIfAborted(input.abortSignal);
  loadedSkillIds.add(skill.id);
  try {
    const handle = await input.onActionStart?.({
      kind: "skill_load",
      label: "Load skill",
      detail: getSkillResolvedName(skill),
      skillId: skill.id
    });
    throwIfAborted(input.abortSignal);
    await input.onActionComplete?.(typeof handle === "string" ? handle : undefined, {
      detail: getSkillResolvedName(skill),
      resultSummary: "Skill instructions loaded."
    });
    throwIfAborted(input.abortSignal);
  } catch (error) {
    loadedSkillIds.delete(skill.id);
    throw error;
  }

  return truncateText([
    `Skill loaded: ${getSkillResolvedName(skill)}`,
    `Description: ${getSkillResolvedDescription(skill)}`,
    "",
    skill.content
  ].join("\n"), MAX_RUNTIME_TOOL_RESULT_CHARS);
}

export async function executeSkillManage(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      abortSignal?: AbortSignal;
      conversationId?: string;
      memoryUserId?: string | null;
      skills?: Skill[];
      skillWriteOrigin?: SkillWriteOrigin;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (
        handle: string | undefined,
        patch: { detail?: string; resultSummary?: string }
      ) => Promise<void> | void;
      onActionError?: (
        handle: string | undefined,
        patch: { detail?: string; resultSummary?: string }
      ) => Promise<void> | void;
    };
    loadedSkillIds: Set<string>;
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
): Promise<{
  nextSortOrder: number;
  promptMessages: PromptMessage[];
  toolSucceeded?: boolean;
}> {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const errorResult = (message: string) => ({
    nextSortOrder: sortOrder + 1,
    promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, `Error: ${message}`)],
    toolSucceeded: false
  });

  const bot = context.input.conversationId ? getBotByConversationId(context.input.conversationId) : null;
  const origin: SkillWriteOrigin = context.input.skillWriteOrigin ?? "foreground";

  if (!bot && origin === "foreground") {
    return errorResult("skill_manage is only available in agent conversations that have a workspace.");
  }

  const ownerUserId = bot?.userId ?? context.input.memoryUserId ?? null;
  if (ownerUserId === null && bot?.userId !== null) {
    return errorResult("skill_manage could not determine which skill library to write to.");
  }

  ensureLibraryReady(ownerUserId);

  const rawOperations = Array.isArray(args.operations) ? args.operations : [args];
  if (!rawOperations.length) {
    return errorResult("operations must contain at least one operation.");
  }
  if (rawOperations.length > SKILL_MANAGE_BATCH_MAX_OPS) {
    return errorResult(`operations exceeds the batch limit of ${SKILL_MANAGE_BATCH_MAX_OPS}.`);
  }

  const operations = rawOperations.map((entry) => normalizeSkillOperation(entry));
  const invalid = operations.find((entry) => "error" in entry);
  if (invalid && "error" in invalid) {
    return errorResult(invalid.error);
  }

  const deleteOps = operations.filter((entry) => !("error" in entry) && entry.action === "delete");
  if (deleteOps.length && operations.length > 1) {
    return errorResult("delete must be the SOLE op in its call — it doesn't compose with other ops' rollback.");
  }

  const loadedRefs = new Set(
    [...context.loadedSkillIds].map((id) => parseSkillId(id)).filter((ref): ref is string => Boolean(ref))
  );

  const results: string[] = [];
  const undoStack: Array<() => void> = [];

  const rollback = () => {
    for (const undo of undoStack.reverse()) {
      try {
        undo();
      } catch {
        // best effort
      }
    }
  };

  const snapshotFile = (path: string) => {
    const before = existsSync(path) ? readFileSync(path, "utf8") : null;
    undoStack.push(() => {
      if (before === null) {
        rmSync(path, { force: true });
      } else {
        writeFileSync(path, before, "utf8");
      }
    });
  };

  try {
    for (const operation of operations as SkillOperation[]) {
      throwIfAborted(context.input.abortSignal);

      const guard = evaluateSkillGuards({
        ownerUserId,
        ref: operation.name,
        name: operation.name,
        action: operation.action,
        origin,
        absorbedInto: operation.action === "delete" ? operation.absorbedInto ?? null : null,
        loadedRefs,
        filePath: "filePath" in operation ? operation.filePath ?? null : null
      });

      if (!guard.ok) {
        throw new Error(guard.error);
      }

      const found = findLibrarySkill(ownerUserId, operation.name);
      const ref = found?.ref ?? normalizeSkillRef(operation.name) ?? operation.name;

      switch (operation.action) {
        case "create": {
          snapshotFile(join(getSkillLibraryDir(ownerUserId), ...ref.split("/"), "SKILL.md"));
          const created = createLibrarySkill(ownerUserId, {
            name: skillRefLeaf(ref),
            category: skillRefCategory(ref),
            content: operation.content,
            actor: origin === "background-review" ? "background-review" : "foreground",
            agentAuthored: origin === "background-review"
          });
          if ("error" in created) {
            throw new Error(created.error);
          }
          results.push(created.warning ? `Skill '${created.ref}' created. ${created.warning}` : `Skill '${created.ref}' created.`);
          break;
        }

        case "patch": {
          if (!found) {
            throw new Error(`Skill '${operation.name}' not found in the active library.`);
          }
          snapshotFile(join(getSkillLibraryDir(ownerUserId), ...found.ref.split("/"), "SKILL.md"));
          if (operation.content !== undefined) {
            const rewritten = rewriteLibrarySkill(ownerUserId, found.ref, {
              content: operation.content,
              actor: origin === "background-review" ? "background-review" : "foreground"
            });
            if ("error" in rewritten) {
              throw new Error(rewritten.error);
            }
            results.push(`Skill '${found.ref}' updated (full rewrite).`);
          } else {
            const patched = patchLibrarySkillFile(ownerUserId, found.ref, {
              oldString: operation.oldString ?? "",
              newString: operation.newString ?? "",
              replaceAll: operation.replaceAll,
              filePath: operation.filePath,
              actor: origin === "background-review" ? "background-review" : "foreground"
            });
            if ("error" in patched) {
              throw new Error(patched.error);
            }
            results.push(`Patched ${patched.filePath} in skill '${found.ref}' (${patched.replacements} replacement(s).)`);
          }
          break;
        }

        case "write_file": {
          if (!found) {
            throw new Error(`Skill '${operation.name}' not found in the active library. Create it first with action='create'.`);
          }
          const targetPath = join(getSkillLibraryDir(ownerUserId), ...found.ref.split("/"), ...(operation.filePath ?? "").split("/"));
          snapshotFile(targetPath);
          const written = writeLibrarySupportFile(ownerUserId, found.ref, {
            filePath: operation.filePath ?? "",
            fileContent: operation.fileContent ?? "",
            actor: origin === "background-review" ? "background-review" : "foreground"
          });
          if ("error" in written) {
            throw new Error(written.error);
          }
          results.push(`File '${written.filePath}' written to skill '${found.ref}'.`);
          break;
        }

        case "remove_file": {
          if (!found) {
            throw new Error(`Skill '${operation.name}' not found in the active library.`);
          }
          const targetPath = join(getSkillLibraryDir(ownerUserId), ...found.ref.split("/"), ...(operation.filePath ?? "").split("/"));
          snapshotFile(targetPath);
          const removed = removeLibrarySupportFile(ownerUserId, found.ref, {
            filePath: operation.filePath ?? "",
            actor: origin === "background-review" ? "background-review" : "foreground"
          });
          if ("error" in removed) {
            throw new Error(removed.error);
          }
          results.push(`File '${removed.filePath}' removed from skill '${found.ref}'.`);
          break;
        }

        case "delete": {
          if (!found) {
            throw new Error(`Skill '${operation.name}' not found in the active library.`);
          }
          const deleted =
            origin === "foreground"
              ? hardDeleteLibrarySkill(ownerUserId, found.ref, "foreground")
              : archiveLibrarySkill(ownerUserId, found.ref);
          if ("error" in deleted) {
            throw new Error(deleted.error);
          }
          results.push(
            origin === "foreground"
              ? `Skill '${found.ref}' deleted.`
              : `Skill '${found.ref}' archived (recoverable under .archive/).`
          );
          break;
        }
      }
    }
  } catch (error) {
    rollback();
    const message = error instanceof Error ? error.message : "skill_manage failed";
    const handle = await context.input.onActionStart?.({
      kind: "skill_manage",
      label: "Skill manage",
      detail: message.split("\n")[0]
    });
    await context.input.onActionError?.(typeof handle === "string" ? handle : undefined, {
      resultSummary: message
    });
    return errorResult(message);
  }

  throwIfAborted(context.input.abortSignal);
  const detail = results[0]?.split("\n")[0] ?? "skill_manage";
  const handle = await context.input.onActionStart?.({
    kind: "skill_manage",
    label: "Update skills",
    detail,
    toolName: "skill_manage"
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;
  await context.input.onActionComplete?.(actionHandle, {
    detail,
    resultSummary: results.join(" ")
  });

  const refreshed = listLibrarySkills(ownerUserId).find((skill) => results.some((line) => line.includes(`'${skill.name}'`) || line.includes(`'${skill.id}'`)));
  const turnSkills = context.input.skills;
  if (turnSkills && refreshed) {
    const existingIndex = turnSkills.findIndex((skill) => skill.id === refreshed.id);
    if (existingIndex >= 0) {
      turnSkills[existingIndex] = refreshed;
    } else {
      turnSkills.push(refreshed);
    }
  }

  return {
    nextSortOrder: sortOrder + 1,
    promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, results.join("\n"))],
    toolSucceeded: true
  };
}

export async function executeShellCommand(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      conversationId?: string;
      assistantMessageId?: string;
      abortSignal?: AbortSignal;
      toolApproval?: ToolApprovalContext;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const command = String(args.command ?? "").trim();
  const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : undefined;

  if (!command) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: Shell command is required.");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const vaultEnv = resolveShellSecrets(context.input, args.secrets);
  if ("error" in vaultEnv) {
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${vaultEnv.error}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }
  const secrets = vaultEnv.resolved.map(({ entry, variable }) => ({ name: entry.name, variable }));
  const actionArguments = { command, timeoutMs, ...(secrets.length ? { secrets } : {}) };

  if (
    getShellCommandLabel(command) === "Web browser" &&
    getComputerControl(conversationBrowserTarget(context.input.conversationId)) === "user"
  ) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      "Error: The user has control of the browser right now. Wait until they return it, then try again. Use request_takeover if you need them to do a step for you."
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const classification = classifyShellCommand(command);
  const approvalPayload: ToolApprovalProposalPayload = {
    operation: "tool_approval",
    scope: "shell",
    families: classification.families,
    classified: classification.classified,
    command,
    ...(secrets.length ? { arguments: { secrets } } : {})
  };
  const approval = await requestToolExecutionApproval({
    payload: approvalPayload,
    label: buildToolApprovalPromptHeading(approvalPayload),
    detail: buildShellDetail(command),
    userId: context.input.toolApproval?.userId ?? null,
    unattended: context.input.toolApproval?.unattended ?? true,
    timeoutMs: context.input.toolApproval?.timeoutMs,
    onWaitChange: context.input.toolApproval?.onWaitChange,
    abortSignal: context.input.abortSignal,
    onActionStart: context.input.onActionStart
  });

  if (!approval.approved) {
    if (!approval.promptActionId) {
      const denialHandle = await context.input.onActionStart?.({
        kind: "shell_command",
        label: getShellCommandLabel(command),
        detail: buildShellDetail(command),
        arguments: actionArguments
      });
      const denialActionHandle = typeof denialHandle === "string" ? denialHandle : undefined;
      await context.input.onActionError?.(denialActionHandle, {
        detail: buildShellDetail(command),
        resultSummary: approval.message
      });
    }
    const resultMsg = buildToolResultMessage(toolCallId, approval.message);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const handle = await context.input.onActionStart?.({
    kind: "shell_command",
    label: getShellCommandLabel(command),
    detail: buildShellDetail(command),
    arguments: actionArguments
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;
  const screenshotCandidate = prepareScreenshotArtifact(command);

  const bot = context.input.conversationId
    ? getBotByConversationId(context.input.conversationId)
    : null;
  const sandbox = bot ? resolveBotSandbox(bot) : null;
  const browserTarget = conversationBrowserTarget(context.input.conversationId);
  const usesBrowser = getShellCommandLabel(command) === "Web browser";

  try {
    const cwd = sandbox ? sandbox.cwd : resolveShellWorkspaceDir(context.input.conversationId);
    const browserEnv = await prepareBrowserEnv(browserTarget, usesBrowser);
    const botShell = sandbox ? await botShellSandbox(sandbox, browserTarget) : null;
    throwIfAborted(context.input.abortSignal);
    if (usesBrowser) setComputerCaption(browserTarget, buildShellDetail(command));
    const secretEnv = readShellSecrets(vaultEnv, context.input);
    const shellResult = await executeLocalShellCommand({
      command,
      timeoutMs,
      abortSignal: context.input.abortSignal,
      cwd,
      env: { ...browserEnv, ...botShell?.env },
      secretEnv,
      isolation: botShell?.rules
    });
    const result = {
      ...shellResult,
      stdout: redactSecrets(context.input.conversationId, shellResult.stdout),
      stderr: redactSecrets(context.input.conversationId, shellResult.stderr)
    };
    throwIfAborted(context.input.abortSignal);
    let resultSummary = summarizeShellResult(result);
    const executionSucceeded = !result.isError && !result.timedOut && result.exitCode === 0;
    let screenshot: AttachedScreenshot | null = null;

    sortOrder += 1;

    if (!executionSucceeded) {
      await context.input.onActionError?.(actionHandle, { detail: buildShellDetail(command), resultSummary });
    } else {
      const { conversationId, assistantMessageId } = context.input;
      if (screenshotCandidate && conversationId && assistantMessageId) {
        screenshot = await attachScreenshot({ candidate: screenshotCandidate, conversationId, assistantMessageId });
      }
      if (screenshot) {
        resultSummary = `${resultSummary}\n\n${screenshot.note}`;
      }
      await context.input.onActionComplete?.(actionHandle, {
        detail: buildShellDetail(command),
        resultSummary
      });
    }

    const resultText = buildShellResultForPrompt({
      command,
      resultSummary,
      isError: !executionSucceeded
    });
    const resultMsg = buildToolResultMessage(
      toolCallId,
      screenshot?.image ? [{ type: "text", text: resultText }, screenshot.image] : resultText
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = redactSecrets(
      context.input.conversationId,
      error instanceof Error ? error.message : "Shell command execution failed"
    );
    await context.input.onActionError?.(actionHandle, { detail: buildShellDetail(command), resultSummary: message });
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  } finally {
    if (usesBrowser) setComputerCaption(browserTarget, null);
  }
}

type VaultContextInput = { conversationId?: string; toolApproval?: ToolApprovalContext };

function vaultOwner(input: VaultContextInput) {
  const userId = input.toolApproval?.userId;
  return userId && input.conversationId ? { userId, conversationId: input.conversationId } : null;
}

const VAULT_UNAVAILABLE = "The vault is only available in the user's own conversations.";

function parseSecretRequests(value: unknown): VaultEnvRequest[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const requests: VaultEnvRequest[] = [];
  for (const item of value) {
    const { name, variable } = (item ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof variable !== "string") return null;
    requests.push({ name, variable });
  }
  return requests;
}

function resolveShellSecrets(input: VaultContextInput, value: unknown) {
  const requests = parseSecretRequests(value);
  if (!requests) return { error: "secrets must be a list of { name, variable } objects." };
  if (!requests.length) return { resolved: [] };
  const owner = vaultOwner(input);
  if (!owner) return { error: VAULT_UNAVAILABLE };
  return resolveVaultEnv(owner.userId, requests);
}

function readShellSecrets(vaultEnv: { resolved: Array<{ entry: VaultEntry; variable: string }> }, input: VaultContextInput) {
  const owner = vaultOwner(input);
  if (!owner || !vaultEnv.resolved.length) return undefined;
  return Object.fromEntries(
    vaultEnv.resolved.map(({ entry, variable }) => {
      const value = readVaultSecret(owner.userId, entry.id);
      if (value === null) throw new Error(`"${entry.name}" is no longer in the vault.`);
      rememberSecretForRedaction(owner.conversationId, value);
      return [variable, value];
    })
  );
}

function describeVaultEntry(entry: VaultEntry) {
  return [
    `- ${entry.name}`,
    entry.origin ? `site: ${entry.origin}` : "no site",
    entry.username ? `username: ${entry.username}` : "",
    entry.notes ? `notes: ${entry.notes}` : "",
    `updated ${entry.updatedAt.slice(0, 10)}`
  ]
    .filter(Boolean)
    .join(" · ");
}

async function executeListSecrets(
  toolCallId: string,
  context: {
    input: VaultContextInput & {
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const owner = vaultOwner(context.input);
  if (!owner) {
    return {
      nextSortOrder: context.timelineSortOrder,
      promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, `Error: ${VAULT_UNAVAILABLE}`)]
    };
  }
  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: "Check vault",
    detail: "",
    serverId: "integration_vault",
    toolName: "list_secrets",
    arguments: {}
  });
  const entries = listVaultEntries(owner.userId);
  const summary = entries.length === 1 ? "1 secret" : `${entries.length} secrets`;
  await context.input.onActionComplete?.(typeof handle === "string" ? handle : undefined, { resultSummary: summary });
  const resultText = entries.length
    ? `The user's vault (values are never shown):\n${entries.map(describeVaultEntry).join("\n")}`
    : "The user's vault is empty.";
  return {
    nextSortOrder: context.timelineSortOrder + 1,
    promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, resultText)]
  };
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

async function executeSaveSecret(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: VaultContextInput & {
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const owner = vaultOwner(context.input);
  const name = optionalString(args.name)?.trim() ?? "";
  const secret = optionalString(args.secret) || undefined;
  if (secret && owner) rememberSecretForRedaction(owner.conversationId, secret);
  const fail = (message: string) => ({
    nextSortOrder: context.timelineSortOrder,
    promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, `Error: ${message}`)]
  });
  if (!owner) return fail(VAULT_UNAVAILABLE);
  if (!name) return fail("save_secret needs a name.");

  const input = {
    name,
    origin: optionalString(args.origin),
    username: optionalString(args.username),
    notes: optionalString(args.notes)
  };
  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: "Save to vault",
    detail: name,
    serverId: "integration_vault",
    toolName: "save_secret",
    arguments: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;
  const result = saveVaultSecretForAgent(owner.userId, { ...input, secret });
  if ("error" in result) {
    await context.input.onActionError?.(actionHandle, { detail: name, resultSummary: result.error });
    return {
      nextSortOrder: context.timelineSortOrder + 1,
      promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, `Error: ${result.error}`)]
    };
  }
  const verb = result.created ? "Saved" : "Updated";
  await context.input.onActionComplete?.(actionHandle, { detail: result.entry.name, resultSummary: `${verb} in your vault` });
  return {
    nextSortOrder: context.timelineSortOrder + 1,
    promptMessages: [
      ...context.promptMessages,
      buildToolResultMessage(
        toolCallId,
        `${verb} "${result.entry.name}" in the user's vault${result.entry.origin ? ` for ${result.entry.origin}` : ""}. Refer to it by that name; never repeat the value.`
      )
    ]
  };
}

async function botShellSandbox(sandbox: BotSandbox, browserTarget: BrowserSessionTarget) {
  const proxyPort = await ensureEgressProxy();
  return {
    env: { HOME: sandbox.homeDir, ...egressProxyEnv(proxyPort) },
    rules: {
      readWrite: [sandbox.workspaceDir, sandbox.sharedDir, sandbox.homeDir, browserTarget.socketDir, ...sandboxScratchDirs()],
      connectPorts: resolveBrowserExecutable() ? [proxyPort] : undefined
    }
  };
}

async function executeRequestTakeover(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      conversationId?: string;
      abortSignal?: AbortSignal;
      toolApproval?: ToolApprovalContext;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  const reason = String(args.reason ?? "").trim().slice(0, 500) || "Finish a step in the browser";
  const resultText = await requestComputerHandoff({
    conversationId: context.input.conversationId,
    reason,
    abortSignal: context.input.abortSignal,
    onActionStart: context.input.onActionStart,
    onWaitChange: context.input.toolApproval?.onWaitChange
  });
  throwIfAborted(context.input.abortSignal);
  return {
    nextSortOrder: context.timelineSortOrder + 1,
    promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, resultText)]
  };
}

async function executeRequestSecret(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      conversationId?: string;
      abortSignal?: AbortSignal;
      toolApproval?: ToolApprovalContext;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  const replaceSaved = args.replace_saved === true;
  const resultText = await requestComputerSecret({
    conversationId: context.input.conversationId,
    userId: context.input.toolApproval?.userId,
    name: String(args.name ?? ""),
    origin: String(args.origin ?? ""),
    target: String(args.target ?? ""),
    save: args.save === true || replaceSaved,
    replaceSaved,
    abortSignal: context.input.abortSignal,
    onActionStart: context.input.onActionStart,
    onActionComplete: context.input.onActionComplete,
    onActionError: context.input.onActionError,
    onWaitChange: context.input.toolApproval?.onWaitChange
  });
  throwIfAborted(context.input.abortSignal);
  return {
    nextSortOrder: context.timelineSortOrder + 1,
    promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, resultText)]
  };
}

function resolveMemoryScope(conversationId?: string): MemoryScope | undefined {
  if (!conversationId) return undefined;
  const bot = getBotByConversationId(conversationId);
  return bot ? { botId: bot.id } : undefined;
}

type MemoryToolExecutionContext = {
  memoryUserId?: string | null;
  input: {
    conversationId?: string;
    abortSignal?: AbortSignal;
    onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
    onActionComplete?: (
      handle: string | undefined,
      patch: { detail?: string; resultSummary?: string }
    ) => Promise<void> | void;
    onActionError?: (
      handle: string | undefined,
      patch: { detail?: string; resultSummary?: string }
    ) => Promise<void> | void;
  };
  timelineSortOrder: number;
  promptMessages: PromptMessage[];
};

export async function executeCreateMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: MemoryToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const content = String(args.content ?? "").trim();

  if (!content) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: content is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const normalizedCategory = normalizeMemoryCategory(args.category);
  const memoryScope = resolveMemoryScope(context.input.conversationId);
  const proposalPayload = buildCreateMemoryProposal({
    content,
    category: normalizedCategory,
    botId: memoryScope?.botId ?? null
  });
  const maxCount = getSettings().memoriesMaxCount ?? 100;
  const currentCount = getMemoryCount(context.memoryUserId, memoryScope);
  throwIfAborted(context.input.abortSignal);

  if (currentCount >= maxCount) {
    const errorMsg = `Memory limit reached (${currentCount}/${maxCount}). Update or delete an existing memory instead.`;
    const resultMsg = buildToolResultMessage(toolCallId, errorMsg);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  throwIfAborted(context.input.abortSignal);
  await context.input.onActionStart?.({
    kind: "create_memory",
    status: "pending",
    label: "Create memory proposal",
    detail: content,
    arguments: { content, category: normalizedCategory },
    proposalState: "pending",
    proposalPayload
  });
  throwIfAborted(context.input.abortSignal);

  const resultMsg = buildToolResultMessage(
    toolCallId,
    `Memory change proposed for approval: create [${normalizedCategory}] ${content}`
  );
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

export async function executeUpdateMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: MemoryToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const id = String(args.id ?? "").trim();
  const content = String(args.content ?? "").trim();
  const category = args.category ? String(args.category).trim() : undefined;

  if (!id || !content) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: id and content are required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const memoryScope = resolveMemoryScope(context.input.conversationId);
  const existing = getMemoryRecord(id, context.memoryUserId, memoryScope);
  throwIfAborted(context.input.abortSignal);
  if (!existing) {
    const notFoundMsg = memoryScope
      ? `Error: Memory ${id} not found in your bot memory pool. Main account memories are read-only for bots; if this fact lives there, save an updated copy to your own memory instead.`
      : `Error: Memory ${id} not found`;
    const resultMsg = buildToolResultMessage(toolCallId, notFoundMsg);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const proposalPayload = buildUpdateMemoryProposal({
    memory: existing,
    content,
    category,
    botId: memoryScope?.botId ?? null
  });

  throwIfAborted(context.input.abortSignal);
  await context.input.onActionStart?.({
    kind: "update_memory",
    status: "pending",
    label: "Update memory proposal",
    detail: content,
    arguments: {
      id,
      content,
      ...(proposalPayload.proposedMemory ? { category: proposalPayload.proposedMemory.category } : {})
    },
    proposalState: "pending",
    proposalPayload
  });
  throwIfAborted(context.input.abortSignal);

  const resultMsg = buildToolResultMessage(
    toolCallId,
    `Memory change proposed for approval: update ${id} -> ${content} [${proposalPayload.proposedMemory?.category ?? existing.category}]`
  );
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

export async function executeDeleteMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: MemoryToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const id = String(args.id ?? "").trim();

  if (!id) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: id is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const memoryScope = resolveMemoryScope(context.input.conversationId);
  const existing = getMemoryRecord(id, context.memoryUserId, memoryScope);
  throwIfAborted(context.input.abortSignal);
  if (!existing) {
    const notFoundMsg = memoryScope
      ? `Error: Memory ${id} not found in your bot memory pool. Main account memories are read-only for bots.`
      : `Error: Memory ${id} not found`;
    const resultMsg = buildToolResultMessage(toolCallId, notFoundMsg);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  throwIfAborted(context.input.abortSignal);
  await context.input.onActionStart?.({
    kind: "delete_memory",
    status: "pending",
    label: "Delete memory proposal",
    detail: existing.content,
    arguments: { id },
    proposalState: "pending",
    proposalPayload: buildDeleteMemoryProposal(existing, memoryScope?.botId ?? null)
  });
  throwIfAborted(context.input.abortSignal);

  const resultMsg = buildToolResultMessage(
    toolCallId,
    `Memory change proposed for approval: delete ${id}`
  );
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

type AutomationToolExecutionContext = {
  input: {
    settings?: RuntimeProviderProfile;
    conversationId?: string;
    abortSignal?: AbortSignal;
    onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  };
  timelineSortOrder: number;
  promptMessages: PromptMessage[];
};

function parseAutomationScheduleArgs(args: Record<string, unknown>): {
  scheduleKind: AutomationScheduleKind;
  intervalMinutes: number | null;
  calendarFrequency: AutomationCalendarFrequency | null;
  timeOfDay: string | null;
  daysOfWeek: number[];
  runAt: string | null;
} {
  const scheduleKind: AutomationScheduleKind =
    args.schedule_kind === "calendar"
      ? "calendar"
      : args.schedule_kind === "once"
        ? "once"
        : "interval";
  const intervalMinutes =
    typeof args.interval_minutes === "number" && Number.isFinite(args.interval_minutes)
      ? Math.round(args.interval_minutes)
      : null;
  const calendarFrequency: AutomationCalendarFrequency | null =
    args.calendar_frequency === "weekly" ? "weekly" : args.calendar_frequency === "daily" ? "daily" : null;
  const timeOfDay = typeof args.time_of_day === "string" && args.time_of_day.trim() ? args.time_of_day.trim() : null;
  const daysOfWeek = Array.isArray(args.days_of_week)
    ? args.days_of_week.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  const runAt = (() => {
    if (scheduleKind !== "once" || typeof args.run_at !== "string" || !args.run_at.trim()) {
      return null;
    }

    const parsed = new Date(args.run_at.trim());
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  })();

  return { scheduleKind, intervalMinutes, calendarFrequency, timeOfDay, daysOfWeek, runAt };
}

export async function executeCreateAutomationProposal(
  toolCallId: string,
  args: Record<string, unknown>,
  context: AutomationToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const name = String(args.name ?? "").trim().slice(0, 100);
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const continuePreviousConversation = args.continue_previous_conversation === true;

  if (!name) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: name is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  if (!prompt) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: prompt is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const schedule = parseAutomationScheduleArgs(args);

  try {
    assertValidSchedule(schedule);
    assertFutureRunAt(schedule.scheduleKind, schedule.runAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid automation schedule";
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const providerProfileId = context.input.settings?.id ?? "";
  if (!providerProfileId) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      "Error: no provider profile is configured for this conversation"
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const bot = context.input.conversationId ? getBotByConversationId(context.input.conversationId) : null;
  const proposalPayload = {
    name,
    prompt,
    scheduleKind: schedule.scheduleKind,
    intervalMinutes: schedule.intervalMinutes,
    calendarFrequency: schedule.calendarFrequency,
    timeOfDay: schedule.timeOfDay,
    daysOfWeek: schedule.daysOfWeek,
    runAt: schedule.runAt,
    providerProfileId,
    personaId: null,
    botId: bot?.id ?? null,
    continuePreviousConversation: bot ? false : continuePreviousConversation
  };
  const scheduleSummary = describeSchedule(proposalPayload);

  throwIfAborted(context.input.abortSignal);
  await context.input.onActionStart?.({
    kind: "create_automation",
    status: "pending",
    label: "Automation proposal",
    detail: `${name} — ${scheduleSummary}`,
    arguments: { name, prompt, ...schedule, continue_previous_conversation: continuePreviousConversation },
    proposalState: "pending",
    proposalPayload
  });
  throwIfAborted(context.input.abortSignal);

  const onceNote =
    schedule.scheduleKind === "once"
      ? " It runs a single time and then deletes itself."
      : "";

  const resultMsg = buildToolResultMessage(
    toolCallId,
    `Automation proposal created and awaiting user approval: "${name}" (${scheduleSummary}). Nothing is scheduled until the user approves it on the proposal card.${onceNote} Tell the user you have proposed the automation and that they can review and approve it.`
  );
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

export async function executeDraftMessage(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      mcpToolSets: ToolSet[];
      conversationId?: string;
      abortSignal?: AbortSignal;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const fail = (message: string) => ({
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, buildToolResultMessage(toolCallId, `Error: ${message}`)]
  });
  const functionName = typeof args.tool === "string" ? args.tool.trim() : "";
  const rawArguments = args.arguments;

  if (!functionName) {
    return fail("tool is required: pass the exact name of the connected tool that sends the message");
  }

  if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
    return fail("arguments must be an object with the arguments for the sending tool");
  }

  const resolved = resolveMcpToolFunction(functionName, context.input.mcpToolSets);
  if (!resolved) {
    return fail(`${functionName} is not a connected tool. Use the exact name of a tool from your tool list, such as mcp_<server>_<tool>.`);
  }

  const { server, tool } = resolved;
  if (tool.annotations?.readOnlyHint === true) {
    return fail(`${functionName} is read-only and does not send anything. Call it directly instead.`);
  }

  const toolArguments = coerceEnumValues(tool.inputSchema ?? {}, rawArguments as Record<string, unknown>);
  const missing = (tool.inputSchema?.required ?? []).filter((key) => toolArguments[key] === undefined);
  if (missing.length) {
    return fail(`missing required arguments for ${functionName}: ${missing.join(", ")}`);
  }

  const fields = buildMessageDraftFields(tool, toolArguments);
  if (!fields.length) {
    return fail(`${functionName} has no text for the user to review. Call it directly instead.`);
  }

  const replacesDraftId = typeof args.replaces_draft_id === "string" ? args.replaces_draft_id.trim() : "";
  const replaced =
    replacesDraftId && context.input.conversationId
      ? supersedeMessageDraft(replacesDraftId, context.input.conversationId)
      : false;

  const proposalPayload: MessageDraftProposalPayload = {
    operation: "message_draft",
    mcpServerId: server.id,
    mcpServerName: server.name,
    mcpToolName: tool.name,
    toolLabel: getToolLabel(tool),
    arguments: toolArguments,
    fields
  };

  throwIfAborted(context.input.abortSignal);
  const handle = await context.input.onActionStart?.({
    kind: "draft_message",
    status: "pending",
    label: `Message draft for ${server.name}`,
    detail: buildArgumentsSummary(toolArguments),
    serverId: server.id,
    toolName: "draft_message",
    arguments: { tool: functionName, arguments: toolArguments },
    proposalState: "pending",
    proposalPayload
  });
  throwIfAborted(context.input.abortSignal);
  const draftId = typeof handle === "string" && handle ? handle : null;

  const resultMsg = buildToolResultMessage(
    toolCallId,
    [
      `Draft${draftId ? ` ${draftId}` : ""} is ready for the user to review, edit, and send with ${server.name}. Nothing has been sent.`,
      replacesDraftId
        ? replaced
          ? `Draft ${replacesDraftId} was withdrawn and replaced by this one.`
          : `Draft ${replacesDraftId} was not replaced because it is no longer waiting; the user may already have sent or discarded it.`
        : "",
      "Tell the user the draft is ready below without repeating its full text, and never claim it was sent."
    ]
      .filter(Boolean)
      .join(" ")
  );
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

const VISION_ANALYSIS_SYSTEM_PROMPT =
  "You are a vision analysis sub-agent. Describe what is visible in the provided images precisely and answer the question about the images. Be thorough but concise. Never invent details that are not visible in the images.";

export async function executeAnalyzeImage(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      visionProfile?: RuntimeProviderProfile;
      abortSignal?: AbortSignal;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      conversationId?: string;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;

  const rawPaths = args.file_paths;
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      "Error: file_paths must be a non-empty array of absolute image paths"
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }
  if (rawPaths.length > 10) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      "Error: file_paths accepts at most 10 image paths"
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const conversationId = context.input.conversationId;
  if (!conversationId) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      "Error: conversation context is required for image analysis"
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const question = typeof args.question === "string" ? args.question.trim() : "";

  let imageParts: PromptImageContentPart[];
  try {
    imageParts = rawPaths.map((filePath) =>
      resolveAbsoluteImagePathPart(String(filePath), { conversationId })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid image path";
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  if (!context.input.visionProfile) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      "Error: vision analysis is not configured for this conversation"
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const detail = question || `${imageParts.length} image${imageParts.length === 1 ? "" : "s"}`;
  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: "Analyze image",
    detail,
    serverId: "integration_vision",
    toolName: "analyze_image",
    arguments: {
      file_paths: rawPaths.map(String),
      ...(question ? { question } : {})
    }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const promptMessages: PromptMessage[] = [
      { role: "system", content: VISION_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: question || "Describe these images in detail." },
          ...imageParts
        ]
      }
    ];

    const providerStream = streamProviderResponse({
      settings: context.input.visionProfile,
      promptMessages,
      conversationId,
      abortSignal: context.input.abortSignal
    });

    let answer = "";
    while (true) {
      const next = await providerStream.next();
      if (next.done) {
        answer = next.value.answer;
        break;
      }
    }

    throwIfAborted(context.input.abortSignal);
    if (!answer.trim()) {
      throw new Error("Vision analysis returned an empty response");
    }

    sortOrder += 1;
    await context.input.onActionComplete?.(actionHandle, {
      detail,
      resultSummary: truncateText(answer, MAX_RUNTIME_TOOL_RESULT_CHARS)
    });

    const resultMsg = buildToolResultMessage(
      toolCallId,
      truncateText(answer, MAX_RUNTIME_TOOL_RESULT_CHARS)
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = error instanceof Error ? error.message : "Vision analysis failed";
    await context.input.onActionError?.(actionHandle, {
      detail,
      resultSummary: message
    });
    throw new Error(`Vision analysis failed: ${message}`);
  }
}

export async function executeSearchWorkspace(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      memoryUserId?: string | null;
      conversationId?: string;
      abortSignal?: AbortSignal;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
    memoryUserId?: string | null;
  }
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const query = String(args.query ?? "").trim();
  const requestedLimit = Number(args.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.floor(requestedLimit))) : 8;
  const userId = context.input.memoryUserId ?? context.memoryUserId ?? null;

  if (!query) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: query is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: false };
  }
  if (!userId) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: workspace search is only available in owned conversations");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: false };
  }

  const detail = query.length > 140 ? `${query.slice(0, 137)}...` : query;
  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    serverId: "integration_search_workspace",
    toolName: "search_workspace",
    label: "Search workspace",
    detail,
    arguments: { query, limit }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const results = await searchWorkspace({
      userId,
      query,
      limit,
      memoryBotId: resolveMemoryScope(context.input.conversationId)?.botId ?? null
    });
    throwIfAborted(context.input.abortSignal);
    if (!results) {
      throw new Error("Semantic index is unavailable");
    }

    const resultSummary = results.length
      ? results
          .map((result, index) => {
            const ref =
              result.kind === "memory"
                ? `memory ${result.memoryId}`
                : `conversation ${result.conversationId}`;
            return `${index + 1}. [${result.kind}] ${result.title} (${result.date.slice(0, 10)}, ${ref}, score ${result.score})\n${result.snippet}`;
          })
          .join("\n\n")
      : "No matching content found in the workspace.";

    sortOrder += 1;
    await context.input.onActionComplete?.(actionHandle, { detail, resultSummary });
    const resultMsg = buildToolResultMessage(toolCallId, resultSummary);
    return {
      nextSortOrder: sortOrder,
      promptMessages: [...context.promptMessages, resultMsg],
      toolSucceeded: true
    };
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = error instanceof Error ? error.message : "Workspace search failed";
    await context.input.onActionError?.(actionHandle, { detail, resultSummary: message });
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return {
      nextSortOrder: sortOrder,
      promptMessages: [...context.promptMessages, resultMsg],
      toolSucceeded: false
    };
  }
}

export async function executeToolCall(
  toolCall: ProviderToolCall,
  context: {
    input: {
      settings?: RuntimeProviderProfile;
      visionProfile?: RuntimeProviderProfile;
      skills: Skill[];
      skillWriteOrigin?: SkillWriteOrigin;
      mcpToolSets: ToolSet[];
      memoryUserId?: string | null;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      appSettings?: RuntimeAppSettings;
      mcpTimeout?: number;
      conversationId?: string;
      assistantMessageId?: string;
      delegationChain?: DelegationChain;
      abortSignal?: AbortSignal;
      toolApproval?: ToolApprovalContext;
    };
    mcpServers: McpServer[];
    loadedSkillIds: Set<string>;
    successfulReadOnlyToolResults: Map<string, SuccessfulReadOnlyToolResult>;
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
    memoryUserId?: string | null;
  }
): Promise<{
  nextSortOrder: number;
  promptMessages: PromptMessage[];
  toolSucceeded?: boolean;
}> {
  const { id: toolCallId, name, arguments: argsJson } = toolCall;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    const resultMsg = buildToolResultMessage(toolCallId, `Error: Invalid JSON arguments for tool ${name}`);
    return { nextSortOrder: context.timelineSortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  if (name === "load_skill") {
    return executeLoadSkill(toolCallId, args, context);
  }

  if (name === "skill_manage") {
    return executeSkillManage(toolCallId, args, context);
  }

  if (name === "execute_shell_command") {
    return executeShellCommand(toolCallId, args, context);
  }

  if (name === "request_takeover") {
    return executeRequestTakeover(toolCallId, args, context);
  }

  if (name === "request_secret") {
    return executeRequestSecret(toolCallId, args, context);
  }

  if (name === "list_secrets") {
    return executeListSecrets(toolCallId, context);
  }

  if (name === "save_secret") {
    return executeSaveSecret(toolCallId, args, context);
  }

  if (name === "message_bot") {
    return executeMessageBot(toolCallId, args, context);
  }

  if (name === "check_bot") {
    return executeCheckBot(toolCallId, args, context);
  }

  if (name === "create_bot") {
    return executeCreateBotTool(toolCallId, args, context);
  }

  if (name === "update_bot") {
    return executeUpdateBotTool(toolCallId, args, context);
  }

  if (name === "update_own_instructions") {
    return executeUpdateOwnInstructionsTool(toolCallId, args, context);
  }

  if (name === "create_memory") {
    return executeCreateMemory(toolCallId, args, context);
  }

  if (name === "update_memory") {
    return executeUpdateMemory(toolCallId, args, context);
  }

  if (name === "delete_memory") {
    return executeDeleteMemory(toolCallId, args, context);
  }

  if (name === "create_automation") {
    return executeCreateAutomationProposal(toolCallId, args, context);
  }

  if (name === "draft_message") {
    return executeDraftMessage(toolCallId, args, context);
  }

  if (name === "web_search") {
    return executeWebSearch(toolCallId, args, context);
  }

  if (name === "read_page") {
    return executeReadPage(toolCallId, args, context);
  }

  if (name === "search_workspace") {
    return executeSearchWorkspace(toolCallId, args, context);
  }

  if (name === "generate_image") {
    return executeImageGeneration(toolCallId, args, context);
  }

  if (name === "analyze_image") {
    return executeAnalyzeImage(toolCallId, args, context);
  }

  if (name.startsWith("mcp_")) {
    return executeMcpToolCall(toolCallId, name, args, context);
  }

  const resultMsg = buildToolResultMessage(toolCallId, `Unknown tool: ${name}`);
  return { nextSortOrder: context.timelineSortOrder, promptMessages: [...context.promptMessages, resultMsg] };
}
