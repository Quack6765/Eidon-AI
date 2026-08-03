import type { Tool } from "@github/copilot-sdk";

import { throwIfChatTurnAborted } from "@/lib/chat-turn-control";
import {
  buildToolDefinitions,
  type ToolSet
} from "@/lib/tool-definitions";
import {
  executeToolCall,
  type RuntimeAction,
  type SuccessfulReadOnlyToolResult
} from "@/lib/tool-executors";
import type {
  RuntimeAppSettings,
  McpServer,
  PromptMessage,
  ProviderProfileWithApiKey,
  Skill,
  VisionMode
} from "@/lib/types";

export type CopilotToolContext = {
  settings?: ProviderProfileWithApiKey;
  appSettings?: RuntimeAppSettings;
  conversationId?: string;
  assistantMessageId?: string;
  promptMessages?: PromptMessage[];
  mcpToolSets: ToolSet[];
  skills: Skill[];
  loadedSkillIds: Set<string>;
  memoriesEnabled: boolean;
  effectiveVisionMode: VisionMode;
  memoryUserId?: string;
  imageGenerationToolEnabled?: boolean;
  restrictToGenerateImage?: boolean;
  imageGenerationActionHandle?: string;
  hasVisibleImageGenerationAction?: boolean;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  onActionComplete?: (
    handle: string | undefined,
    patch: { detail?: string; resultSummary?: string }
  ) => Promise<void> | void;
  onActionError?: (
    handle: string | undefined,
    patch: { detail?: string; resultSummary?: string }
  ) => Promise<void> | void;
  mcpTimeout?: number;
  abortSignal?: AbortSignal;
};

function promptResult(messages: PromptMessage[]) {
  const content = messages.at(-1)?.content;
  if (typeof content === "string") return content;
  if (!content) return "";
  return content.map((part) => ("text" in part ? part.text : "")).join("");
}

export function buildCopilotTools(context: CopilotToolContext): Tool[] {
  const promptMessages = context.promptMessages ?? [];
  const definitions = buildToolDefinitions({
    mcpToolSets: context.mcpToolSets,
    skills: context.skills,
    loadedSkillIds: context.loadedSkillIds,
    memoriesEnabled: context.memoriesEnabled,
    webSearchEnabled: Boolean(
      context.appSettings && context.appSettings.webSearch.providerId !== "disabled"
    ),
    imageGenerationProviderId: context.appSettings?.imageGeneration.providerId,
    imageGenerationToolEnabled: context.imageGenerationToolEnabled,
    restrictToGenerateImage: context.restrictToGenerateImage,
    effectiveVisionMode: context.effectiveVisionMode
  });
  const mcpServers: McpServer[] = context.mcpToolSets.map(({ server }) => server);
  const successfulReadOnlyToolResults = new Map<string, SuccessfulReadOnlyToolResult>();
  let timelineSortOrder = 0;

  return definitions.map((definition) => ({
    name: definition.function.name,
    description: definition.function.description,
    parameters: definition.function.parameters ?? { type: "object", properties: {} },
    overridesBuiltInTool:
      definition.function.name === "load_skill" ||
      definition.function.name === "execute_shell_command",
    skipPermission: true,
    handler: async (argumentsValue: unknown) => {
      throwIfChatTurnAborted(context.abortSignal);
      const toolCallId = `copilot_tool_${crypto.randomUUID()}`;
      const result = await executeToolCall(
        {
          id: toolCallId,
          name: definition.function.name,
          arguments: JSON.stringify(argumentsValue ?? {})
        },
        {
          input: {
            settings: context.settings,
            skills: context.skills,
            mcpToolSets: context.mcpToolSets,
            mcpTimeout: context.mcpTimeout,
            memoryUserId: context.memoryUserId,
            onActionStart: context.onActionStart,
            onActionComplete: context.onActionComplete,
            onActionError: context.onActionError,
            imageGenerationActionHandle: context.imageGenerationActionHandle,
            hasVisibleImageGenerationAction: context.hasVisibleImageGenerationAction,
            appSettings: context.appSettings,
            conversationId: context.conversationId,
            assistantMessageId: context.assistantMessageId,
            abortSignal: context.abortSignal
          },
          mcpServers,
          loadedSkillIds: context.loadedSkillIds,
          successfulReadOnlyToolResults,
          timelineSortOrder,
          promptMessages,
          memoryUserId: context.memoryUserId
        }
      );
      timelineSortOrder = result.nextSortOrder;
      throwIfChatTurnAborted(context.abortSignal);
      return promptResult(result.promptMessages);
    }
  }));
}
