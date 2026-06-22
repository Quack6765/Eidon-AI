import { resolveAttachmentPath } from "@/lib/attachments";
import { ChatTurnStoppedError } from "@/lib/chat-turn-control";
import { streamProviderResponse } from "@/lib/provider";
import { isBuiltinWebSearchServer } from "@/lib/web-search";
import { MAX_ASSISTANT_CONTROL_STEPS } from "@/lib/constants";
import { MARKDOWN_FORMATTING_RULES } from "@/lib/markdown/formatting-rules-prompt";
import { supportsImageInput } from "@/lib/model-capabilities";
import { getSkillResolvedName, getSkillResolvedDescription, getLatestUserPromptContent, shouldAddInlineAttachmentDirective, filterSkillsForTurn, hasUnfulfilledMemoryIntent, hasUnfulfilledImageGenerationIntent } from "./prompt-analysis";
import { type ToolSet, buildToolDefinitions } from "./tool-definitions";
import { type RuntimeAction, type SuccessfulReadOnlyToolResult, buildToolResultMessage, isMemoryProposalToolCall, executeToolCall } from "./tool-executors";
import type {
  ChatStreamEvent,
  McpServer,
  ProviderProfileWithApiKey,
  ProviderToolCall,
  PromptMessage,
  Skill,
  VisionMode
} from "@/lib/types";

export type { ToolSet } from "./tool-definitions";
export type { RuntimeAction, SuccessfulReadOnlyToolResult } from "./tool-executors";
export { mcpToolFunctionName, buildToolDefinitions } from "./tool-definitions";
export { buildToolResultMessage, isMemoryProposalToolCall, executeToolCall } from "./tool-executors";
export { getLatestUserPromptContent, getLatestUserPromptIndex, shouldAddInlineAttachmentDirective, hasRecentAssistantImageContext, filterSkillsForTurn, hasUnfulfilledMemoryIntent, hasUnfulfilledImageGenerationIntent } from "./prompt-analysis";

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};

const IMAGE_TOOL_LATEST_REQUEST_DIRECTIVE =
  "When calling generate_image, Base the prompt and count on only the latest user image request. Treat each new image request as independent by default. Do not combine earlier image requests or count them again unless the latest user message explicitly asks to modify, continue, or combine prior results.";
const IMAGE_TOOL_POST_SUCCESS_DIRECTIVE =
  "Image generation is available in this environment and a generated image is already attached in this turn. Do not claim that image generation is unavailable. Refer to the generated image result directly, do not call generate_image again in this turn, and do not embed markdown image tags or local file links in your response.";
const IMAGE_TOOL_REQUIRED_DIRECTIVE =
  "The latest user request requires generating a new image. Do not claim that an image was generated unless you call generate_image in this response. Call generate_image now.";
const INLINE_ATTACHMENT_DIRECTIVE =
  "When you create or capture an image file, rely on the runtime attachment flow. Do not run base64 on screenshot/image files. Do not embed data: image URLs in your visible response.";
const NON_NATIVE_VISION_DIRECTIVE =
  "The current model configuration cannot inspect attached images directly in this turn. Attached images were provided only as text placeholders. Do not claim to have viewed image contents directly. If image analysis is required, explain the limitation or use the configured vision MCP server when available.";
const MERMAID_DIAGRAM_DIRECTIVE =
  "When you need to present diagrams (flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, Gantt charts, pie charts, mind maps, or any other diagram type), use mermaid.js syntax inside a fenced code block with the `mermaid` language identifier. For example:\n\n```mermaid\ngraph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Success]\n    B -->|No| D[Try Again]\n```\n\nAlways prefer mermaid diagrams over ASCII art or text-based diagrams.";

