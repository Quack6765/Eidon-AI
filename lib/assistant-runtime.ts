import { MAX_ASSISTANT_CONTROL_STEPS } from "@/lib/constants";
import { createGuardedAnswerEmitter } from "@/lib/control-output";
import { callMcpTool, summarizeToolResult } from "@/lib/mcp-client";
import { buildLoadedSkillsMessage, extractSkillRequest } from "@/lib/skill-runtime";
import { streamProviderResponse } from "@/lib/provider";
import type {
  ChatStreamEvent,
  McpServer,
  McpTool,
  MessageActionKind,
  ProviderProfileWithApiKey,
  PromptMessage,
  Skill
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
  label: string;
  detail?: string;
  serverId?: string | null;
  skillId?: string | null;
  toolName?: string | null;
  arguments?: Record<string, unknown> | null;
};

type ToolCallPayload = {
  serverId?: string;
  server?: string;
  tool: string;
  arguments?: Record<string, unknown>;
};

type PlannedToolCall = {
  server: McpServer;
  tool: McpTool;
  args: Record<string, unknown>;
};

function mergeSystemMessage(promptMessages: PromptMessage[], content: string): PromptMessage[] {
  const systemIndex = promptMessages.findIndex((message) => message.role === "system");

  if (systemIndex === -1) {
    return [{ role: "system", content }, ...promptMessages];
  }

  return promptMessages.map((message, index) =>
    index === systemIndex
      ? {
          ...message,
          content: `${message.content}\n\n${content}`
        }
      : message
  );
}

function slugifyCapabilityName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function addUsage(total: Usage, next: Usage) {
  return {
    inputTokens: (total.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (next.outputTokens ?? 0),
    reasoningTokens: (total.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0)
  };
}

function normalizeSkillName(name: string) {
  return name.trim().toLowerCase();
}

function getSkillAlias(skill: Skill) {
  if (skill.id.startsWith("builtin-")) {
    return skill.id.slice("builtin-".length);
  }

  return slugifyCapabilityName(skill.name) || normalizeSkillName(skill.name);
}

function buildCapabilitiesMessage(skills: Skill[], mcpServers: McpServer[], mcpToolSets: ToolSet[]) {
  const lines = [
    "Capability inventory for this conversation:",
    "If the user asks what tools, skills, servers, or capabilities you have access to, answer directly from this inventory.",
    "Do not claim that no tools are available when this inventory lists them.",
    "Use the best available MCP tools proactively when they would improve correctness, freshness, or completeness.",
    "Do not wait for the user to explicitly name a tool when the task clearly benefits from one.",
    "If the user asks for current, external, or verifiable information and a relevant MCP tool is available, prefer using it.",
    ""
  ];

  lines.push("Skills:");

  if (skills.length) {
    skills.forEach((skill) => {
      lines.push(
        `- ${getSkillAlias(skill)} | display name=${skill.name} | ${skill.description}`
      );
    });
  } else {
    lines.push("- none");
  }

  lines.push(
    "",
    "Skills are instruction modules, not executable MCP tools.",
    "You currently have access only to skill metadata.",
    "If you need one or more full skill bodies before answering, respond with exactly:",
    'SKILL_REQUEST: {"skills":["Skill Name"]}',
    "Do not answer the user in the same message as a skill request.",
    "Do not request a skill that has already been loaded.",
    "",
    "Configured MCP servers:"
  );

  if (mcpServers.length) {
    mcpServers.forEach((server) => {
      lines.push(`- ${server.name} | serverId=${server.id}`);
    });
  } else {
    lines.push("- none");
  }

  lines.push(
    "",
    "Configured MCP servers are part of your available environment even if no tools are currently executable from them in the active tool mode.",
    "",
    "Executable MCP tools:"
  );

  if (mcpToolSets.length) {
    mcpToolSets.forEach(({ server, tools }) => {
      const toolSummary = tools
        .map((tool) => {
          const mode = tool.annotations?.readOnlyHint === true ? "read-only" : "read-write";
          const label = getToolLabel(tool);
          const description = tool.description?.trim();
          return `${tool.name} (${label}; ${mode}${description ? `; ${description}` : ""})`;
        })
        .join(", ");

      lines.push(`- ${server.name} | serverId=${server.id} | tools: ${toolSummary}`);
    });
  } else {
    lines.push("- none");
  }

  lines.push(
    "",
    "To execute an MCP tool, respond with exactly:",
    'TOOL_CALL: {"serverId": "server_id", "tool": "tool_name", "arguments": {}}',
    "Only emit TOOL_CALL when you want Hermes to execute a tool instead of answering normally.",
    "Only call MCP tools that appear in this inventory."
  );

  return lines.join("\n");
}

function extractToolCall(answer: string) {
  const match = answer.trim().match(/^TOOL_CALL:\s*(\{[\s\S]+\})$/);

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]) as ToolCallPayload;
  } catch {
    return null;
  }
}

