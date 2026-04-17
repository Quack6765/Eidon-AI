import { resolveAttachmentPath } from "@/lib/attachments";
import { ChatTurnStoppedError } from "@/lib/chat-turn-control";
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
import { extractEnumHints, coerceEnumValues } from "@/lib/tool-schema-helpers";
import { streamProviderResponse } from "@/lib/provider";
import { getWebSearchActionLabel } from "@/lib/web-search";
import { MAX_ASSISTANT_CONTROL_STEPS } from "@/lib/constants";
import type {
  ChatStreamEvent,
  McpServer,
  McpTool,
  MessageActionStatus,
  MemoryProposalPayload,
  MemoryProposalState,
  MessageActionKind,
  ProviderProfileWithApiKey,
  ProviderToolCall,
  PromptMessage,
  Skill,
  ToolDefinition
} from "@/lib/types";

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};

type ToolSet = {
  server: McpServer;
  tools: McpTool[];
};

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

const SHELL_SKILL_INTENT_PATTERN =
  /\b(browser|website|web site|webpage|web page|url|link|click|navigate|navigation|screenshot|snapshot|inspect|form|login|dom)\b/i;
const URLISH_PATTERN = /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})(?:\/\S*)?/i;
const MEMORY_INTENT_WITHOUT_TOOL_PATTERN =
  /\b(?:let me|i(?:'ll| will| can| should|(?: am|'m) going to))\s+(?:save|remember|store|update|delete|remove)\b|\b(?:remember|save|store|update|delete|remove)\s+(?:that|this|it)\s+(?:for later|in memory|as memory)\b|\b(?:i(?:'ve| have)|we(?:'ve| have))\s+proposed\s+to\s+(?:add|save|store|update|delete|remove)\b.*\bmemory\b|\bit(?:'ll| will)\s+be\s+saved\s+once\s+you\s+approve\s+it\b/i;

function mcpToolFunctionName(serverSlug: string, toolName: string) {
  return `mcp_${serverSlug}_${toolName}`;
}

function getSkillResolvedName(skill: Skill) {
  return parseSkillContentMetadata(skill.content).name?.trim() || skill.name;
}

function getSkillResolvedDescription(skill: Skill) {
  return parseSkillContentMetadata(skill.content).description?.trim() || skill.description;
}

function getSkillAllowedCommandPrefixes(skill: Skill) {
  return parseSkillContentMetadata(skill.content).shellCommandPrefixes;
}

function getLatestUserPromptContent(promptMessages: PromptMessage[]) {
  for (let index = promptMessages.length - 1; index >= 0; index -= 1) {
    const message = promptMessages[index];

    if (message.role === "user" && typeof message.content === "string") {
      return message.content.trim();
    }
  }

  return "";
}

function filterSkillsForTurn(skills: Skill[], promptMessages: PromptMessage[]) {
  const latestUserContent = getLatestUserPromptContent(promptMessages).toLowerCase();

  return skills.filter((skill) => {
    const shellPrefixes = getSkillAllowedCommandPrefixes(skill);

    if (!shellPrefixes.length) {
      return true;
    }

    const resolvedName = getSkillResolvedName(skill).toLowerCase();
    const resolvedDescription = getSkillResolvedDescription(skill).toLowerCase();

    if (latestUserContent.includes(resolvedName)) {
      return true;
    }

    if (URLISH_PATTERN.test(latestUserContent) || SHELL_SKILL_INTENT_PATTERN.test(latestUserContent)) {
      return resolvedName.includes("browser") || resolvedDescription.includes("browser");
    }

    return false;
  });
}

function getToolLabel(tool: McpTool) {
  return tool.title ?? tool.annotations?.title ?? tool.name;
}

function addUsage(total: Usage, next: Usage) {
  return {
    inputTokens: (total.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (next.outputTokens ?? 0),
    reasoningTokens: (total.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0)
  };
}

function buildArgumentsSummary(args: Record<string, unknown> | null | undefined) {
  if (!args || !Object.keys(args).length) return "";
  const firstScalar = Object.entries(args).find(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
  if (firstScalar) return `${firstScalar[0]}=${String(firstScalar[1])}`;
  const json = JSON.stringify(args);
  return json.length > 120 ? `${json.slice(0, 117)}...` : json;
}

function buildShellDetail(command: string) {
  return command.length > 140 ? `${command.slice(0, 137)}...` : command;
}

function buildToolDefinitions(input: {
  mcpToolSets: ToolSet[];
  skills: Skill[];
  loadedSkillIds: Set<string>;
  memoriesEnabled: boolean;
  searxngBaseUrl?: string | null;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  for (const { server, tools: mcpTools } of input.mcpToolSets) {
    for (const tool of mcpTools) {
      const enumHints = extractEnumHints(tool.inputSchema ?? {});
      tools.push({
        type: "function",
        function: {
          name: mcpToolFunctionName(server.slug, tool.name),
          description: [
            tool.annotations?.title ?? tool.name,
            tool.description,
            enumHints || undefined,
            tool.annotations?.readOnlyHint ? "(read-only)" : undefined
          ].filter(Boolean).join(" — "),
          parameters: (tool.inputSchema as ToolDefinition["function"]["parameters"]) ?? { type: "object", properties: {} }
        }
      });
    }
  }

  if (input.skills.length) {
    tools.push({
      type: "function",
      function: {
        name: "load_skill",
        description: `Load the full content and instructions of a skill. Available: ${input.skills.map((s) => getSkillResolvedName(s)).join(", ")}`,
        parameters: {
          type: "object",
          properties: {
            skill_name: { type: "string", description: "Name of the skill to load" }
          },
          required: ["skill_name"]
        }
      }
    });
  }

  tools.push({
    type: "function",
    function: {
      name: "execute_shell_command",
      description: "Execute a local shell command on the host environment.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute" },
          timeout_ms: { type: "number", description: "Timeout in milliseconds (default 30000)" }
        },
        required: ["command"]
      }
    }
  });

  if (input.searxngBaseUrl) {
    tools.push({
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web using the configured SearXNG instance.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            max_results: {
              type: "number",
              description: "Maximum number of results to return (default 5, max 10)"
            }
          },
          required: ["query"]
        }
      }
    });
  }

  if (input.memoriesEnabled) {
    tools.push(
      {
        type: "function",
        function: {
          name: "create_memory",
          description: "Save a durable fact about the user for future conversations. Use conservatively — only for facts likely to recur (name, location, preferences, work details). Do not save transient task details.",
          parameters: {
            type: "object",
            properties: {
              content: { type: "string", description: "The fact to remember" },
              category: { type: "string", description: "One of: personal, preference, work, location, other" }
            },
            required: ["content", "category"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_memory",
          description: "Update an existing memory when a fact has changed.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "The memory ID to update" },
              content: { type: "string", description: "The updated fact" },
              category: { type: "string", description: "New category (optional)" }
            },
            required: ["id", "content"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "delete_memory",
          description: "Delete a stored memory that is no longer relevant or accurate.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "The memory ID to delete" }
            },
            required: ["id"]
          }
        }
      }
    );
  }

  return tools;
}

