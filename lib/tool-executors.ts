import {
  bindAttachmentsToMessage,
  createAttachments,
  getConversationAttachmentDir,
  resolveAbsoluteImagePathPart
} from "@/lib/attachments";
import { isProviderSafeImageMimeType, sniffImageMimeType } from "@/lib/image-normalization";
import { renameGeneratedImages } from "@/lib/image-generation/generated-filenames";
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
import {
  boundShellResultSummary,
  executeLocalShellCommand,
  getShellCommandLabel,
  resolveShellWorkspaceDir,
  resolveToolOutputDir,
  summarizeShellResult
} from "@/lib/local-shell";
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
  applySkillOperations,
  ensureLibraryReady,
  listLibrarySkills,
  parseSkillId
} from "./skill-library";
import { type SkillWriteOrigin } from "./skill-guards";
import { normalizeSkillOperation, SKILL_MANAGE_BATCH_MAX_OPS, type SkillOperation } from "./skill-operation";
import { type ToolSet, getToolLabel, buildArgumentsSummary, buildShellDetail } from "./tool-definitions";
import {
  type RuntimeAction,
  type SuccessfulReadOnlyToolResult,
  type ToolActionCallbacks,
  type ToolExecutionContext,
  type ToolExecutionResult,
  buildToolResultMessage,
  emitDeniedAction,
  resolveActionHandle,
  toolCallResult
} from "./tool-lifecycle";
import {
  classifyShellCommand,
  mcpToolApprovalFamily,
  requestToolExecutionApproval
} from "@/lib/tool-approvals";
import { buildToolApprovalPromptHeading } from "@/lib/tool-approval-display";
import { buildMessageDraftFields, supersedeMessageDraft } from "@/lib/message-drafts";
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
  McpToolCallResult,
  MessageDraftProposalPayload,
  PromptMessage,
  Skill,
  ToolApprovalContext,
  ToolApprovalProposalPayload,
  PromptImageContentPart
} from "@/lib/types";

export type { RuntimeAction, SuccessfulReadOnlyToolResult } from "./tool-lifecycle";

function buildShellResultForPrompt(input: { heading: string[]; resultSummary: string; isError: boolean }) {
  return [
    ...input.heading,
    `Status: ${input.isError ? "error" : "success"}`,
    "Result:",
    input.resultSummary
  ].join("\n");
}

export async function executeWebSearch(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
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
    return toolCallResult(context, toolCallId, "Error: Web search is not configured.", sortOrder);
  }

  if (!query && !queries.length) {
    return toolCallResult(context, toolCallId, "Error: query is required", sortOrder);
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
  const actionHandle = resolveActionHandle(handle);

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

    return toolCallResult(
      context,
      toolCallId,
      result.resultSummary,
      sortOrder,
      !result.resultSummary.startsWith("Error:")
    );
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = error instanceof Error ? error.message : "Web search failed";
    await context.input.onActionError?.(actionHandle, {
      detail,
      resultSummary: message
    });
    return toolCallResult(context, toolCallId, `Error: ${message}`, sortOrder, false);
  }
}

export async function executeReadPage(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const url = String(args.url ?? "").trim();
  const maxChars =
    typeof args.max_chars === "number" && Number.isFinite(args.max_chars) ? args.max_chars : undefined;

  if (!url) {
    return toolCallResult(context, toolCallId, "Error: url is required", sortOrder, false);
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
  const actionHandle = resolveActionHandle(handle);

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

    return toolCallResult(context, toolCallId, content, sortOrder, true);
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = error instanceof Error ? error.message : "Page could not be read";
    await context.input.onActionError?.(actionHandle, { detail, resultSummary: message });
    return toolCallResult(context, toolCallId, `Error: ${message}`, sortOrder, false);
  }
}

