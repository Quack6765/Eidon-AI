import { getMemory as getMemoryRecord, getMemoryCount } from "@/lib/memories";
import {
  buildCreateMemoryProposal,
  buildDeleteMemoryProposal,
  buildUpdateMemoryProposal,
  normalizeMemoryCategory
} from "@/lib/memory-proposals";
import { getSettings } from "@/lib/settings";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { executeLocalShellCommand, getShellCommandLabel, summarizeShellResult } from "@/lib/local-shell";
import { callMcpTool, getToolResultText } from "@/lib/mcp-client";
import { searchSearxng } from "@/lib/searxng";
import { coerceEnumValues } from "@/lib/tool-schema-helpers";
import { getWebSearchActionLabel } from "@/lib/web-search";
import { getSkillResolvedName, getSkillResolvedDescription, getLatestUserPromptContent } from "./prompt-analysis";
import { type ToolSet, mcpToolFunctionName, getToolLabel, buildArgumentsSummary, buildShellDetail } from "./tool-definitions";
import type {
  McpServer,
  McpTool,
  MessageActionStatus,
  MemoryProposalPayload,
  MemoryProposalState,
  MessageActionKind,
  ProviderProfileWithApiKey,
  ProviderToolCall,
  PromptMessage,
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

export async function executeSearxngWebSearch(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      searxngBaseUrl?: string | null;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  let sortOrder = context.timelineSortOrder;
  const query = String(args.query ?? "").trim();
  const maxResults =
    typeof args.max_results === "number" && Number.isFinite(args.max_results)
      ? Math.max(1, Math.min(10, Math.round(args.max_results)))
      : undefined;

  if (!context.input.searxngBaseUrl) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: SearXNG is not configured.");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  if (!query) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: query is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: getWebSearchActionLabel("builtin_web_search_searxng", "Web search"),
    detail: query,
    serverId: "builtin_web_search_searxng",
    toolName: "web_search",
    arguments: {
      query,
      ...(maxResults !== undefined ? { max_results: maxResults } : {})
    }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const resultSummary = await searchSearxng({
      baseUrl: context.input.searxngBaseUrl,
      query,
      maxResults
    });

    sortOrder += 1;
    await context.input.onActionComplete?.(actionHandle, {
      detail: query,
      resultSummary
    });

    const resultMsg = buildToolResultMessage(toolCallId, resultSummary);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SearXNG search failed";
    await context.input.onActionError?.(actionHandle, {
      detail: query,
      resultSummary: message
    });
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }
}

