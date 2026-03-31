import { MAX_ASSISTANT_CONTROL_STEPS } from "@/lib/constants";
import { callMcpTool, summarizeToolResult } from "@/lib/mcp-client";
import { buildLoadedSkillsMessage, buildSkillsMetadataMessage, extractSkillRequest } from "@/lib/skill-runtime";
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

export async function resolveAssistantTurn(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  skills: Skill[];
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
  let promptMessages = input.skills.length
    ? [
        ...input.promptMessages,
        {
          role: "system" as const,
          content: buildSkillsMetadataMessage(input.skills)
        }
      ]
    : input.promptMessages;
  let totalUsage: Usage = {};

  for (let step = 0; step < MAX_ASSISTANT_CONTROL_STEPS; step += 1) {
    const providerStream = streamProviderResponse({
      settings: input.settings,
      promptMessages
    });
    const bufferedEvents: ChatStreamEvent[] = [];
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

      bufferedEvents.push(next.value);
    }

    const requestedSkillNames = extractSkillRequest(answer);

    if (requestedSkillNames) {
      const requestedSkills = requestedSkillNames
        .map((name) => input.skills.find((skill) => normalizeSkillName(skill.name) === name))
        .filter((skill): skill is Skill => Boolean(skill))
        .filter((skill) => !loadedSkillIds.has(skill.id));

      if (!requestedSkills.length) {
        promptMessages = [
          ...promptMessages,
          {
            role: "assistant" as const,
            content: answer
          },
          {
            role: "system" as const,
            content:
              "The requested skill is unavailable or already loaded. Continue and answer the user without another SKILL_REQUEST."
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
        ...promptMessages,
        {
          role: "assistant" as const,
          content: answer
        },
        {
          role: "system" as const,
          content: buildLoadedSkillsMessage(requestedSkills)
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
          ...promptMessages,
          {
            role: "assistant" as const,
            content: answer
          },
          {
            role: "system" as const,
            content:
              "The requested MCP tool is unavailable in the current tool mode or does not exist. Continue and answer the user without calling it again."
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
        ...promptMessages,
        {
          role: "assistant" as const,
          content: answer
        },
        {
          role: "system" as const,
          content: renderToolResultForPrompt({
            server: resolved.server,
            tool: resolved.tool,
            args: toolArgs,
            resultSummary,
            isError: Boolean(result.isError)
          })
        }
      ];
      continue;
    }

    bufferedEvents.forEach((event) => input.onEvent?.(event));

    return {
      answer,
      thinking,
      usage: totalUsage
    };
  }

  throw new Error("Assistant exceeded the maximum number of tool steps");
}
