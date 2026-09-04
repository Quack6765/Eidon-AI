import { resolveAttachmentPath } from "@/lib/attachments";
import { isSemanticRecallAvailable } from "@/lib/semantic-index";
import { ChatTurnStoppedError } from "@/lib/chat-turn-control";
import { getWebSearchPipeline } from "@/lib/web-search-catalog";
import { streamProviderResponse } from "@/lib/provider";
import { getProviderAdapter, getProviderReadinessError } from "@/lib/provider-adapters";
import { withStreamRetry } from "@/lib/provider-retry";
import { MAX_ASSISTANT_CONTROL_STEPS, RESEARCH_CONTEXT_COLLAPSE_RATIO } from "@/lib/constants";
import {
  RESEARCH_FINAL_ANSWER_DIRECTIVE,
  buildResearchDirective,
  collapseOlderToolResults,
  formatResearchPlan,
  resolveResearchStepBudget
} from "@/lib/research-mode";
import { computeCompactionLimit, estimatePromptTokens } from "@/lib/tokenization";
import { MARKDOWN_FORMATTING_RULES } from "@/lib/markdown/formatting-rules-prompt";
import { supportsImageInput } from "@/lib/model-capabilities";
import { getProviderApiMode } from "@/lib/provider-profile";
import { getSkillResolvedName, getSkillResolvedDescription, getLatestUserPromptContent, shouldAddInlineAttachmentDirective, filterSkillsForTurn, hasUnfulfilledMemoryIntent, hasUnfulfilledImageGenerationIntent } from "./prompt-analysis";
import { isBotWorkspaceSkillId } from "./bot-workspace-skills";
import { type ToolSet, buildToolDefinitions, mcpToolFunctionName } from "./tool-definitions";
import { type RuntimeAction, type SuccessfulReadOnlyToolResult, buildToolResultMessage, isProposalToolCall, executeToolCall } from "./tool-executors";
import type {
  ChatStreamEvent,
  McpServer,
  MemoryRigor,
  ProviderResponseItem,
  RuntimeProviderProfile,
  ProviderToolCall,
  PromptMessage,
  Skill,
  VisionMode
} from "@/lib/types";

export type { ToolSet } from "./tool-definitions";
export type { RuntimeAction, SuccessfulReadOnlyToolResult } from "./tool-executors";
export { mcpToolFunctionName, buildToolDefinitions } from "./tool-definitions";
export { buildToolResultMessage, isProposalToolCall, executeToolCall } from "./tool-executors";
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
const WEB_SEARCH_RESULTS_SUFFICIENT_DIRECTIVE =
  "Web search results have been received in this turn. Answer the user now by synthesizing the results above, or call read_page on the most relevant result URLs when the snippets are insufficient. Only call web_search again if the results clearly cannot answer the question — never to re-run or refine similar queries, and never for additional confirmation. Users wait while you search, so prefer answering from what you already have.";
const IMAGE_TOOL_REQUIRED_DIRECTIVE =
  "The latest user request requires generating a new image. Do not claim that an image was generated unless you call generate_image in this response. Call generate_image now.";
const INLINE_ATTACHMENT_DIRECTIVE =
  "When you create or capture an image file, rely on the runtime attachment flow. Do not run base64 on screenshot/image files. Do not embed data: image URLs in your visible response.";
const NON_NATIVE_VISION_DIRECTIVE =
  "The current model configuration cannot inspect attached images directly in this turn. Attached images were provided only as text placeholders. Do not claim to have viewed image contents directly. If image analysis is required, explain the limitation or use the configured vision MCP server when available.";
const MERMAID_DIAGRAM_DIRECTIVE =
  "When you need to present diagrams (flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, Gantt charts, pie charts, mind maps, or any other diagram type), use mermaid.js syntax inside a fenced code block with the `mermaid` language identifier. For example:\n\n```mermaid\ngraph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Success]\n    B -->|No| D[Try Again]\n```\n\nAlways prefer mermaid diagrams over ASCII art or text-based diagrams.";