export async function executeImageGeneration(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      settings: ProviderProfileWithApiKey;
      appSettings?: import("@/lib/types").AppSettings;
      conversationId?: string;
      assistantMessageId?: string;
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
  let sortOrder = context.timelineSortOrder;
  const prompt = String(args.prompt ?? "").trim();
  let actionHandle: string | undefined;
  const appSettings = context.input.appSettings;
  const conversationId = context.input.conversationId;
  const assistantMessageId = context.input.assistantMessageId;

  if (!appSettings || !conversationId || !assistantMessageId) {
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
    const { generateGoogleNanoBananaImages } = await import("@/lib/image-generation/google-nano-banana");
    const { createAttachments } = await import("@/lib/attachments");
    const { assignAttachmentsToMessage } = await import("@/lib/attachments");
    const instruction = await compileImageInstruction({
      settings: context.input.settings,
      promptMessages: context.promptMessages
    });

    const backendResult = await generateGoogleNanoBananaImages({
      settings: appSettings,
      instruction
    });

    const attachments = createAttachments(
      conversationId,
      backendResult.images.map((img) => ({
        filename: img.filename,
        mimeType: img.mimeType,
        bytes: img.bytes
      }))
    );

    assignAttachmentsToMessage(
      conversationId,
      assistantMessageId,
      attachments.map((a) => a.id)
    );

    const resultSummary = `Generated ${backendResult.images.length} image${backendResult.images.length === 1 ? "" : "s"}: ${attachments.map((a) => a.filename).join(", ")}`;

    sortOrder += 1;
    await context.input.onActionComplete?.(actionHandle, {
      detail: instruction.imagePrompt || prompt,
      resultSummary
    });

    const resultMsg = buildToolResultMessage(
      toolCallId,
      `Successfully generated ${backendResult.images.length} image${backendResult.images.length === 1 ? "" : "s"}. ${resultSummary}`
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg], toolSucceeded: true };
  } catch (error) {
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
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    successfulReadOnlyToolResults: Map<string, SuccessfulReadOnlyToolResult>;
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
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
    label: getWebSearchActionLabel(resolvedServer.id, getToolLabel(resolvedTool)),
    detail: buildArgumentsSummary(correctedArgs),
    serverId: resolvedServer.id,
    toolName: resolvedTool.name,
    arguments: correctedArgs
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  const result = await callMcpTool(resolvedServer, resolvedTool.name, correctedArgs, context.input.mcpTimeout);
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
      skills: Skill[];
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    loadedSkillIds: Set<string>;
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  let sortOrder = context.timelineSortOrder;
  const skillName = String(args.skill_name ?? "").trim().toLowerCase();

  const skill = context.input.skills.find(
    (s) => (parseSkillContentMetadata(s.content).name?.trim() || s.name).toLowerCase() === skillName
  );

  if (!skill || context.loadedSkillIds.has(skill.id)) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      skill ? "This skill is already loaded." : `Skill "${skillName}" not found. Available: ${context.input.skills.map((s) => getSkillResolvedName(s)).join(", ")}`
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  context.loadedSkillIds.add(skill.id);

  const handle = await context.input.onActionStart?.({
    kind: "skill_load",
    label: "Load skill",
    detail: getSkillResolvedName(skill),
    skillId: skill.id
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  await context.input.onActionComplete?.(actionHandle, {
    detail: getSkillResolvedName(skill),
    resultSummary: "Skill instructions loaded."
  });

  sortOrder += 1;

  let skillContent = [
    `Skill loaded: ${getSkillResolvedName(skill)}`,
    `Description: ${getSkillResolvedDescription(skill)}`,
    "",
    skill.content
  ].join("\n");

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
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
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

  try {
    const result = await executeLocalShellCommand({
      command,
      timeoutMs
    });
    const resultSummary = summarizeShellResult(result);

    sortOrder += 1;

    if (result.isError) {
      await context.input.onActionError?.(actionHandle, { detail: buildShellDetail(command), resultSummary });
    } else {
      await context.input.onActionComplete?.(actionHandle, { detail: buildShellDetail(command), resultSummary });
    }

    const resultText = buildShellResultForPrompt({ command, resultSummary, isError: result.isError });
    const resultMsg = buildToolResultMessage(toolCallId, resultText);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shell command execution failed";
    await context.input.onActionError?.(actionHandle, { detail: buildShellDetail(command), resultSummary: message });
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }
}

export async function executeCreateMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    memoryUserId?: string;
    input: {
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const sortOrder = context.timelineSortOrder;
  const content = String(args.content ?? "").trim();

  if (!content) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: content is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const normalizedCategory = normalizeMemoryCategory(args.category);
  const proposalPayload = buildCreateMemoryProposal({ content, category: normalizedCategory });
  const maxCount = getSettings().memoriesMaxCount ?? 100;
  const currentCount = getMemoryCount(context.memoryUserId);

  if (currentCount >= maxCount) {
    const errorMsg = `Memory limit reached (${currentCount}/${maxCount}). Update or delete an existing memory instead.`;
    const resultMsg = buildToolResultMessage(toolCallId, errorMsg);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  await context.input.onActionStart?.({
    kind: "create_memory",
    status: "pending",
    label: "Create memory proposal",
    detail: content,
    arguments: { content, category: normalizedCategory },
    proposalState: "pending",
    proposalPayload
  });

  const resultMsg = buildToolResultMessage(
    toolCallId,
    `Memory change proposed for approval: create [${normalizedCategory}] ${content}`
  );
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

export async function executeUpdateMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    memoryUserId?: string;
    input: {
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const sortOrder = context.timelineSortOrder;
  const id = String(args.id ?? "").trim();
  const content = String(args.content ?? "").trim();
  const category = args.category ? String(args.category).trim() : undefined;

  if (!id || !content) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: id and content are required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const existing = getMemoryRecord(id, context.memoryUserId);
  if (!existing) {
    const resultMsg = buildToolResultMessage(toolCallId, `Error: Memory ${id} not found`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const proposalPayload = buildUpdateMemoryProposal({
    memory: existing,
    content,
    category
  });

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

  const resultMsg = buildToolResultMessage(
    toolCallId,
    `Memory change proposed for approval: update ${id} -> ${content} [${proposalPayload.proposedMemory?.category ?? existing.category}]`
  );
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

export async function executeDeleteMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    memoryUserId?: string;
    input: {
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const sortOrder = context.timelineSortOrder;
  const id = String(args.id ?? "").trim();

  if (!id) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: id is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const existing = getMemoryRecord(id, context.memoryUserId);
  if (!existing) {
    const resultMsg = buildToolResultMessage(toolCallId, `Error: Memory ${id} not found`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  await context.input.onActionStart?.({
    kind: "delete_memory",
    status: "pending",
    label: "Delete memory proposal",
    detail: existing.content,
    arguments: { id },
    proposalState: "pending",
    proposalPayload: buildDeleteMemoryProposal(existing)
  });

  const resultMsg = buildToolResultMessage(
    toolCallId,
    `Memory change proposed for approval: delete ${id}`
  );
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

export async function executeToolCall(
  toolCall: ProviderToolCall,
  context: {
    input: {
      settings: ProviderProfileWithApiKey;
      skills: Skill[];
      mcpToolSets: ToolSet[];
      searxngBaseUrl?: string | null;
      memoryUserId?: string;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      imageGenerationActionHandle?: string;
      hasVisibleImageGenerationAction?: boolean;
      appSettings?: import("@/lib/types").AppSettings;
      conversationId?: string;
      assistantMessageId?: string;
    };
    mcpServers: McpServer[];
    loadedSkillIds: Set<string>;
    successfulReadOnlyToolResults: Map<string, SuccessfulReadOnlyToolResult>;
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
    memoryUserId?: string;
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
    return executeSearxngWebSearch(toolCallId, args, context);
  }

  if (name === "generate_image") {
    return executeImageGeneration(toolCallId, args, context);
  }

  if (name.startsWith("mcp_")) {
    return executeMcpToolCall(toolCallId, name, args, context);
  }

  const resultMsg = buildToolResultMessage(toolCallId, `Unknown tool: ${name}`);
  return { nextSortOrder: context.timelineSortOrder, promptMessages: [...context.promptMessages, resultMsg] };
}