function buildCapabilitiesSystemMessage(skills: Skill[], mcpServers: McpServer[], hasWebSearch: boolean) {
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

  lines.push(
    "",
    "Skills-first behavior: before choosing an approach for any task, review the available skills listed above.",
    "If a skill matches the task, use it instead of a raw tool or command.",
    "For example, when navigating to a website, use the agent-browser skill (full browser with JS rendering) instead of curl or webfetch.",
    "Skills provide purpose-built workflows that are more effective than ad-hoc commands."
  );

  lines.push("", "Use available tools proactively when they would improve your answer.");
  lines.push("Do not call the same read-only tool repeatedly once you already have a successful result for it in the current turn.");
  lines.push("If a tool call fails because of invalid arguments, correct the arguments and retry at most once.");

  if (hasWebSearch) {
    lines.push(
      "",
      "Web search guidance: prefer answering from your own knowledge whenever possible.",
      "Only use web search when the question involves recent events, time-sensitive information,",
      "topics you are uncertain about, or when the user explicitly requests a search.",
      "If you can answer confidently and accurately from your training data, do so without searching."
    );
  }

  return lines.join("\n");
}

function buildVisionMcpDirective(
  servers: McpServer[],
  attachments: Array<{ id: string; filename: string; absolutePath: string }>
): string {
  const serverList = servers.map((s) => `- ${s.name}`).join("\n");
  const attachmentList = attachments
    .map((a) => `- ${a.filename} (path: ${a.absolutePath})`)
    .join("\n");

  return [
    "This model cannot view images or videos directly. When the user provides images or videos, use one of the configured vision MCP servers to analyze them.",
    "",
    "Vision MCP servers:",
    serverList,
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

function replaceImagesWithTextPlaceholders(promptMessages: PromptMessage[]): PromptMessage[] {
  return promptMessages.map((message) => {
    if (typeof message.content === "string") {
      return message;
    }

    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === "text") {
          return part;
        }

        return {
          type: "text" as const,
          text: `Attached image: ${part.filename}`
        };
      })
    };
  });
}

function mergeSystemMessage(promptMessages: PromptMessage[], content: string): PromptMessage[] {
  const systemIndex = promptMessages.findIndex((m) => m.role === "system");
  if (systemIndex === -1) return [{ role: "system", content }, ...promptMessages];
  return promptMessages.map((m, i) => i === systemIndex ? { ...m, content: `${m.content}\n\n${content}` } : m);
}

function getEffectiveVisionMode(
  settings: ProviderProfileWithApiKey,
  hasVisionServers: boolean
): VisionMode {
  if (settings.visionMode === "native") {
    return supportsImageInput(settings.model, settings.apiMode) ? "native" : "none";
  }
  if (settings.visionMode === "mcp") {
    return hasVisionServers ? "mcp" : "none";
  }
  return "none";
}

function prepareProviderPromptMessages(input: {
  promptMessages: PromptMessage[];
  settings: ProviderProfileWithApiKey;
  visionMcpServers?: McpServer[];
}) {
  const imageAttachments = extractImageAttachments(input.promptMessages);
  if (imageAttachments.length === 0) {
    return input.promptMessages;
  }

  const visionServers = input.visionMcpServers ?? [];
  const effectiveVisionMode = getEffectiveVisionMode(input.settings, visionServers.length > 0);
  if (effectiveVisionMode === "native") {
    return input.promptMessages;
  }

  const providerPromptMessages = replaceImagesWithTextPlaceholders(input.promptMessages);

  if (effectiveVisionMode === "mcp" && visionServers.length > 0) {
    return mergeSystemMessage(
      providerPromptMessages,
      buildVisionMcpDirective(visionServers, imageAttachments)
    );
  }

  return mergeSystemMessage(providerPromptMessages, NON_NATIVE_VISION_DIRECTIVE);
}