export async function executeImageGeneration(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
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
    return toolCallResult(context, toolCallId, "Error: image generation is not configured", sortOrder, false);
  }

  try {
    const initialDetail = prompt || requestText || "Generate image";
    const handle = await context.input.onActionStart?.({
      kind: "image_generation",
      label: "Generate image",
      detail: initialDetail
    });
    actionHandle = resolveActionHandle(handle);

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

    return toolCallResult(
      context,
      toolCallId,
      `Successfully ${editedImageCount ? "edited" : "generated"} ${backendResult.images.length} image${backendResult.images.length === 1 ? "" : "s"}. ${resultSummary}`,
      sortOrder,
      true
    );
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
    return toolCallResult(context, toolCallId, `Error: ${message}`, sortOrder, false);
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

async function attachMcpResultImages(
  result: McpToolCallResult,
  conversationId: string | undefined,
  assistantMessageId: string | undefined
): Promise<McpToolCallResult> {
  if (!conversationId || !assistantMessageId) {
    return result;
  }

  const content: McpToolCallResult["content"] = [];
  for (const item of result.content) {
    const bytes = item.type === "image" && item.data ? Buffer.from(item.data, "base64") : null;
    const mimeType = bytes && sniffImageMimeType(bytes);
    if (!bytes || !mimeType || !isProviderSafeImageMimeType(mimeType)) {
      content.push(item);
      continue;
    }

    const [attachment] = await createAttachments(
      conversationId,
      renameGeneratedImages([{ bytes, mimeType, filename: "" }])
    );
    bindAttachmentsToMessage(conversationId, assistantMessageId, [attachment.id]);
    content.push({
      type: "text",
      text: `[image attached to your reply as ${attachment.filename}; the user already sees it, so do not embed or link it]`
    });
  }

  return { ...result, content };
}

export async function executeMcpToolCall(
  toolCallId: string,
  functionName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const { server: resolvedServer, tool: resolvedTool } =
    resolveMcpToolFunction(functionName, context.input.mcpToolSets ?? []) ?? {};

  if (!resolvedServer || !resolvedTool) {
    return toolCallResult(context, toolCallId, "The requested MCP tool does not exist.", sortOrder);
  }

  const successfulReadOnlyToolKey = `${resolvedServer.id}:${resolvedTool.name}`;
  const repeatedReadOnlyToolResult =
    resolvedTool.annotations?.readOnlyHint === true
      ? context.successfulReadOnlyToolResults?.get(successfulReadOnlyToolKey)
      : undefined;

  if (repeatedReadOnlyToolResult) {
    return toolCallResult(
      context,
      toolCallId,
      [
        "Repeated read-only tool call suppressed.",
        "Reuse the previous successful result already available for this tool.",
        "",
        repeatedReadOnlyToolResult.promptResult
      ].join("\n"),
      sortOrder
    );
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
      await emitDeniedAction(
        context.input,
        {
          kind: "mcp_tool_call",
          label: getToolLabel(resolvedTool),
          detail: buildArgumentsSummary(correctedArgs),
          serverId: resolvedServer.id,
          toolName: resolvedTool.name,
          arguments: correctedArgs
        },
        { detail: buildArgumentsSummary(correctedArgs), resultSummary: approval.message }
      );
    }
    return toolCallResult(context, toolCallId, approval.message, sortOrder);
  }

  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: getToolLabel(resolvedTool),
    detail: buildArgumentsSummary(correctedArgs),
    serverId: resolvedServer.id,
    toolName: resolvedTool.name,
    arguments: correctedArgs
  });
  const actionHandle = resolveActionHandle(handle);

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
  const resultText = redactSecrets(
    context.input.conversationId,
    getToolResultText(
      await attachMcpResultImages(result, context.input.conversationId, context.input.assistantMessageId)
    )
  );

  sortOrder += 1;

  if (result.isError) {
    await context.input.onActionError?.(actionHandle, { detail: buildArgumentsSummary(correctedArgs), resultSummary: resultText });
  } else {
    await context.input.onActionComplete?.(actionHandle, { detail: buildArgumentsSummary(correctedArgs), resultSummary: resultText });
  }

  if (!result.isError && resolvedTool.annotations?.readOnlyHint === true) {
    context.successfulReadOnlyToolResults?.set(successfulReadOnlyToolKey, {
      promptResult: resultText
    });
  }

  return toolCallResult(context, toolCallId, resultText, sortOrder);
}

