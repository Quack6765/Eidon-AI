import { resolveAbsoluteImagePathPart } from "@/lib/attachments";
import { streamProviderResponse } from "@/lib/provider";
import { getMemory as getMemoryRecord, getMemoryCount } from "@/lib/memories";
import {
  buildCreateMemoryProposal,
  buildDeleteMemoryProposal,
  buildUpdateMemoryProposal,
  normalizeMemoryCategory
} from "@/lib/memory-proposals";
import { getSettings } from "@/lib/settings";
import { executeLocalShellCommand, getShellCommandLabel, summarizeShellResult } from "@/lib/local-shell";
import { callMcpTool, getToolResultText } from "@/lib/mcp-client";
import { coerceEnumValues } from "@/lib/tool-schema-helpers";
import { getWebSearchPipeline } from "@/lib/web-search-catalog";
import {
  getPipelineUserContext,
  runWebSearchPipeline
} from "@/lib/web-search-pipeline";
import { throwIfChatTurnAborted as throwIfAborted } from "@/lib/chat-turn-control";
import { MAX_RUNTIME_TOOL_RESULT_CHARS, truncateText } from "@/lib/bounded-text";
import {
  prepareScreenshotArtifact,
  registerScreenshotArtifact,
  revokeScreenshotArtifact
} from "@/lib/screenshot-artifact-capabilities";
import { getLatestUserPromptContent } from "./prompt-analysis";
import { getSkillResolvedDescription, getSkillResolvedName } from "./skill-runtime";
import { type ToolSet, getToolLabel, buildArgumentsSummary, buildShellDetail } from "./tool-definitions";
import { executeMessageBot, executeCreateBotTool, executeUpdateBotTool } from "./bot-delegation";
import { getBotByConversationId } from "./bots";
import type { MemoryScope } from "@/lib/memories";
import { resolveBotSandbox } from "./bot-sandbox";
import type {
  McpServer,
  McpTool,
  MessageActionStatus,
  MemoryProposalPayload,
  MemoryProposalState,
  MessageActionKind,
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
  proposalPayload?: MemoryProposalPayload | null;
};

type SuccessfulReadOnlyToolResult = {
  promptResult: string;
};

export type { RuntimeAction, SuccessfulReadOnlyToolResult };

export function buildToolResultMessage(toolCallId: string, content: string): PromptMessage {
  return {
    role: "tool",
    toolCallId,
    content
  };
}