function buildCapabilitiesSystemMessage(skills: Skill[], mcpServers: McpServer[]) {
  const lines: string[] = [];

  if (skills.length) {
    lines.push("Available skills (metadata only — call load_skill to get full instructions):");
    for (const skill of skills) {
      lines.push(`- ${getSkillResolvedName(skill)}: ${getSkillResolvedDescription(skill)}`);
    }
  }

  if (mcpServers.length) {
    lines.push("", "Configured MCP servers:");
    for (const server of mcpServers) {
      lines.push(`- ${server.name}`);
    }
  }

  lines.push("", "Use available tools proactively when they would improve your answer.");
  lines.push("Do not call the same read-only tool repeatedly once you already have a successful result for it in the current turn.");
  lines.push("If a tool call fails because of invalid arguments, correct the arguments and retry at most once.");

  return lines.join("\n");
}

function buildVisionMcpDirective(
  mcpServer: McpServer,
  attachments: Array<{ id: string; filename: string; absolutePath: string }>
): string {
  const attachmentList = attachments
    .map((a) => `- ${a.filename} (path: ${a.absolutePath})`)
    .join("\n");

  return [
    "This model cannot process images directly. When the user provides images, use the MCP server to analyze them.",
    "",
    `Vision MCP server: ${mcpServer.name}`,
    "",
    "User attachments in this conversation (use the file path when calling vision tools):",
    attachmentList
  ].join("\n");
}

function extractImageAttachments(promptMessages: PromptMessage[]): Array<{ id: string; filename: string; absolutePath: string }> {
  const attachments: Array<{ id: string; filename: string; absolutePath: string }> = [];

  for (const message of promptMessages) {
    if (typeof message.content === "string") continue;

    for (const part of message.content) {
      if (part.type === "image") {
        attachments.push({
          id: part.attachmentId,
          filename: part.filename,
          absolutePath: resolveAttachmentPath({ relativePath: part.relativePath })
        });
      }
    }
  }

  return attachments;
}

function stripImagesFromMessages(promptMessages: PromptMessage[]): PromptMessage[] {
  return promptMessages.map((message) => {
    if (typeof message.content === "string") return message;

    const textParts = message.content.filter((part) => part.type === "text");

    if (textParts.length === 0) {
      return { ...message, content: "" };
    }

    if (textParts.length === message.content.length) {
      return message;
    }

    return { ...message, content: textParts };
  });
}