export async function executeLoadSkill(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const skillName = String(args.skill_name ?? "").trim().toLowerCase();
  const loadedSkillIds = context.loadedSkillIds ?? new Set<string>();

  let skill = context.input.skills?.find(
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

  if (!skill || loadedSkillIds.has(skill.id)) {
    const availableNames = [
      ...new Set(
        [...(context.input.skills ?? []), ...workspaceSkills]
          .map((s) => getSkillResolvedName(s))
          .filter(Boolean)
      )
    ].join(", ");
    return toolCallResult(
      context,
      toolCallId,
      skill ? "This skill is already loaded." : `Skill "${skillName}" not found. Available: ${availableNames}`,
      sortOrder
    );
  }

  const skillContent = await loadSkillIntoTurn(skill, context.input, loadedSkillIds);
  sortOrder += 1;

  return toolCallResult(context, toolCallId, skillContent, sortOrder);
}

export async function loadSkillIntoTurn(
  skill: Skill,
  input: ToolActionCallbacks & {
    abortSignal?: AbortSignal;
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
    await input.onActionComplete?.(resolveActionHandle(handle), {
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
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const errorResult = (message: string) =>
    toolCallResult(context, toolCallId, `Error: ${message}`, sortOrder + 1, false);

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
    [...(context.loadedSkillIds ?? new Set<string>())].map((id) => parseSkillId(id)).filter((ref): ref is string => Boolean(ref))
  );

  const outcome = applySkillOperations(ownerUserId, {
    operations: operations as SkillOperation[],
    origin,
    loadedRefs
  });

  if ("error" in outcome) {
    const handle = await context.input.onActionStart?.({
      kind: "skill_manage",
      label: "Skill manage",
      detail: outcome.error.split("\n")[0]
    });
    await context.input.onActionError?.(resolveActionHandle(handle), {
      resultSummary: outcome.error
    });
    return errorResult(outcome.error);
  }

  throwIfAborted(context.input.abortSignal);
  const detail = outcome.results[0]?.split("\n")[0] ?? "skill_manage";
  const handle = await context.input.onActionStart?.({
    kind: "skill_manage",
    label: "Update skills",
    detail,
    toolName: "skill_manage"
  });
  const actionHandle = resolveActionHandle(handle);
  await context.input.onActionComplete?.(actionHandle, {
    detail,
    resultSummary: outcome.results.join(" ")
  });

  const refreshed = listLibrarySkills(ownerUserId).find((skill) =>
    outcome.results.some((line) => line.includes(`'${skill.name}'`) || line.includes(`'${skill.id}'`))
  );
  const turnSkills = context.input.skills;
  if (turnSkills && refreshed) {
    const existingIndex = turnSkills.findIndex((skill) => skill.id === refreshed.id);
    if (existingIndex >= 0) {
      turnSkills[existingIndex] = refreshed;
    } else {
      turnSkills.push(refreshed);
    }
  }

  return toolCallResult(context, toolCallId, outcome.results.join("\n"), sortOrder + 1, true);
}

type ShellToolRequest = {
  command: string;
  stdin?: string;
  timeoutMs?: number;
  vaultEnv: { resolved: Array<{ entry: VaultEntry; variable: string }> };
  approval: Pick<ToolApprovalProposalPayload, "families" | "classified" | "command"> & { invocation?: string };
  action: { label: string; detail: string; toolName?: string; arguments: Record<string, unknown> };
  resultHeading: string[];
};

function toolErrorResult(toolCallId: string, context: ToolExecutionContext, message: string) {
  return toolCallResult(context, toolCallId, message, context.timelineSortOrder);
}

function listResolvedSecrets(vaultEnv: ShellToolRequest["vaultEnv"]) {
  return vaultEnv.resolved.map(({ entry, variable }) => ({ name: entry.name, variable }));
}

export async function executeShellCommand(toolCallId: string, args: Record<string, unknown>, context: ToolExecutionContext) {
  throwIfAborted(context.input.abortSignal);
  const command = String(args.command ?? "").trim();
  const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : undefined;

  if (!command) {
    return toolErrorResult(toolCallId, context, "Error: Shell command is required.");
  }

  const vaultEnv = resolveShellSecrets(context.input, args.secrets);
  if ("error" in vaultEnv) {
    return toolErrorResult(toolCallId, context, `Error: ${vaultEnv.error}`);
  }
  const secrets = listResolvedSecrets(vaultEnv);

  if (
    getShellCommandLabel(command) === "Web browser" &&
    getComputerControl(conversationBrowserTarget(context.input.conversationId)) === "user"
  ) {
    return toolErrorResult(
      toolCallId,
      context,
      "Error: The user has control of the browser right now. Wait until they return it, then try again. Use request_takeover if you need them to do a step for you."
    );
  }

  const classification = classifyShellCommand(command);
  return runShellTool(toolCallId, context, {
    command,
    timeoutMs,
    vaultEnv,
    approval: { families: classification.families, classified: classification.classified, command },
    action: {
      label: getShellCommandLabel(command),
      detail: buildShellDetail(command),
      arguments: { command, timeoutMs, ...(secrets.length ? { secrets } : {}) }
    },
    resultHeading: ["Local shell command result", `Command: ${command}`]
  });
}

const PYTHON_PACKAGE_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\[[A-Za-z0-9._,-]+\])?(?:(?:==|!=|<=|>=|~=|<|>)[A-Za-z0-9.*+!_-]+(?:,(?:==|!=|<=|>=|~=|<|>)[A-Za-z0-9.*+!_-]+)*)?$/;
const MAX_PYTHON_PACKAGES = 10;

function parsePythonPackages(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_PYTHON_PACKAGES) return null;
  const packages = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  return packages.every((item) => PYTHON_PACKAGE_PATTERN.test(item)) ? packages : null;
}

export async function executePythonCode(toolCallId: string, args: Record<string, unknown>, context: ToolExecutionContext) {
  throwIfAborted(context.input.abortSignal);
  const code = typeof args.code === "string" ? args.code : "";
  const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : undefined;

  if (!code.trim()) {
    return toolErrorResult(toolCallId, context, "Error: Python code is required.");
  }

  const packages = parsePythonPackages(args.packages);
  if (!packages) {
    return toolErrorResult(
      toolCallId,
      context,
      `Error: packages must be a list of at most ${MAX_PYTHON_PACKAGES} PyPI requirements such as "pandas" or "numpy>=2".`
    );
  }

  const vaultEnv = resolveShellSecrets(context.input, args.secrets);
  if ("error" in vaultEnv) {
    return toolErrorResult(toolCallId, context, `Error: ${vaultEnv.error}`);
  }
  const secrets = listResolvedSecrets(vaultEnv);

  const command = packages.length
    ? `uv run --quiet --no-project ${packages.map((pkg) => `--with '${pkg}'`).join(" ")} python3 -u -`
    : "python3 -u -";
  return runShellTool(toolCallId, context, {
    command,
    stdin: code,
    timeoutMs,
    vaultEnv,
    approval: {
      families: ["python3"],
      classified: true,
      command: packages.length ? `# packages: ${packages.join(", ")}\n${code}` : code,
      invocation: "python3"
    },
    action: {
      label: "Python",
      detail: buildShellDetail(code.replace(/\s+/g, " ").trim()),
      toolName: "run_python",
      arguments: { code, ...(packages.length ? { packages } : {}), timeoutMs, ...(secrets.length ? { secrets } : {}) }
    },
    resultHeading: ["Python result"]
  });
}

async function runShellTool(toolCallId: string, context: ToolExecutionContext, request: ShellToolRequest) {
  let sortOrder = context.timelineSortOrder;
  const { command, action } = request;
  const secrets = listResolvedSecrets(request.vaultEnv);
  const approvalPayload: ToolApprovalProposalPayload = {
    operation: "tool_approval",
    scope: "shell",
    families: request.approval.families,
    classified: request.approval.classified,
    command: request.approval.command,
    ...(secrets.length ? { arguments: { secrets } } : {})
  };
  const approval = await requestToolExecutionApproval({
    payload: approvalPayload,
    label: buildToolApprovalPromptHeading(approvalPayload),
    detail: action.detail,
    userId: context.input.toolApproval?.userId ?? null,
    unattended: context.input.toolApproval?.unattended ?? true,
    timeoutMs: context.input.toolApproval?.timeoutMs,
    onWaitChange: context.input.toolApproval?.onWaitChange,
    abortSignal: context.input.abortSignal,
    onActionStart: context.input.onActionStart,
    invocation: request.approval.invocation
  });

  const runtimeAction: RuntimeAction = {
    kind: "shell_command",
    label: action.label,
    detail: action.detail,
    ...(action.toolName ? { toolName: action.toolName } : {}),
    arguments: action.arguments
  };

  if (!approval.approved) {
    if (!approval.promptActionId) {
      await emitDeniedAction(context.input, runtimeAction, { detail: action.detail, resultSummary: approval.message });
    }
    return toolErrorResult(toolCallId, context, approval.message);
  }

  const handle = await context.input.onActionStart?.(runtimeAction);
  const actionHandle = resolveActionHandle(handle);
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
    const botShell = sandbox ? await botShellSandbox(sandbox, browserTarget, context.input.conversationId) : null;
    throwIfAborted(context.input.abortSignal);
    if (usesBrowser) setComputerCaption(browserTarget, action.detail);
    const secretEnv = readShellSecrets(request.vaultEnv, context.input);
    const shellResult = await executeLocalShellCommand({
      command,
      stdin: request.stdin,
      timeoutMs: request.timeoutMs,
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
    let resultSummary = boundShellResultSummary(summarizeShellResult(result), {
      conversationId: context.input.conversationId,
      captureTruncated: result.captureTruncated
    });
    const executionSucceeded = !result.isError && !result.timedOut && result.exitCode === 0;
    let screenshot: AttachedScreenshot | null = null;

    sortOrder += 1;

    if (!executionSucceeded) {
      await context.input.onActionError?.(actionHandle, { detail: action.detail, resultSummary });
    } else {
      const { conversationId, assistantMessageId } = context.input;
      if (screenshotCandidate && conversationId && assistantMessageId) {
        screenshot = await attachScreenshot({ candidate: screenshotCandidate, conversationId, assistantMessageId });
      }
      if (screenshot) {
        resultSummary = `${resultSummary}\n\n${screenshot.note}`;
      }
      await context.input.onActionComplete?.(actionHandle, {
        detail: action.detail,
        resultSummary
      });
    }

    const resultText = buildShellResultForPrompt({
      heading: request.resultHeading,
      resultSummary,
      isError: !executionSucceeded
    });
    return toolCallResult(
      context,
      toolCallId,
      screenshot?.image ? [{ type: "text", text: resultText }, screenshot.image] : resultText,
      sortOrder
    );
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = redactSecrets(
      context.input.conversationId,
      error instanceof Error ? error.message : "Shell command execution failed"
    );
    await context.input.onActionError?.(actionHandle, { detail: action.detail, resultSummary: message });
    return toolCallResult(context, toolCallId, `Error: ${message}`, sortOrder);
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

export async function executeListSecrets(toolCallId: string, context: ToolExecutionContext) {
  const owner = vaultOwner(context.input);
  if (!owner) {
    return toolCallResult(context, toolCallId, `Error: ${VAULT_UNAVAILABLE}`, context.timelineSortOrder);
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
  await context.input.onActionComplete?.(resolveActionHandle(handle), { resultSummary: summary });
  const resultText = entries.length
    ? `The user's vault (values are never shown):\n${entries.map(describeVaultEntry).join("\n")}`
    : "The user's vault is empty.";
  return toolCallResult(context, toolCallId, resultText, context.timelineSortOrder + 1);
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export async function executeSaveSecret(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  const owner = vaultOwner(context.input);
  const name = optionalString(args.name)?.trim() ?? "";
  const secret = optionalString(args.secret) || undefined;
  if (secret && owner) rememberSecretForRedaction(owner.conversationId, secret);
  const fail = (message: string) =>
    toolCallResult(context, toolCallId, `Error: ${message}`, context.timelineSortOrder);
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
  const actionHandle = resolveActionHandle(handle);
  const result = saveVaultSecretForAgent(owner.userId, { ...input, secret });
  if ("error" in result) {
    await context.input.onActionError?.(actionHandle, { detail: name, resultSummary: result.error });
    return toolCallResult(
      context,
      toolCallId,
      `Error: ${result.error}`,
      context.timelineSortOrder + 1
    );
  }
  const verb = result.created ? "Saved" : "Updated";
  await context.input.onActionComplete?.(actionHandle, { detail: result.entry.name, resultSummary: `${verb} in your vault` });
  return toolCallResult(
    context,
    toolCallId,
    `${verb} "${result.entry.name}" in the user's vault${result.entry.origin ? ` for ${result.entry.origin}` : ""}. Refer to it by that name; never repeat the value.`,
    context.timelineSortOrder + 1
  );
}

async function botShellSandbox(sandbox: BotSandbox, browserTarget: BrowserSessionTarget, conversationId?: string) {
  const proxyPort = await ensureEgressProxy();
  const conversationDirs = conversationId
    ? [getConversationAttachmentDir(conversationId), resolveToolOutputDir(conversationId, false)]
    : [];
  return {
    env: { HOME: sandbox.homeDir, ...egressProxyEnv(proxyPort) },
    rules: {
      readWrite: [sandbox.workspaceDir, sandbox.sharedDir, sandbox.homeDir, browserTarget.socketDir, ...sandboxScratchDirs()],
      readOnly: conversationDirs.filter((dir): dir is string => Boolean(dir)),
      connectPorts: resolveBrowserExecutable() ? [proxyPort] : undefined
    }
  };
}

export async function executeRequestTakeover(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
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
  return toolCallResult(context, toolCallId, resultText, context.timelineSortOrder + 1);
}

export async function executeRequestSecret(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
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
  return toolCallResult(context, toolCallId, resultText, context.timelineSortOrder + 1);
}

function resolveMemoryScope(conversationId?: string): MemoryScope | undefined {
  if (!conversationId) return undefined;
  const bot = getBotByConversationId(conversationId);
  return bot ? { botId: bot.id } : undefined;
}

export async function executeCreateMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const content = String(args.content ?? "").trim();

  if (!content) {
    return toolCallResult(context, toolCallId, "Error: content is required", sortOrder);
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
    return toolCallResult(context, toolCallId, errorMsg, sortOrder);
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

  return toolCallResult(
    context,
    toolCallId,
    `Memory change proposed for approval: create [${normalizedCategory}] ${content}`,
    sortOrder + 1
  );
}

export async function executeUpdateMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const id = String(args.id ?? "").trim();
  const content = String(args.content ?? "").trim();
  const category = args.category ? String(args.category).trim() : undefined;

  if (!id || !content) {
    return toolCallResult(context, toolCallId, "Error: id and content are required", sortOrder);
  }

  const memoryScope = resolveMemoryScope(context.input.conversationId);
  const existing = getMemoryRecord(id, context.memoryUserId, memoryScope);
  throwIfAborted(context.input.abortSignal);
  if (!existing) {
    const notFoundMsg = memoryScope
      ? `Error: Memory ${id} not found in your bot memory pool. Main account memories are read-only for bots; if this fact lives there, save an updated copy to your own memory instead.`
      : `Error: Memory ${id} not found`;
    return toolCallResult(context, toolCallId, notFoundMsg, sortOrder);
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

  return toolCallResult(
    context,
    toolCallId,
    `Memory change proposed for approval: update ${id} -> ${content} [${proposalPayload.proposedMemory?.category ?? existing.category}]`,
    sortOrder + 1
  );
}

export async function executeDeleteMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const id = String(args.id ?? "").trim();

  if (!id) {
    return toolCallResult(context, toolCallId, "Error: id is required", sortOrder);
  }

  const memoryScope = resolveMemoryScope(context.input.conversationId);
  const existing = getMemoryRecord(id, context.memoryUserId, memoryScope);
  throwIfAborted(context.input.abortSignal);
  if (!existing) {
    const notFoundMsg = memoryScope
      ? `Error: Memory ${id} not found in your bot memory pool. Main account memories are read-only for bots.`
      : `Error: Memory ${id} not found`;
    return toolCallResult(context, toolCallId, notFoundMsg, sortOrder);
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

  return toolCallResult(
    context,
    toolCallId,
    `Memory change proposed for approval: delete ${id}`,
    sortOrder + 1
  );
}

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
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const name = String(args.name ?? "").trim().slice(0, 100);
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const continuePreviousConversation = args.continue_previous_conversation === true;

  if (!name) {
    return toolCallResult(context, toolCallId, "Error: name is required", sortOrder);
  }

  if (!prompt) {
    return toolCallResult(context, toolCallId, "Error: prompt is required", sortOrder);
  }

  const schedule = parseAutomationScheduleArgs(args);

  try {
    assertValidSchedule(schedule);
    assertFutureRunAt(schedule.scheduleKind, schedule.runAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid automation schedule";
    return toolCallResult(context, toolCallId, `Error: ${message}`, sortOrder);
  }

  const providerProfileId = context.input.settings?.id ?? "";
  if (!providerProfileId) {
    return toolCallResult(
      context,
      toolCallId,
      "Error: no provider profile is configured for this conversation",
      sortOrder
    );
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

  return toolCallResult(
    context,
    toolCallId,
    `Automation proposal created and awaiting user approval: "${name}" (${scheduleSummary}). Nothing is scheduled until the user approves it on the proposal card.${onceNote} Tell the user you have proposed the automation and that they can review and approve it.`,
    sortOrder + 1
  );
}

export async function executeDraftMessage(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  const sortOrder = context.timelineSortOrder;
  const fail = (message: string) =>
    toolCallResult(context, toolCallId, `Error: ${message}`, sortOrder);
  const functionName = typeof args.tool === "string" ? args.tool.trim() : "";
  const rawArguments = args.arguments;

  if (!functionName) {
    return fail("tool is required: pass the exact name of the connected tool that sends the message");
  }

  if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
    return fail("arguments must be an object with the arguments for the sending tool");
  }

  const resolved = resolveMcpToolFunction(functionName, context.input.mcpToolSets ?? []);
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

  return toolCallResult(
    context,
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
      .join(" "),
    sortOrder + 1
  );
}

const VISION_ANALYSIS_SYSTEM_PROMPT =
  "You are a vision analysis sub-agent. Describe what is visible in the provided images precisely and answer the question about the images. Be thorough but concise. Never invent details that are not visible in the images.";

export async function executeAnalyzeImage(
  toolCallId: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;

  const rawPaths = args.file_paths;
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
    return toolCallResult(
      context,
      toolCallId,
      "Error: file_paths must be a non-empty array of absolute image paths",
      sortOrder
    );
  }
  if (rawPaths.length > 10) {
    return toolCallResult(
      context,
      toolCallId,
      "Error: file_paths accepts at most 10 image paths",
      sortOrder
    );
  }

  const conversationId = context.input.conversationId;
  if (!conversationId) {
    return toolCallResult(
      context,
      toolCallId,
      "Error: conversation context is required for image analysis",
      sortOrder
    );
  }

  const question = typeof args.question === "string" ? args.question.trim() : "";

  let imageParts: PromptImageContentPart[];
  try {
    imageParts = rawPaths.map((filePath) =>
      resolveAbsoluteImagePathPart(String(filePath), { conversationId })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid image path";
    return toolCallResult(context, toolCallId, `Error: ${message}`, sortOrder);
  }

  if (!context.input.visionProfile) {
    return toolCallResult(
      context,
      toolCallId,
      "Error: vision analysis is not configured for this conversation",
      sortOrder
    );
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
  const actionHandle = resolveActionHandle(handle);

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

    return toolCallResult(
      context,
      toolCallId,
      truncateText(answer, MAX_RUNTIME_TOOL_RESULT_CHARS),
      sortOrder
    );
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
  context: ToolExecutionContext
) {
  throwIfAborted(context.input.abortSignal);
  let sortOrder = context.timelineSortOrder;
  const query = String(args.query ?? "").trim();
  const requestedLimit = Number(args.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.floor(requestedLimit))) : 8;
  const userId = context.input.memoryUserId ?? context.memoryUserId ?? null;

  if (!query) {
    return toolCallResult(context, toolCallId, "Error: query is required", sortOrder, false);
  }
  if (!userId) {
    return toolCallResult(
      context,
      toolCallId,
      "Error: workspace search is only available in owned conversations",
      sortOrder,
      false
    );
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
  const actionHandle = resolveActionHandle(handle);

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
    return toolCallResult(context, toolCallId, resultSummary, sortOrder, true);
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = error instanceof Error ? error.message : "Workspace search failed";
    await context.input.onActionError?.(actionHandle, { detail, resultSummary: message });
    return toolCallResult(context, toolCallId, `Error: ${message}`, sortOrder, false);
  }
}