function buildCapabilitiesStableSegment(
  mcpServers: McpServer[],
  hasWebSearch: boolean,
  parallelWebSearch: boolean,
  authRequiredServerIds: Set<string> = new Set()
) {
  const lines: string[] = [];

  if (mcpServers.length) {
    lines.push(
      "",
      "Configured MCP servers (this is the complete, authoritative list — when the user asks about a specific MCP server, check this list before answering):"
    );
    for (const server of mcpServers) {
      lines.push(
        authRequiredServerIds.has(server.id)
          ? `- ${server.name} (requires authentication — its tools are NOT available this turn. If the user asks about this server or wants to use its tools, do not say the tools are missing for any other reason: tell them an administrator must reconnect it under Settings → MCP and its tools will be available after that)`
          : `- ${server.name}`
      );
    }
  }

  lines.push(
    "",
    "Skills-first behavior: before choosing an approach for any task, review the available skills provided this turn.",
    "If a skill matches the task, use it instead of a raw tool or command.",
    "For example, to read the content of a web page call the read_page tool first (fast, returns the page as Markdown); use the agent-browser skill (full browser with JS rendering) only for pages that need JavaScript, login, or interaction, or when read_page could not fetch the page. Never fetch pages with curl or shell commands.",
    "Skills provide purpose-built workflows that are more effective than ad-hoc commands."
  );

  lines.push("", "Use available tools proactively when they would improve your answer.");
  lines.push(
    "Page reading guidance: when you need the contents of a specific URL (a search result, a link the user shared, documentation), call read_page. Read several URLs by issuing multiple read_page calls in the same step; they run in parallel. Pass a smaller max_chars when you only need an overview."
  );
  lines.push("Do not call the same read-only tool repeatedly once you already have a successful result for it in the current turn.");
  lines.push("If a tool call fails because of invalid arguments, correct the arguments and retry at most once.");

  if (hasWebSearch) {
    lines.push(
      "",
      "Web search guidance: prefer answering from your own knowledge whenever possible.",
      "Only use web search when the question involves recent events, time-sensitive information,",
      "topics you are uncertain about, or when the user explicitly requests a search.",
      ...(parallelWebSearch
        ? [
            "When one question spans multiple facets, pass several distinct queries in a single web_search call (queries) — they execute in parallel.",
            "A single complex query is automatically decomposed into parallel sub-queries, so one call is usually enough."
          ]
        : [
            "If you can answer confidently and accurately from your training data, do so without searching."
          ])
    );
  }

  return lines.join("\n");
}