async function forceDirectAnswerAfterToolLoop(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  visionMcpServers?: McpServer[];
  onEvent?: (event: ChatStreamEvent) => void;
  onAnswerSegment?: (segment: string) => Promise<void> | void;
}) {
  const providerPromptMessages = prepareProviderPromptMessages({
    promptMessages: mergeSystemMessage(
      input.promptMessages,
      "Stop using tools now. Answer the user directly from the information already gathered. Do not call any more tools."
    ),
    settings: input.settings,
    visionMcpServers: input.visionMcpServers
  });

  const providerStream = streamProviderResponse({
    settings: input.settings,
    promptMessages: providerPromptMessages
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
  visionMcpServers?: McpServer[];
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
  appSettings?: import("@/lib/types").AppSettings;
  conversationId?: string;
  assistantMessageId?: string;
}) {
  const mcpServers = input.mcpServers ?? input.mcpToolSets.map((e) => e.server);
  const maxSteps = input.appSettings?.maxAssistantToolSteps ?? MAX_ASSISTANT_CONTROL_STEPS;

  const assertRunning = () => {
    input.throwIfStopped?.();
    if (input.abortSignal?.aborted) {
      throw new ChatTurnStoppedError();
    }
  };

  let promptMessages = input.promptMessages;

  const visionMcpServers = input.visionMcpServers ?? [];
  const effectiveVisionMode = getEffectiveVisionMode(input.settings, visionMcpServers.length > 0);

  const turnSkills = filterSkillsForTurn(input.skills, promptMessages);
  const toolRuntimeInput = {
    ...input,
    skills: turnSkills
  };
  const loadedSkillIds = new Set<string>();
  const successfulReadOnlyToolResults = new Map<string, SuccessfulReadOnlyToolResult>();
  let imageGenerationToolConsumed = false;
  let visibleImageActionStarted = false;
  let visibleImageActionHandle: string | undefined;

  const hasWebSearch = mcpServers.some(isBuiltinWebSearchServer) || !!input.searxngBaseUrl;

  const visibleMcpServers = mcpServers.filter(
    (server) => !(server.isVisionMcp && effectiveVisionMode !== "mcp")
  );

  promptMessages = turnSkills.length || visibleMcpServers.length || input.mcpToolSets.length
    ? mergeSystemMessage(promptMessages, buildCapabilitiesSystemMessage(turnSkills, visibleMcpServers, hasWebSearch))
    : promptMessages;
  if (shouldAddInlineAttachmentDirective(promptMessages)) {
    promptMessages = mergeSystemMessage(promptMessages, INLINE_ATTACHMENT_DIRECTIVE);
  }

  if (input.appSettings?.imageGenerationBackend && input.appSettings.imageGenerationBackend !== "disabled") {
    promptMessages = mergeSystemMessage(promptMessages, IMAGE_TOOL_LATEST_REQUEST_DIRECTIVE);
  }

  promptMessages = mergeSystemMessage(promptMessages, MERMAID_DIAGRAM_DIRECTIVE);
  promptMessages = mergeSystemMessage(promptMessages, MARKDOWN_FORMATTING_RULES);

  let timelineSortOrder = 0;

  const commitAnswerSegment = async (segment: string) => {
    if (!segment) return;
    if (input.onAnswerSegment) {
      await input.onAnswerSegment(segment);
    }
  };

  for (let step = 0; step < maxSteps; step += 1) {
    assertRunning();

    const restrictToGenerateImage =
      !imageGenerationToolConsumed &&
      !!input.appSettings?.imageGenerationBackend &&
      input.appSettings.imageGenerationBackend !== "disabled" &&
      hasUnfulfilledImageGenerationIntent(promptMessages);

    if (restrictToGenerateImage && !visibleImageActionStarted) {
      const handle = await input.onActionStart?.({
        kind: "image_generation",
        label: "Generate image",
        detail: getLatestUserPromptContent(promptMessages) || "Generate image"
      });
      visibleImageActionStarted = true;
      visibleImageActionHandle = typeof handle === "string" ? handle : undefined;
    }

    const tools = buildToolDefinitions({
      mcpToolSets: input.mcpToolSets,
      skills: turnSkills,
      loadedSkillIds,
      memoriesEnabled: input.memoriesEnabled ?? false,
      searxngBaseUrl: input.searxngBaseUrl,
      imageGenerationBackend: input.appSettings?.imageGenerationBackend,
      imageGenerationToolEnabled: !imageGenerationToolConsumed,
      restrictToGenerateImage,
      effectiveVisionMode
    });

    const providerPromptMessages = prepareProviderPromptMessages({
      promptMessages,
      settings: input.settings,
      visionMcpServers
    });

    const providerStream = streamProviderResponse({
      settings: input.settings,
      promptMessages: providerPromptMessages,
      tools: tools.length ? tools : undefined,
      abortSignal: input.abortSignal,
      copilotToolContext: input.settings.providerKind === "github_copilot" ? {
        mcpToolSets: input.mcpToolSets,
        skills: turnSkills,
        loadedSkillIds,
        memoriesEnabled: input.memoriesEnabled ?? false,
        effectiveVisionMode,
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
    let reasoningSignature: string | undefined;
    let usage: Usage = {};
    let toolCalls: ProviderToolCall[] = [];

    while (true) {
      const next = await providerStream.next();
      if (next.done) {
        answer = next.value.answer;
        thinking = next.value.thinking;
        reasoningSignature = next.value.reasoningSignature;
        usage = next.value.usage;
        toolCalls = next.value.toolCalls ?? [];
        break;
      }
      input.onEvent?.(next.value);
    }

    assertRunning();

    if (!toolCalls.length) {
      if (
        !imageGenerationToolConsumed &&
        input.appSettings?.imageGenerationBackend &&
        input.appSettings.imageGenerationBackend !== "disabled" &&
        hasUnfulfilledImageGenerationIntent(promptMessages)
      ) {
        promptMessages = mergeSystemMessage(promptMessages, IMAGE_TOOL_REQUIRED_DIRECTIVE);
        continue;
      }

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
      return { answer, thinking, usage };
    }

    if (answer) {
      await commitAnswerSegment(answer);
    }

    promptMessages = [
      ...promptMessages,
      {
        role: "assistant",
        content: answer,
        reasoningContent: thinking || undefined,
        reasoningSignature,
        toolCalls
      }
    ];

    if (step === maxSteps - 1) {
      const forcedResult = await forceDirectAnswerAfterToolLoop({
        settings: input.settings,
        promptMessages,
        visionMcpServers,
        onEvent: input.onEvent,
        onAnswerSegment: input.onAnswerSegment
      });

      return { answer: forcedResult.answer, thinking: forcedResult.thinking, usage: forcedResult.usage };
    }

    let imageGenerationToolAttemptedThisStep = false;

    for (const toolCall of toolCalls) {
      assertRunning();

      if (toolCall.name === "generate_image") {
        if (imageGenerationToolConsumed || imageGenerationToolAttemptedThisStep) {
          promptMessages = [
            ...promptMessages,
            buildToolResultMessage(
              toolCall.id,
              "Error: generate_image can only be called once per assistant turn. Respond to the user with the generated result instead."
            )
          ];
          continue;
        }

        imageGenerationToolAttemptedThisStep = true;
      }

      const result = await executeToolCall(toolCall, {
        input: {
          ...toolRuntimeInput,
          imageGenerationActionHandle: visibleImageActionHandle,
          hasVisibleImageGenerationAction: visibleImageActionStarted
        },
        mcpServers,
        loadedSkillIds,
        successfulReadOnlyToolResults,
        timelineSortOrder,
        promptMessages,
        memoryUserId: input.memoryUserId
      });

      timelineSortOrder = result.nextSortOrder;
      promptMessages = result.promptMessages;

      if (toolCall.name === "generate_image" && result.toolSucceeded) {
        imageGenerationToolConsumed = true;
        visibleImageActionStarted = false;
        visibleImageActionHandle = undefined;
        promptMessages = mergeSystemMessage(promptMessages, IMAGE_TOOL_POST_SUCCESS_DIRECTIVE);
      } else if (toolCall.name === "generate_image") {
        visibleImageActionStarted = false;
        visibleImageActionHandle = undefined;
      }
    }

    if (answer.trim() && toolCalls.every((toolCall) => isMemoryProposalToolCall(toolCall.name))) {
      return { answer, thinking, usage };
    }
  }

  throw new Error("Assistant exceeded the maximum number of tool steps");
}