function mergeSystemMessage(promptMessages: PromptMessage[], content: string): PromptMessage[] {
  const systemIndex = promptMessages.findIndex((m) => m.role === "system");
  if (systemIndex === -1) return [{ role: "system", content }, ...promptMessages];
  return promptMessages.map((m, i) => i === systemIndex ? { ...m, content: `${m.content}\n\n${content}` } : m);
}

function buildToolResultMessage(toolCallId: string, content: string): PromptMessage {
  return {
    role: "tool",
    toolCallId,
    content
  };
}

function isMemoryProposalToolCall(name: string) {
  return name === "create_memory" || name === "update_memory" || name === "delete_memory";
}

function hasUnfulfilledMemoryIntent(answer: string) {
  return MEMORY_INTENT_WITHOUT_TOOL_PATTERN.test(answer);
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

async function executeSearxngWebSearch(
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

async function executeMcpToolCall(
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

  const assistantMsg: PromptMessage = {
    role: "assistant",
    content: "",
    toolCalls: [{ id: toolCallId, name: functionName, arguments: JSON.stringify(correctedArgs) }]
  };

  return {
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, assistantMsg, resultMsg]
  };
}

async function executeLoadSkill(
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

async function executeShellCommand(
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

async function executeCreateMemory(
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

async function executeUpdateMemory(
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

async function executeDeleteMemory(
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

async function executeToolCall(
  toolCall: ProviderToolCall,
  context: {
    input: {
      skills: Skill[];
      mcpToolSets: ToolSet[];
      searxngBaseUrl?: string | null;
      memoryUserId?: string;
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    mcpServers: McpServer[];
    loadedSkillIds: Set<string>;
    successfulReadOnlyToolResults: Map<string, SuccessfulReadOnlyToolResult>;
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
    memoryUserId?: string;
  }
) {
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

  if (name.startsWith("mcp_")) {
    return executeMcpToolCall(toolCallId, name, args, context);
  }

  const resultMsg = buildToolResultMessage(toolCallId, `Unknown tool: ${name}`);
  return { nextSortOrder: context.timelineSortOrder, promptMessages: [...context.promptMessages, resultMsg] };
}

async function forceDirectAnswerAfterToolLoop(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  onEvent?: (event: ChatStreamEvent) => void;
  onAnswerSegment?: (segment: string) => Promise<void> | void;
}) {
  const providerStream = streamProviderResponse({
    settings: input.settings,
    promptMessages: mergeSystemMessage(
      input.promptMessages,
      "Stop using tools now. Answer the user directly from the information already gathered. Do not call any more tools."
    )
  });

  let answer = "";
  let thinking = "";
  let usage: Usage = {};

  while (true) {
    const next = await providerStream.next();

    if (next.done) {
      answer = next.value.answer;
      thinking = next.value.thinking;
      usage = next.value.usage;
      break;
    }

    input.onEvent?.(next.value);
  }

  if (!answer.trim()) {
    throw new Error("Assistant exceeded the maximum number of tool steps");
  }

  if (input.onAnswerSegment) {
    await input.onAnswerSegment(answer);
  }

  return { answer, thinking, usage };
}

export async function resolveAssistantTurn(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  skills: Skill[];
  mcpServers?: McpServer[];
  mcpToolSets: ToolSet[];
  visionMcpServer?: McpServer | null;
  memoriesEnabled?: boolean;
  searxngBaseUrl?: string | null;
  memoryUserId?: string;
  mcpTimeout?: number;
  abortSignal?: AbortSignal;
  throwIfStopped?: () => void;
  onEvent?: (event: ChatStreamEvent) => void;
  onAnswerSegment?: (segment: string) => Promise<void> | void;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  onActionComplete?: (
    handle: string | undefined,
    patch: { detail?: string; resultSummary?: string }
  ) => Promise<void> | void;
  onActionError?: (
    handle: string | undefined,
    patch: { detail?: string; resultSummary?: string }
  ) => Promise<void> | void;
}) {
  const mcpServers = input.mcpServers ?? input.mcpToolSets.map((e) => e.server);

  const assertRunning = () => {
    input.throwIfStopped?.();
    if (input.abortSignal?.aborted) {
      throw new ChatTurnStoppedError();
    }
  };

  // Handle vision MCP mode - strip images and inject directive
  let promptMessages = input.promptMessages;
  if (input.settings.visionMode === "mcp" && input.visionMcpServer) {
    const imageAttachments = extractImageAttachments(input.promptMessages);
    if (imageAttachments.length > 0) {
      promptMessages = stripImagesFromMessages(input.promptMessages);
      const visionDirective = buildVisionMcpDirective(input.visionMcpServer, imageAttachments);
      promptMessages = mergeSystemMessage(promptMessages, visionDirective);
    }
  }

  const turnSkills = filterSkillsForTurn(input.skills, promptMessages);
  const toolRuntimeInput = {
    ...input,
    skills: turnSkills
  };
  const loadedSkillIds = new Set<string>();
  const successfulReadOnlyToolResults = new Map<string, SuccessfulReadOnlyToolResult>();
  let totalUsage: Usage = {};

  promptMessages = turnSkills.length || mcpServers.length || input.mcpToolSets.length
    ? mergeSystemMessage(promptMessages, buildCapabilitiesSystemMessage(turnSkills, mcpServers))
    : promptMessages;

  let timelineSortOrder = 0;

  const commitAnswerSegment = async (segment: string) => {
    if (!segment) return;
    if (input.onAnswerSegment) {
      await input.onAnswerSegment(segment);
    }
  };

  for (let step = 0; step < MAX_ASSISTANT_CONTROL_STEPS; step += 1) {
    assertRunning();

    const tools = buildToolDefinitions({
      mcpToolSets: input.mcpToolSets,
      skills: turnSkills,
      loadedSkillIds,
      memoriesEnabled: input.memoriesEnabled ?? false,
      searxngBaseUrl: input.searxngBaseUrl
    });

    const providerStream = streamProviderResponse({
      settings: input.settings,
      promptMessages,
      tools: tools.length ? tools : undefined,
      abortSignal: input.abortSignal,
      copilotToolContext: input.settings.providerKind === "github_copilot" ? {
        mcpToolSets: input.mcpToolSets,
        skills: turnSkills,
        loadedSkillIds,
        memoriesEnabled: input.memoriesEnabled ?? false,
        searxngBaseUrl: input.searxngBaseUrl,
        memoryUserId: input.memoryUserId,
        onActionStart: input.onActionStart,
        onActionComplete: input.onActionComplete,
        onActionError: input.onActionError,
        mcpTimeout: input.mcpTimeout
      } : undefined
    });

    let answer = "";
    let thinking = "";
    let usage: Usage = {};
    let toolCalls: ProviderToolCall[] = [];

    while (true) {
      const next = await providerStream.next();
      if (next.done) {
        answer = next.value.answer;
        thinking = next.value.thinking;
        usage = next.value.usage;
        toolCalls = next.value.toolCalls ?? [];
        totalUsage = addUsage(totalUsage, usage);
        break;
      }
      input.onEvent?.(next.value);
    }

    assertRunning();

    if (!toolCalls.length) {
      if ((input.memoriesEnabled ?? false) && hasUnfulfilledMemoryIntent(answer)) {
        promptMessages = mergeSystemMessage(
          promptMessages,
          "Do not say that you saved, stored, remembered, updated, or deleted a memory unless you actually call the corresponding memory tool in that same response. If a memory proposal is warranted, call the memory tool now. Otherwise, answer normally without mentioning memory-saving."
        );
        continue;
      }

      if (!answer.trim()) {
        promptMessages = mergeSystemMessage(
          promptMessages,
          "Your previous response was empty. Answer the user directly. Do not emit an empty response."
        );
        continue;
      }
      await commitAnswerSegment(answer);
      return { answer, thinking, usage: totalUsage };
    }

    if (answer) {
      await commitAnswerSegment(answer);
    }

    if (step === MAX_ASSISTANT_CONTROL_STEPS - 1) {
      const forcedResult = await forceDirectAnswerAfterToolLoop({
        settings: input.settings,
        promptMessages,
        onEvent: input.onEvent,
        onAnswerSegment: input.onAnswerSegment
      });

      totalUsage = addUsage(totalUsage, forcedResult.usage);
      return { answer: forcedResult.answer, thinking: forcedResult.thinking, usage: totalUsage };
    }

    for (const toolCall of toolCalls) {
      assertRunning();

      const result = await executeToolCall(toolCall, {
        input: toolRuntimeInput,
        mcpServers,
        loadedSkillIds,
        successfulReadOnlyToolResults,
        timelineSortOrder,
        promptMessages,
        memoryUserId: input.memoryUserId
      });

      timelineSortOrder = result.nextSortOrder;
      promptMessages = result.promptMessages;
    }

    if (answer.trim() && toolCalls.every((toolCall) => isMemoryProposalToolCall(toolCall.name))) {
      return { answer, thinking, usage: totalUsage };
    }
  }

  throw new Error("Assistant exceeded the maximum number of tool steps");
}