function buildArgumentsSummary(args: Record<string, unknown> | null | undefined) {
  if (!args || !Object.keys(args).length) {
    return "";
  }

  const firstScalar = Object.entries(args).find(([, value]) =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  );

  if (firstScalar) {
    return `${firstScalar[0]}=${String(firstScalar[1])}`;
  }

  const json = JSON.stringify(args);
  return json.length > 120 ? `${json.slice(0, 117)}...` : json;
}

function findTool(toolSets: ToolSet[], payload: ToolCallPayload) {
  const server = toolSets.find(
    (entry) => entry.server.id === payload.serverId || entry.server.name === payload.server
  );

  if (!server) {
    return null;
  }

  const tool = server.tools.find((entry) => entry.name === payload.tool);

  if (!tool) {
    return null;
  }

  return { server: server.server, tool };
}

function getToolLabel(tool: McpTool) {
  return tool.title ?? tool.annotations?.title ?? tool.name;
}

function renderToolResultForPrompt(input: {
  server: McpServer;
  tool: McpTool;
  args: Record<string, unknown>;
  resultSummary: string;
  isError: boolean;
}) {
  return [
    `MCP tool result`,
    `Server: ${input.server.name} (${input.server.id})`,
    `Tool: ${input.tool.name}`,
    `Arguments: ${JSON.stringify(input.args)}`,
    `Status: ${input.isError ? "error" : "success"}`,
    `Result:`,
    input.resultSummary
  ].join("\n");
}

function getLastUserText(promptMessages: PromptMessage[]) {
  for (let index = promptMessages.length - 1; index >= 0; index -= 1) {
    const message = promptMessages[index];

    if (message?.role !== "user") {
      continue;
    }

    if (typeof message.content === "string") {
      return message.content.trim();
    }

    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
  }

  return "";
}

function isCapabilityInventoryQuestion(text: string) {
  const normalized = text.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return [
    /what tools do you have/,
    /which tools do you have/,
    /what tools are available/,
    /which tools are available/,
    /what mcp servers do you have/,
    /which mcp servers do you have/,
    /what skills do you have/,
    /which skills do you have/,
    /what capabilities do you have/,
    /which capabilities do you have/
  ].some((pattern) => pattern.test(normalized));
}

function buildCapabilityInventoryAnswer(skills: Skill[], mcpServers: McpServer[], mcpToolSets: ToolSet[]) {
  const lines: string[] = [];

  if (mcpServers.length) {
    lines.push(
      `MCP servers: ${mcpServers
        .map((server) => server.name)
        .join(", ")}.`
    );
  } else {
    lines.push("MCP servers: none.");
  }

  if (skills.length) {
    lines.push(
      `Skills: ${skills
        .map((skill) => getSkillAlias(skill))
        .join(", ")}.`
    );
  } else {
    lines.push("Skills: none.");
  }

  if (mcpToolSets.length) {
    lines.push(
      `Executable MCP tools in the current mode: ${mcpToolSets
        .flatMap(({ server, tools }) => tools.map((tool) => `${server.name}.${tool.name}`))
        .join(", ")}.`
    );
  } else {
    lines.push("Executable MCP tools in the current mode: none.");
  }

  return lines.join("\n");
}

function extractUrls(text: string) {
  return [...text.matchAll(/https?:\/\/[^\s)]+/gi)].map((match) => match[0]);
}

