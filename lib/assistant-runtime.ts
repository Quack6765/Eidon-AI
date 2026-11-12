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
import { getSkillResolvedName, getLatestUserPromptContent, shouldAddInlineAttachmentDirective, filterSkillsForTurn, hasUnfulfilledMemoryIntent } from "./prompt-analysis";
import {
  BOT_AUTHORED_PROMPT_PREFIX,
  EMPTY_ANSWER_RETRY_DIRECTIVE,
  IMAGE_TOOL_POST_SUCCESS_DIRECTIVE,
  INLINE_ATTACHMENT_DIRECTIVE,
  MEMORY_INTENT_RETRY_DIRECTIVE,
  WEB_SEARCH_RESULTS_SUFFICIENT_DIRECTIVE,
  appendSystemCapabilitySegments,
  buildBotMentionDirective,
  buildDynamicSkillsSegment,
  buildForcedAnswerPromptMessages,
  buildInvokedSkillsDirective,
  buildStepPromptMessages,
  extractImageAttachments,
  getEffectiveVisionMode,
  splitLateSystemMessages
} from "./prompt-assembly";
import { type ToolSet, mcpToolFunctionName } from "./tool-definitions";
import { type RuntimeAction, type SuccessfulReadOnlyToolResult, buildToolResultMessage } from "./tool-lifecycle";
import { buildToolDefinitions, executeToolCall } from "./tool-registry";
import { loadSkillIntoTurn } from "./tool-executors";
import { getToolTraits, isProposalToolCall, toolNamesWithTrait } from "./tool-traits";
import { findReferencedNames } from "./reference-tokens";
import type {
  ChatStreamEvent,
  McpServer,
  MemoryRigor,
  ProviderResponseItem,
  RuntimeProviderProfile,
  ProviderToolCall,
  PromptMessage,
  Skill,
  ToolApprovalContext,
  VisionMode
} from "@/lib/types";

export type { ToolSet } from "./tool-definitions";
export type { RuntimeAction, SuccessfulReadOnlyToolResult } from "./tool-lifecycle";
export { getLatestUserPromptContent, getLatestUserPromptIndex, shouldAddInlineAttachmentDirective, filterSkillsForTurn, hasUnfulfilledMemoryIntent } from "./prompt-analysis";

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