export function isMemoryProposalToolCall(name: string) {
  return name === "create_memory" || name === "update_memory" || name === "delete_memory";
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
      imageGenerationActionHandle?: string;
      hasVisibleImageGenerationAction?: boolean;
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

  if (!context.input.settings || !appSettings || !conversationId || !assistantMessageId) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: image generation is not configured");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: false };
  }

  try {
    const initialDetail = prompt || getLatestUserPromptContent(context.promptMessages) || "Generate image";
    if (context.input.hasVisibleImageGenerationAction) {
      actionHandle = context.input.imageGenerationActionHandle;
    } else {
      const handle = await context.input.onActionStart?.({
        kind: "image_generation",
        label: "Generate image",
        detail: initialDetail
      });
      actionHandle = typeof handle === "string" ? handle : undefined;
    }

    const { compileImageInstruction } = await import("@/lib/image-generation/compile-image-instruction");
    const { generateImages } = await import("@/lib/image-generation/provider");
    const { resolveEditInputImages } = await import("@/lib/image-generation/edit-inputs");
    const { createAttachments } = await import("@/lib/attachments");
    const { bindAttachmentsToMessage } = await import("@/lib/attachments");
    const instruction = await compileImageInstruction({
      settings: context.input.settings,
      promptMessages: context.promptMessages,
      abortSignal: context.input.abortSignal
    });
    throwIfAborted(context.input.abortSignal);

    const inputImages = instruction.mode === "edit"
      ? resolveEditInputImages(context.promptMessages, conversationId)
      : undefined;
    throwIfAborted(context.input.abortSignal);
    if (instruction.mode === "edit" && (!inputImages || !inputImages.length)) {
      throw new Error("No reference image was available to edit");
    }

    const backendResult = await generateImages({
      settings: appSettings,
      instruction,
      inputImages,
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
    const resultSummary = `${editedImageCount ? "Edited" : "Generated"} ${backendResult.images.length} image${backendResult.images.length === 1 ? "" : "s"}: ${attachments.map((a) => a.filename).join(", ")}`;

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

export async function executeMcpToolCall(
  toolCallId: string,
  functionName: string,
  args: Record<string, unknown>,
  context: {
    input: {
      mcpToolSets: ToolSet[];
      mcpTimeout?: number;
      abortSignal?: AbortSignal;
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
  const withoutPrefix = functionName.slice(4);
  const toolSets = context.input.mcpToolSets;
  let resolvedServer: McpServer | null = null;
  let resolvedTool: McpTool | null = null;

  const toolSetsBySpecificity = [...toolSets].sort(
    (left, right) => right.server.slug.length - left.server.slug.length
  );

  for (const { server, tools } of toolSetsBySpecificity) {
    if (withoutPrefix.startsWith(server.slug + "_")) {
      const toolName = withoutPrefix.slice(server.slug.length + 1);
      const tool = tools.find((t) => t.name === toolName);
      if (tool) {
        resolvedServer = server;
        resolvedTool = tool;
        break;
      }
    }
  }

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
  const resultText = getToolResultText(result);

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

  const skill = context.input.skills.find(
    (candidate) => getSkillResolvedName(candidate).toLowerCase() === skillName
  );

  if (!skill || context.loadedSkillIds.has(skill.id)) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      skill ? "This skill is already loaded." : `Skill "${skillName}" not found. Available: ${context.input.skills.map((s) => getSkillResolvedName(s)).join(", ")}`
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  throwIfAborted(context.input.abortSignal);
  const handle = await context.input.onActionStart?.({
    kind: "skill_load",
    label: "Load skill",
    detail: getSkillResolvedName(skill),
    skillId: skill.id
  });
  throwIfAborted(context.input.abortSignal);
  const actionHandle = typeof handle === "string" ? handle : undefined;

  context.loadedSkillIds.add(skill.id);
  try {
    await context.input.onActionComplete?.(actionHandle, {
      detail: getSkillResolvedName(skill),
      resultSummary: "Skill instructions loaded."
    });
    throwIfAborted(context.input.abortSignal);
  } catch (error) {
    context.loadedSkillIds.delete(skill.id);
    throw error;
  }

  sortOrder += 1;

  const skillContent = truncateText([
    `Skill loaded: ${getSkillResolvedName(skill)}`,
    `Description: ${getSkillResolvedDescription(skill)}`,
    "",
    skill.content
  ].join("\n"), MAX_RUNTIME_TOOL_RESULT_CHARS);

  const resultMsg = buildToolResultMessage(toolCallId, skillContent);
  return {
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, resultMsg]
  };
}

export async function executeShellCommand(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      conversationId?: string;
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
  const command = String(args.command ?? "").trim();
  const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : undefined;

  if (!command) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: Shell command is required.");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const handle = await context.input.onActionStart?.({
    kind: "shell_command",
    label: getShellCommandLabel(command),
    detail: buildShellDetail(command),
    arguments: { command, timeoutMs }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;
  const screenshotCandidate = prepareScreenshotArtifact(command);

  const bot = context.input.conversationId
    ? getBotByConversationId(context.input.conversationId)
    : null;
  const sandbox = bot ? resolveBotSandbox(bot) : null;

  try {
    const result = await executeLocalShellCommand({
      command,
      timeoutMs,
      abortSignal: context.input.abortSignal,
      ...(sandbox ? { cwd: sandbox.cwd, env: { ...process.env, ...sandbox.env } } : {})
    });
    throwIfAborted(context.input.abortSignal);
    const resultSummary = summarizeShellResult(result);
    const executionSucceeded = !result.isError && !result.timedOut && result.exitCode === 0;

    sortOrder += 1;

    if (!executionSucceeded) {
      await context.input.onActionError?.(actionHandle, { detail: buildShellDetail(command), resultSummary });
    } else {
      registerScreenshotArtifact(actionHandle, screenshotCandidate);
      try {
        await context.input.onActionComplete?.(actionHandle, {
          detail: buildShellDetail(command),
          resultSummary
        });
      } finally {
        revokeScreenshotArtifact(actionHandle);
      }
    }

    const resultText = buildShellResultForPrompt({
      command,
      resultSummary,
      isError: !executionSucceeded
    });
    const resultMsg = buildToolResultMessage(toolCallId, resultText);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  } catch (error) {
    throwIfAborted(context.input.abortSignal);
    const message = error instanceof Error ? error.message : "Shell command execution failed";
    await context.input.onActionError?.(actionHandle, { detail: buildShellDetail(command), resultSummary: message });
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }
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

export async function executeToolCall(
  toolCall: ProviderToolCall,
  context: {
    input: {
      settings?: RuntimeProviderProfile;
      visionProfile?: RuntimeProviderProfile;
      skills: Skill[];
      mcpToolSets: ToolSet[];
      memoryUserId?: string | null;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      imageGenerationActionHandle?: string;
      hasVisibleImageGenerationAction?: boolean;
      appSettings?: RuntimeAppSettings;
      mcpTimeout?: number;
      conversationId?: string;
      assistantMessageId?: string;
      abortSignal?: AbortSignal;
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

  if (name === "execute_shell_command") {
    return executeShellCommand(toolCallId, args, context);
  }

  if (name === "message_bot") {
    return executeMessageBot(toolCallId, args, context);
  }

  if (name === "create_bot") {
    return executeCreateBotTool(toolCallId, args, context);
  }

  if (name === "update_bot") {
    return executeUpdateBotTool(toolCallId, args, context);
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

  if (name === "web_search") {
    return executeWebSearch(toolCallId, args, context);
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