function findToolByName(toolSets: ToolSet[], toolName: string) {
  for (const toolSet of toolSets) {
    const tool = toolSet.tools.find((entry) => entry.name === toolName);

    if (tool) {
      return {
        server: toolSet.server,
        tool
      };
    }
  }

  return null;
}

function shouldUseCodeSearch(text: string) {
  return /\b(api|sdk|library|framework|typescript|javascript|python|react|next\.?js|code|function|class|debug|error|implementation|example)\b/i.test(
    text
  );
}

function shouldUseWebSearch(text: string) {
  return /\b(latest|current|today|recent|news|up[- ]to[- ]date|look up|lookup|search|find|research|verify|check online|web)\b/i.test(
    text
  );
}

function planAutomaticToolCall(lastUserText: string, toolSets: ToolSet[]) {
  if (!lastUserText.trim()) {
    return null;
  }

  const urls = extractUrls(lastUserText);
  if (urls.length) {
    const crawlingTool = findToolByName(toolSets, "crawling_exa");

    if (crawlingTool) {
      return {
        server: crawlingTool.server,
        tool: crawlingTool.tool,
        args: {
          urls
        }
      } satisfies PlannedToolCall;
    }
  }

  if (shouldUseCodeSearch(lastUserText)) {
    const codeTool = findToolByName(toolSets, "get_code_context_exa");

    if (codeTool) {
      return {
        server: codeTool.server,
        tool: codeTool.tool,
        args: {
          query: lastUserText
        }
      } satisfies PlannedToolCall;
    }
  }

  if (shouldUseWebSearch(lastUserText)) {
    const webTool = findToolByName(toolSets, "web_search_exa");

    if (webTool) {
      return {
        server: webTool.server,
        tool: webTool.tool,
        args: {
          query: lastUserText
        }
      } satisfies PlannedToolCall;
    }
  }

  return null;
}