async function forceDirectAnswerAfterToolLoop(input: {
  settings: RuntimeProviderProfile;
  promptMessages: PromptMessage[];
  visionMcpServers?: McpServer[];
  conversationId?: string;
  abortSignal?: AbortSignal;
  enableStreamRetry?: boolean;
  onEvent?: (event: ChatStreamEvent) => void;
  onAnswerSegment?: (segment: string) => Promise<void> | void;
  guidance: string[];
  directive?: string;
}) {
  const providerPromptMessages = buildForcedAnswerPromptMessages({
    promptMessages: input.promptMessages,
    settings: input.settings,
    visionMcpServers: input.visionMcpServers,
    guidance: input.guidance,
    directive: input.directive
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

    await input.onEvent?.(next.value);
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
  toolApproval?: ToolApprovalContext;
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
  delegationChain?: import("@/lib/types").DelegationChain;
  botTeam?: {
    isChief: boolean;
    roster: import("@/lib/bots").BotRosterEntry[];
  };
  botWorkspaceSkillsEnabled?: boolean;
  skillManageEnabled?: boolean;
  toolAllowlist?: string[];
  research?: import("@/lib/types").ChatResearchOptions;
  takeRedirect?: () => Promise<{ content: string; assistantMessageId: string } | null>;
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

  const split = splitLateSystemMessages(input.promptMessages);
  let promptMessages = split.promptMessages;
  const turnGuidance: string[] = [...split.guidance];

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
    const visionReadinessError = getProviderReadinessError(input.visionProfile, input.memoryUserId ?? null);
    if (visionReadinessError) {
      throw new Error(visionReadinessError);
    }
  }

  const turnSkills = filterSkillsForTurn(input.skills, promptMessages, {
    includeBrowserSkills: Boolean(input.research) || Boolean(input.botTeam)
  });
  const toolRuntimeInput = {
    ...input,
    skills: turnSkills
  };
  const loadedSkillIds = new Set<string>();
  const successfulReadOnlyToolResults = new Map<string, SuccessfulReadOnlyToolResult>();

  const parallelizableToolNames = toolNamesWithTrait("parallelizable");
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
  let memoryIntentRetries = 0;
  let emptyAnswerRetries = 0;

  const hasWebSearch = Boolean(
    input.appSettings && input.appSettings.webSearch.providerId !== "disabled"
  );
  const webSearchPipeline = getWebSearchPipeline(input.appSettings?.webSearch.configuration);
  const parallelWebSearch = hasWebSearch && webSearchPipeline.mode !== "off";
  const hasImageGeneration = Boolean(
    input.appSettings && input.appSettings.imageGeneration.providerId !== "disabled"
  );

  promptMessages = appendSystemCapabilitySegments({
    promptMessages,
    skills: input.skills,
    mcpServers,
    mcpToolSets: input.mcpToolSets,
    hasWebSearch,
    parallelWebSearch,
    hasImageGeneration,
    effectiveVisionMode
  });

  if (shouldAddInlineAttachmentDirective(promptMessages)) {
    turnGuidance.push(INLINE_ATTACHMENT_DIRECTIVE);
  }

  let timelineSortOrder = 0;

  if (input.research) {
    turnGuidance.push(buildResearchDirective(input.research.plan));
    if (input.research.plan?.length) {
      const detail = formatResearchPlan(input.research.plan);
      const handle = await input.onActionStart?.({ kind: "research_plan", label: "Research plan", detail });
      timelineSortOrder += 1;
      await input.onActionComplete?.(typeof handle === "string" ? handle : undefined, { detail });
    }
  }

  const applyComposerReferences = async (userContent: string) => {
    const invokedSkillNames = findReferencedNames(
      userContent,
      "/",
      turnSkills.map((skill) => getSkillResolvedName(skill))
    ).map((name) => name.toLowerCase());
    const invokedSkillContents: string[] = [];
    for (const skill of turnSkills) {
      if (loadedSkillIds.has(skill.id) || !invokedSkillNames.includes(getSkillResolvedName(skill).toLowerCase())) continue;
      invokedSkillContents.push(await loadSkillIntoTurn(skill, input, loadedSkillIds));
      timelineSortOrder += 1;
    }
    if (invokedSkillContents.length) {
      turnGuidance.push(buildInvokedSkillsDirective(invokedSkillContents));
    }

    if (input.botTeam && !userContent.startsWith(BOT_AUTHORED_PROMPT_PREFIX)) {
      const mentionedBots = findReferencedNames(
        userContent,
        "@",
        input.botTeam.roster.map((entry) => entry.name)
      );
      if (mentionedBots.length) {
        turnGuidance.push(buildBotMentionDirective(mentionedBots));
      }
    }
  };

  await applyComposerReferences(getLatestUserPromptContent(promptMessages));

  const commitAnswerSegment = async (segment: string) => {
    if (!segment) return;
    if (input.onAnswerSegment) {
      await input.onAnswerSegment(segment);
    }
  };

  const applyRedirect = async (answeredMessage?: PromptMessage) => {
    const redirect = await input.takeRedirect?.();
    if (!redirect) return false;
    toolRuntimeInput.assistantMessageId = redirect.assistantMessageId;
    promptMessages = [
      ...promptMessages,
      ...(answeredMessage ? [answeredMessage] : []),
      { role: "user", content: redirect.content }
    ];
    await applyComposerReferences(redirect.content);
    return true;
  };

  for (let step = 0; step < maxSteps; step += 1) {
    assertRunning();

    if (step > 0 && (await applyRedirect())) {
      step = 0;
    }

    if (researchCollapseThreshold !== null && estimatePromptTokens(promptMessages) > researchCollapseThreshold) {
      promptMessages = collapseOlderToolResults(promptMessages);
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
      effectiveVisionMode,
      visionToolEnabled:
        effectiveVisionMode === "provider" &&
        input.visionProfile !== undefined &&
        !getProviderReadinessError(input.visionProfile, input.memoryUserId ?? null),
      botTeam: input.botTeam,
      botWorkspaceSkillsEnabled: input.botWorkspaceSkillsEnabled,
      skillManageEnabled: input.skillManageEnabled,
      toolAllowlist: input.toolAllowlist,
      semanticRecallAvailable: Boolean(input.memoryUserId) && isSemanticRecallAvailable()
    });

    const providerPromptMessages = buildStepPromptMessages({
      promptMessages,
      settings: input.settings,
      visionMcpServers,
      skills: turnSkills,
      skillManageEnabled: input.skillManageEnabled,
      turnGuidance
    });

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
          assistantMessageId: toolRuntimeInput.assistantMessageId,
          promptMessages,
          mcpToolSets: input.mcpToolSets,
          skills: turnSkills,
          loadedSkillIds,
          memoriesEnabled: input.memoriesEnabled ?? false,
          effectiveVisionMode,
          memoryUserId: input.memoryUserId,
          toolApproval: input.toolApproval,
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
      await input.onEvent?.(next.value);
    }

    assertRunning();

    if (!toolCalls.length) {
      if ((input.memoriesEnabled ?? false) && hasUnfulfilledMemoryIntent(answer)) {
        if (memoryIntentRetries < 1) {
          memoryIntentRetries += 1;
          await input.onEvent?.({ type: "answer_reset" });
          turnGuidance.push(MEMORY_INTENT_RETRY_DIRECTIVE);
          continue;
        }
      }

      if (!answer.trim()) {
        if (emptyAnswerRetries < 1) {
          emptyAnswerRetries += 1;
          await input.onEvent?.({ type: "answer_reset" });
          turnGuidance.push(EMPTY_ANSWER_RETRY_DIRECTIVE);
          continue;
        }
        throw new Error("Provider returned an empty response");
      }
      await commitAnswerSegment(answer);
      if (
        await applyRedirect({
          role: "assistant",
          content: answer,
          reasoningContent: thinking || undefined,
          reasoningSignature,
          responseItems
        })
      ) {
        step = -1;
        continue;
      }
      return { answer, thinking, usage };
    }

    const isProposalFinalStep =
      Boolean(answer.trim()) &&
      toolCalls.every((toolCall) => isProposalToolCall(toolCall.name));

    if (answer.trim()) {
      await commitAnswerSegment(answer);
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
        guidance: [buildDynamicSkillsSegment(turnSkills, input.skillManageEnabled), ...turnGuidance],
        directive: input.research ? RESEARCH_FINAL_ANSWER_DIRECTIVE : undefined
      });

      return { answer: forcedResult.answer, thinking: forcedResult.thinking, usage: forcedResult.usage };
    }

    let imageGenerationToolAttemptedThisStep = false;

    const runToolCall = (toolCall: ProviderToolCall, sortOrder: number) =>
      executeToolCall(toolCall, {
        input: toolRuntimeInput,
        loadedSkillIds,
        successfulReadOnlyToolResults,
        timelineSortOrder: sortOrder,
        promptMessages,
        memoryUserId: input.memoryUserId
      });

    const toolCallGroups: ProviderToolCall[][] = [];
    for (const toolCall of toolCalls) {
      const lastGroup = toolCallGroups[toolCallGroups.length - 1];
      if (lastGroup && parallelizableToolNames.has(toolCall.name) && parallelizableToolNames.has(lastGroup[0].name)) {
        lastGroup.push(toolCall);
      } else {
        toolCallGroups.push([toolCall]);
      }
    }

    for (const group of toolCallGroups) {
      assertRunning();
      const [firstToolCall] = group;

      if (getToolTraits(firstToolCall.name).oncePerTurn) {
        if (imageGenerationToolConsumed || imageGenerationToolAttemptedThisStep) {
          promptMessages = [
            ...promptMessages,
            buildToolResultMessage(
              firstToolCall.id,
              "Error: generate_image can only be called once per assistant turn. Respond to the user with the generated result instead."
            )
          ];
          continue;
        }

        imageGenerationToolAttemptedThisStep = true;
      }

      const baseSortOrder = timelineSortOrder;
      const settled = await Promise.allSettled(
        group.map((toolCall, index) => runToolCall(toolCall, baseSortOrder + index))
      );
      assertRunning();
      const rejection = settled.find(
        (entry): entry is PromiseRejectedResult => entry.status === "rejected"
      );
      if (rejection) throw rejection.reason;

      const results = settled.map(
        (entry) =>
          (entry as PromiseFulfilledResult<Awaited<ReturnType<typeof runToolCall>>>).value
      );
      const promptLengthBeforeGroup = promptMessages.length;
      promptMessages = [
        ...promptMessages,
        ...results.flatMap((result) => result.promptMessages.slice(promptLengthBeforeGroup))
      ];
      timelineSortOrder = group.length === 1 ? results[0].nextSortOrder : baseSortOrder + group.length;

      const anyWebSearchSucceeded = group.some(
        (toolCall, index) =>
          getToolTraits(toolCall.name).postSuccessGuidance === "web-search" &&
          Boolean(results[index].toolSucceeded)
      );
      if (anyWebSearchSucceeded && !webSearchDirectiveAdded && !input.research) {
        webSearchDirectiveAdded = true;
        turnGuidance.push(WEB_SEARCH_RESULTS_SUFFICIENT_DIRECTIVE);
      }

      if (getToolTraits(firstToolCall.name).postSuccessGuidance === "image-generation" && results[0].toolSucceeded) {
        imageGenerationToolConsumed = true;
        turnGuidance.push(IMAGE_TOOL_POST_SUCCESS_DIRECTIVE);
      }
    }

    if (isProposalFinalStep) {
      if (await applyRedirect()) {
        step = -1;
        continue;
      }
      return { answer, thinking, usage };
    }
  }

  throw new Error("Assistant exceeded the maximum number of tool steps");
}