function buildDynamicSkillsSegment(skills: Skill[], saveSkillEnabled = false) {
  if (!skills.length && !saveSkillEnabled) return "";

  const lines: string[] = [];

  if (skills.length) {
    lines.push("Available skills (metadata only — call load_skill to get full instructions):");
    for (const skill of skills) {
      const marker = isBotWorkspaceSkillId(skill.id) ? " (workspace)" : "";
      lines.push(`- ${getSkillResolvedName(skill)}${marker}: ${getSkillResolvedDescription(skill)}`);
    }
    if (saveSkillEnabled) {
      lines.push(
        "Skills marked (workspace) are your own — create or update reusable skills with the save_skill tool."
      );
    }
  } else {
    lines.push(
      "No skills are available yet. You can create your own reusable skills with the save_skill tool; saved skills become available via load_skill in future turns."
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

function buildProviderVisionDirective(
  attachments: Array<{ id: string; filename: string; absolutePath: string }>
): string {
  const attachmentList = attachments
    .map((a) => `- ${a.filename} (path: ${a.absolutePath})`)
    .join("\n");

  return [
    "This model cannot view images or videos directly. When the user provides images, call the analyze_image tool with the absolute file paths listed below and an optional question. A vision-capable model will analyze them and return a text description.",
    "",
    "User attachments in this conversation (use these absolute paths when calling analyze_image):",
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

function appendTrailingGuidance(promptMessages: PromptMessage[], content: string): PromptMessage[] {
  if (!content) return promptMessages;
  return [...promptMessages, { role: "user", content }];
}

function getEffectiveVisionMode(
  settings: RuntimeProviderProfile,
  hasVisionServers: boolean
): VisionMode {
  if (settings.visionMode === "native") {
    return supportsImageInput(settings.model, getProviderApiMode(settings)) ? "native" : "none";
  }
  if (settings.visionMode === "mcp") {
    return hasVisionServers ? "mcp" : "none";
  }
  if (settings.visionMode === "provider") {
    return settings.visionProviderProfileId ? "provider" : "none";
  }
  return "none";
}

function prepareProviderPromptMessages(input: {
  promptMessages: PromptMessage[];
  settings: RuntimeProviderProfile;
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

  if (effectiveVisionMode === "provider") {
    return mergeSystemMessage(
      providerPromptMessages,
      buildProviderVisionDirective(imageAttachments)
    );
  }

  return mergeSystemMessage(providerPromptMessages, NON_NATIVE_VISION_DIRECTIVE);
}

async function forceDirectAnswerAfterToolLoop(input: {
  settings: RuntimeProviderProfile;
  promptMessages: PromptMessage[];
  visionMcpServers?: McpServer[];
  conversationId?: string;
  abortSignal?: AbortSignal;
  enableStreamRetry?: boolean;
  onEvent?: (event: ChatStreamEvent) => void;
  onAnswerSegment?: (segment: string) => Promise<void> | void;
  directive?: string;
}) {
  const providerPromptMessages = prepareProviderPromptMessages({
    promptMessages: mergeSystemMessage(
      input.promptMessages,
      input.directive ??
        "Stop using tools now. Answer the user directly from the information already gathered. Do not call any more tools."
    ),
    settings: input.settings,
    visionMcpServers: input.visionMcpServers
  });

  const buildForcedStream = () =>
    streamProviderResponse({
      settings: input.settings,
      promptMessages: providerPromptMessages,
      conversationId: input.conversationId,
      abortSignal: input.abortSignal
    });
  const providerStream =
    input.enableStreamRetry && getProviderAdapter(input.settings.providerKind).supportsStreamRetry
      ? withStreamRetry(buildForcedStream, { signal: input.abortSignal })
      : buildForcedStream();

  let answer = "";
  let thinking = "";
  let usage: Usage = {};

  while (true) {
    let next: Awaited<ReturnType<typeof providerStream.next>>;
    try {
      next = await providerStream.next();
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw new ChatTurnStoppedError();
      }
      throw error;
    }

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
  settings: RuntimeProviderProfile;
  visionProfile?: RuntimeProviderProfile;
  promptMessages: PromptMessage[];
  skills: Skill[];
  mcpServers?: McpServer[];
  mcpToolSets: ToolSet[];
  visionMcpServers?: McpServer[];
  memoriesEnabled?: boolean;
  memoriesRigor?: MemoryRigor;
  memoryUserId?: string | null;
  mcpTimeout?: number;
  abortSignal?: AbortSignal;
  enableStreamRetry?: boolean;
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
  appSettings?: import("@/lib/types").RuntimeAppSettings;
  conversationId?: string;
  assistantMessageId?: string;
  botTeam?: {
    isChief: boolean;
    roster: import("@/lib/bots").BotRosterEntry[];
  };
  botWorkspaceSkillsEnabled?: boolean;
  research?: import("@/lib/types").ChatResearchOptions;
}) {
  const mcpServers = input.mcpServers ?? input.mcpToolSets.map((e) => e.server);
  const baseSteps = input.appSettings?.maxAssistantToolSteps ?? MAX_ASSISTANT_CONTROL_STEPS;
  const maxSteps = input.research ? resolveResearchStepBudget(baseSteps) : baseSteps;
  const researchCollapseThreshold = input.research
    ? Math.floor(computeCompactionLimit(input.settings) * RESEARCH_CONTEXT_COLLAPSE_RATIO)
    : null;

  const assertRunning = () => {
    input.throwIfStopped?.();
    if (input.abortSignal?.aborted) {
      throw new ChatTurnStoppedError();
    }
  };

  let promptMessages = input.promptMessages;

  const visionMcpServers = input.visionMcpServers ?? [];
  const effectiveVisionMode = getEffectiveVisionMode(input.settings, visionMcpServers.length > 0);

  if (
    effectiveVisionMode === "provider" &&
    extractImageAttachments(promptMessages).length > 0
  ) {
    if (!input.visionProfile) {
      throw new Error(
        "Vision provider profile is not available. Select a vision provider profile in Settings, or switch this profile's vision mode."
      );
    }
    const visionReadinessError = getProviderReadinessError(input.visionProfile);
    if (visionReadinessError) {
      throw new Error(visionReadinessError);
    }
  }

  const turnSkills = filterSkillsForTurn(input.skills, promptMessages, {
    includeBrowserSkills: Boolean(input.research)
  });
  const toolRuntimeInput = {
    ...input,
    skills: turnSkills
  };
  const loadedSkillIds = new Set<string>();
  const successfulReadOnlyToolResults = new Map<string, SuccessfulReadOnlyToolResult>();

  const parallelizableToolNames = new Set<string>(["web_search", "read_page", "message_bot", "check_bot"]);
  let webSearchDirectiveAdded = false;
  for (const { server, tools } of input.mcpToolSets) {
    if (server.isVisionMcp && effectiveVisionMode !== "mcp") continue;
    for (const tool of tools) {
      if (tool.annotations?.readOnlyHint) {
        parallelizableToolNames.add(mcpToolFunctionName(server.slug, tool.name));
      }
    }
  }

  let imageGenerationToolConsumed = false;
  let imageGenerationToolAttempted = false;
  let imageGenerationIntentRetries = 0;
  let memoryIntentRetries = 0;
  let emptyAnswerRetries = 0;
  let visibleImageActionStarted = false;
  let visibleImageActionHandle: string | undefined;

  const hasWebSearch = Boolean(
    input.appSettings && input.appSettings.webSearch.providerId !== "disabled"
  );
  const webSearchPipeline = getWebSearchPipeline(input.appSettings?.webSearch.configuration);
  const parallelWebSearch = hasWebSearch && webSearchPipeline.mode !== "off";
  const hasImageGeneration = Boolean(
    input.appSettings && input.appSettings.imageGeneration.providerId !== "disabled"
  );

  const visibleMcpServers = mcpServers.filter(
    (server) => !(server.isVisionMcp && effectiveVisionMode !== "mcp")
  );

  if (turnSkills.length || visibleMcpServers.length || input.mcpToolSets.length) {
    promptMessages = mergeSystemMessage(
      promptMessages,
      buildCapabilitiesStableSegment(
        visibleMcpServers,
        hasWebSearch,
        parallelWebSearch,
        new Set(
          input.mcpToolSets
            .filter((toolSet) => toolSet.authRequired)
            .map((toolSet) => toolSet.server.id)
        )
      )
    );
  }
  if (shouldAddInlineAttachmentDirective(promptMessages)) {
    promptMessages = mergeSystemMessage(promptMessages, INLINE_ATTACHMENT_DIRECTIVE);
  }

  if (hasImageGeneration) {
    promptMessages = mergeSystemMessage(promptMessages, IMAGE_TOOL_LATEST_REQUEST_DIRECTIVE);
  }

  promptMessages = mergeSystemMessage(promptMessages, MERMAID_DIAGRAM_DIRECTIVE);
  promptMessages = mergeSystemMessage(promptMessages, MARKDOWN_FORMATTING_RULES);

  let timelineSortOrder = 0;

  if (input.research) {
    promptMessages = mergeSystemMessage(promptMessages, buildResearchDirective(input.research.plan));
    if (input.research.plan?.length) {
      const detail = formatResearchPlan(input.research.plan);
      const handle = await input.onActionStart?.({ kind: "research_plan", label: "Research plan", detail });
      timelineSortOrder += 1;
      await input.onActionComplete?.(typeof handle === "string" ? handle : undefined, { detail });
    }
  }

  const commitAnswerSegment = async (segment: string) => {
    if (!segment) return;
    if (input.onAnswerSegment) {
      await input.onAnswerSegment(segment);
    }
  };

  for (let step = 0; step < maxSteps; step += 1) {
    assertRunning();

    if (researchCollapseThreshold !== null && estimatePromptTokens(promptMessages) > researchCollapseThreshold) {
      promptMessages = collapseOlderToolResults(promptMessages);
    }

    const restrictToGenerateImage =
      !imageGenerationToolConsumed &&
      !imageGenerationToolAttempted &&
      imageGenerationIntentRetries === 0 &&
      hasImageGeneration &&
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
      memoriesRigor: input.memoriesRigor,
      webSearchEnabled: hasWebSearch,
      webSearchPipelineMode: hasWebSearch ? webSearchPipeline.mode : undefined,
      imageGenerationProviderId: input.appSettings?.imageGeneration.providerId,
      imageGenerationToolEnabled: !imageGenerationToolConsumed,
      restrictToGenerateImage,
      effectiveVisionMode,
      visionToolEnabled:
        effectiveVisionMode === "provider" &&
        input.visionProfile !== undefined &&
        !getProviderReadinessError(input.visionProfile),
      botTeam: input.botTeam,
      botWorkspaceSkillsEnabled: input.botWorkspaceSkillsEnabled,
      semanticRecallAvailable: Boolean(input.memoryUserId) && isSemanticRecallAvailable()
    });

    const providerPromptMessages = appendTrailingGuidance(
      prepareProviderPromptMessages({
        promptMessages,
        settings: input.settings,
        visionMcpServers
      }),
      buildDynamicSkillsSegment(turnSkills, input.botWorkspaceSkillsEnabled)
    );

    const buildProviderStream = () =>
      streamProviderResponse({
        settings: input.settings,
        promptMessages: providerPromptMessages,
        tools: tools.length ? tools : undefined,
        abortSignal: input.abortSignal,
        conversationId: input.conversationId,
        runtimeToolContext: {
          settings: input.settings,
          visionProfile: input.visionProfile,
          appSettings: input.appSettings,
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          promptMessages,
          mcpToolSets: input.mcpToolSets,
          skills: turnSkills,
          loadedSkillIds,
          memoriesEnabled: input.memoriesEnabled ?? false,
          effectiveVisionMode,
          memoryUserId: input.memoryUserId,
          imageGenerationToolEnabled: !imageGenerationToolConsumed,
          restrictToGenerateImage,
          imageGenerationActionHandle: visibleImageActionHandle,
          hasVisibleImageGenerationAction: visibleImageActionStarted,
          onActionStart: input.onActionStart,
          onActionComplete: input.onActionComplete,
          onActionError: input.onActionError,
          mcpTimeout: input.mcpTimeout,
          abortSignal: input.abortSignal
        }
      });
    const providerStream =
      input.enableStreamRetry && getProviderAdapter(input.settings.providerKind).supportsStreamRetry
        ? withStreamRetry(buildProviderStream, { signal: input.abortSignal })
        : buildProviderStream();

    let answer = "";
    let thinking = "";
    let reasoningSignature: string | undefined;
    let responseItems: ProviderResponseItem[] | undefined;
    let usage: Usage = {};
    let toolCalls: ProviderToolCall[] = [];

    while (true) {
      let next: Awaited<ReturnType<typeof providerStream.next>>;
      try {
        next = await providerStream.next();
      } catch (error) {
        if (input.abortSignal?.aborted) {
          throw new ChatTurnStoppedError();
        }
        throw error;
      }
      if (next.done) {
        answer = next.value.answer;
        thinking = next.value.thinking;
        reasoningSignature = next.value.reasoningSignature;
        responseItems = next.value.responseItems;
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
        !imageGenerationToolAttempted &&
        imageGenerationIntentRetries < 1 &&
        hasImageGeneration &&
        hasUnfulfilledImageGenerationIntent(promptMessages)
      ) {
        imageGenerationIntentRetries += 1;
        input.onEvent?.({ type: "answer_reset" });
        promptMessages = mergeSystemMessage(promptMessages, IMAGE_TOOL_REQUIRED_DIRECTIVE);
        continue;
      }

      if ((input.memoriesEnabled ?? false) && hasUnfulfilledMemoryIntent(answer)) {
        if (memoryIntentRetries < 1) {
          memoryIntentRetries += 1;
          input.onEvent?.({ type: "answer_reset" });
          promptMessages = mergeSystemMessage(
            promptMessages,
            "Do not say that you saved, stored, remembered, updated, or deleted a memory unless you actually call the corresponding memory tool in that same response. If a memory proposal is warranted, call the memory tool now. Otherwise, answer normally without mentioning memory-saving."
          );
          continue;
        }
      }

      if (!answer.trim()) {
        if (emptyAnswerRetries < 1) {
          emptyAnswerRetries += 1;
          input.onEvent?.({ type: "answer_reset" });
          promptMessages = mergeSystemMessage(
            promptMessages,
            "Your previous response was empty. Answer the user directly. Do not emit an empty response."
          );
          continue;
        }
        throw new Error("Provider returned an empty response");
      }
      await commitAnswerSegment(answer);
      return { answer, thinking, usage };
    }

    const isProposalFinalStep =
      Boolean(answer.trim()) &&
      toolCalls.every((toolCall) => isProposalToolCall(toolCall.name));

    if (isProposalFinalStep || (input.research && answer.trim())) {
      await commitAnswerSegment(answer);
    } else {
      input.onEvent?.({ type: "answer_reset" });
    }

    promptMessages = [
      ...promptMessages,
      {
        role: "assistant",
        content: answer,
        reasoningContent: thinking || undefined,
        reasoningSignature,
        toolCalls,
        responseItems
      }
    ];

    if (step === maxSteps - 1) {
      const forcedResult = await forceDirectAnswerAfterToolLoop({
        settings: input.settings,
        promptMessages,
        visionMcpServers,
        conversationId: input.conversationId,
        abortSignal: input.abortSignal,
        enableStreamRetry: input.enableStreamRetry,
        onEvent: input.onEvent,
        onAnswerSegment: input.onAnswerSegment,
        directive: input.research ? RESEARCH_FINAL_ANSWER_DIRECTIVE : undefined
      });

      return { answer: forcedResult.answer, thinking: forcedResult.thinking, usage: forcedResult.usage };
    }

    let imageGenerationToolAttemptedThisStep = false;

    const runToolCall = (toolCall: ProviderToolCall, sortOrder: number) =>
      executeToolCall(toolCall, {
        input: {
          ...toolRuntimeInput,
          imageGenerationActionHandle: visibleImageActionHandle,
          hasVisibleImageGenerationAction: visibleImageActionStarted
        },
        mcpServers,
        loadedSkillIds,
        successfulReadOnlyToolResults,
        timelineSortOrder: sortOrder,
        promptMessages,
        memoryUserId: input.memoryUserId
      });

    const stepIsFullyParallelizable =
      toolCalls.length > 1 && toolCalls.every((toolCall) => parallelizableToolNames.has(toolCall.name));

    if (stepIsFullyParallelizable) {
      assertRunning();
      const baseSortOrder = timelineSortOrder;
      const settled = await Promise.allSettled(
        toolCalls.map((toolCall, index) => runToolCall(toolCall, baseSortOrder + index))
      );
      assertRunning();
      const rejection = settled.find(
        (entry): entry is PromiseRejectedResult => entry.status === "rejected"
      );
      if (rejection) throw rejection.reason;
      promptMessages = [
        ...promptMessages,
        ...settled.flatMap((entry) => {
          const result = (entry as PromiseFulfilledResult<{
            nextSortOrder: number;
            promptMessages: PromptMessage[];
          }>).value;
          return result.promptMessages.slice(promptMessages.length);
        })
      ];
      timelineSortOrder = baseSortOrder + toolCalls.length;

      const anyWebSearchSucceeded = settled.some((entry, index) => {
        if (toolCalls[index].name !== "web_search") return false;
        return entry.status === "fulfilled" && Boolean((entry as PromiseFulfilledResult<{ toolSucceeded?: boolean }>).value.toolSucceeded);
      });
      if (anyWebSearchSucceeded && !webSearchDirectiveAdded && !input.research) {
        webSearchDirectiveAdded = true;
        promptMessages = mergeSystemMessage(promptMessages, WEB_SEARCH_RESULTS_SUFFICIENT_DIRECTIVE);
      }
    } else {
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
          imageGenerationToolAttempted = true;
        }

        const result = await runToolCall(toolCall, timelineSortOrder);
        assertRunning();

        timelineSortOrder = result.nextSortOrder;
        promptMessages = result.promptMessages;

        if (toolCall.name === "web_search" && result.toolSucceeded && !webSearchDirectiveAdded && !input.research) {
          webSearchDirectiveAdded = true;
          promptMessages = mergeSystemMessage(promptMessages, WEB_SEARCH_RESULTS_SUFFICIENT_DIRECTIVE);
        }

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
    }

    if (isProposalFinalStep) {
      return { answer, thinking, usage };
    }
  }

  throw new Error("Assistant exceeded the maximum number of tool steps");
}