export async function resolveAssistantTurn(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  skills: Skill[];
  mcpServers?: McpServer[];
  mcpToolSets: ToolSet[];
  onEvent?: (event: ChatStreamEvent) => void;
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
  const loadedSkillIds = new Set<string>();
  const mcpServers = input.mcpServers ?? input.mcpToolSets.map((entry) => entry.server);
  const lastUserText = getLastUserText(input.promptMessages);

  if (isCapabilityInventoryQuestion(lastUserText)) {
    const answer = buildCapabilityInventoryAnswer(input.skills, mcpServers, input.mcpToolSets);

    input.onEvent?.({
      type: "answer_delta",
      text: answer
    });

    return {
      answer,
      thinking: "",
      usage: {}
    };
  }

  let promptMessages =
    input.skills.length || mcpServers.length || input.mcpToolSets.length
      ? mergeSystemMessage(
          input.promptMessages,
          buildCapabilitiesMessage(input.skills, mcpServers, input.mcpToolSets)
        )
      : input.promptMessages;
  let totalUsage: Usage = {};

  for (let step = 0; step < MAX_ASSISTANT_CONTROL_STEPS; step += 1) {
    if (step === 0) {
      const plannedToolCall = planAutomaticToolCall(lastUserText, input.mcpToolSets);

      if (plannedToolCall) {
        const handle = await input.onActionStart?.({
          kind: "mcp_tool_call",
          label: getToolLabel(plannedToolCall.tool),
          detail: buildArgumentsSummary(plannedToolCall.args),
          serverId: plannedToolCall.server.id,
          toolName: plannedToolCall.tool.name,
          arguments: plannedToolCall.args
        });
        const actionHandle = typeof handle === "string" ? handle : undefined;
        const result = await callMcpTool(
          plannedToolCall.server,
          plannedToolCall.tool.name,
          plannedToolCall.args
        );
        const resultSummary = summarizeToolResult(result);

        if (result.isError) {
          await input.onActionError?.(actionHandle, {
            detail: buildArgumentsSummary(plannedToolCall.args),
            resultSummary
          });
        } else {
          await input.onActionComplete?.(actionHandle, {
            detail: buildArgumentsSummary(plannedToolCall.args),
            resultSummary
          });
        }

        promptMessages = mergeSystemMessage(
          promptMessages,
          renderToolResultForPrompt({
            server: plannedToolCall.server,
            tool: plannedToolCall.tool,
            args: plannedToolCall.args,
            resultSummary,
            isError: Boolean(result.isError)
          })
        );
      }
    }

    const guardedAnswerEmitter = createGuardedAnswerEmitter(["SKILL_REQUEST:", "TOOL_CALL:"]);
    const providerStream = streamProviderResponse({
      settings: input.settings,
      promptMessages
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
        totalUsage = addUsage(totalUsage, usage);
        break;
      }

      if (next.value.type === "thinking_delta") {
        input.onEvent?.(next.value);
        continue;
      }

      if (next.value.type === "answer_delta") {
        const events = guardedAnswerEmitter.push(next.value.text);
        events.forEach((event) => input.onEvent?.(event));
        continue;
      }

      input.onEvent?.(next.value);
    }

    const requestedSkillNames = extractSkillRequest(answer);

    if (requestedSkillNames) {
      const requestedSkills = requestedSkillNames
        .map((name) => input.skills.find((skill) => normalizeSkillName(skill.name) === name))
        .filter((skill): skill is Skill => Boolean(skill))
        .filter((skill) => !loadedSkillIds.has(skill.id));

      if (!requestedSkills.length) {
        promptMessages = [
          ...mergeSystemMessage(
            promptMessages,
            "The requested skill is unavailable or already loaded. Continue and answer the user without another SKILL_REQUEST."
          ),
          {
            role: "assistant" as const,
            content: answer
          }
        ];
        continue;
      }

      for (const skill of requestedSkills) {
        loadedSkillIds.add(skill.id);
        const handle = await input.onActionStart?.({
          kind: "skill_load",
          label: `Load skill`,
          detail: skill.name,
          skillId: skill.id
        });
        const actionHandle = typeof handle === "string" ? handle : undefined;
        await input.onActionComplete?.(actionHandle, {
          detail: skill.name,
          resultSummary: "Skill instructions loaded."
        });
      }

      promptMessages = [
        ...mergeSystemMessage(promptMessages, buildLoadedSkillsMessage(requestedSkills)),
        {
          role: "assistant" as const,
          content: answer
        }
      ];
      continue;
    }

    const toolCall = extractToolCall(answer);

    if (toolCall) {
      const resolved = findTool(input.mcpToolSets, toolCall);
      const toolArgs = toolCall.arguments ?? {};

      if (!resolved) {
        promptMessages = [
          ...mergeSystemMessage(
            promptMessages,
            "The requested MCP tool is unavailable in the current tool mode or does not exist. Continue and answer the user without calling it again."
          ),
          {
            role: "assistant" as const,
            content: answer
          }
        ];
        continue;
      }

      const handle = await input.onActionStart?.({
        kind: "mcp_tool_call",
        label: getToolLabel(resolved.tool),
        detail: buildArgumentsSummary(toolArgs),
        serverId: resolved.server.id,
        toolName: resolved.tool.name,
        arguments: toolArgs
      });
      const actionHandle = typeof handle === "string" ? handle : undefined;

      const result = await callMcpTool(resolved.server, resolved.tool.name, toolArgs);
      const resultSummary = summarizeToolResult(result);

      if (result.isError) {
        await input.onActionError?.(actionHandle, {
          detail: buildArgumentsSummary(toolArgs),
          resultSummary
        });
      } else {
        await input.onActionComplete?.(actionHandle, {
          detail: buildArgumentsSummary(toolArgs),
          resultSummary
        });
      }

      promptMessages = [
        ...mergeSystemMessage(
          promptMessages,
          renderToolResultForPrompt({
            server: resolved.server,
            tool: resolved.tool,
            args: toolArgs,
            resultSummary,
            isError: Boolean(result.isError)
          })
        ),
        {
          role: "assistant" as const,
          content: answer
        }
      ];
      continue;
    }

    guardedAnswerEmitter.flush().forEach((event) => input.onEvent?.(event));

    return {
      answer,
      thinking,
      usage: totalUsage
    };
  }

  throw new Error("Assistant exceeded the maximum number of tool steps");
}
