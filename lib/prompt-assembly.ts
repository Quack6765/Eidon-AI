import { appendDeliveredFileLinks } from "@/lib/assistant-local-attachments";
import { resolveAttachmentPath } from "@/lib/attachments";
import { isEmptyStreamingAssistantPlaceholder } from "@/lib/compaction-turns";
import { MAX_ATTACHMENT_TEXT_RATIO, MAX_BASELINE_IMAGES, MAX_PROMPT_IMAGES } from "@/lib/constants";
import { listMemoriesForPrompt } from "@/lib/memories";
import { buildMemorySystemGuidance } from "@/lib/memory-guidance";
import { buildAutomationProposalGuidance } from "@/lib/automation-guidance";
import { env } from "@/lib/env";
import { isVisibleMessage, listMessages } from "@/lib/conversations";
import { renderMemoryNode } from "@/lib/compaction-memory-nodes";
import { buildToolResultMessage } from "@/lib/tool-lifecycle";
import { describeMessageDraftForPrompt } from "@/lib/message-draft-display";
import { MARKDOWN_FORMATTING_RULES } from "@/lib/markdown/formatting-rules-prompt";
import { getSkillResolvedName, getSkillResolvedDescription } from "@/lib/prompt-analysis";
import { isLibrarySkillId } from "@/lib/skill-library";
import type { ToolSet } from "@/lib/tool-definitions";
import {
  buildUserPromptContent,
  getLatestUserMessageIndex,
  getMostRecentAssistantImageAttachments
} from "@/lib/compaction-prompt-building";
import type {
  McpServer,
  MemoryNode,
  MemoryRigor,
  Message,
  MessageAction,
  MessageAttachment,
  PromptMessage,
  RuntimeProviderProfile,
  Skill,
  UserMemory,
  VisionMode
} from "@/lib/types";

export const IMAGE_TOOL_LATEST_REQUEST_DIRECTIVE =
  "When calling generate_image, Base the prompt and count on only the latest user image request. Treat each new image request as independent by default. Do not combine earlier image requests or count them again unless the latest user message explicitly asks to modify, continue, or combine prior results.";
export const IMAGE_TOOL_POST_SUCCESS_DIRECTIVE =
  "Image generation is available in this environment and a generated image is already attached in this turn. Do not claim that image generation is unavailable. Refer to the generated image result directly, do not call generate_image again in this turn, and do not embed markdown image tags or local file links in your response.";
export const WEB_SEARCH_RESULTS_SUFFICIENT_DIRECTIVE =
  "Web search results have been received in this turn. Answer the user now by synthesizing the results above, or call read_page on the most relevant result URLs when the snippets are insufficient. Only call web_search again if the results clearly cannot answer the question — never to re-run or refine similar queries, and never for additional confirmation. Users wait while you search, so prefer answering from what you already have.";
export const IMAGE_TOOL_POLICY_DIRECTIVE =
  "Images are produced only when the conversation calls for one: an explicit request from the user, or a follow-up that revises an image generated earlier (including short corrections like 'No, use a pixel theme.'). Never generate decorative, celebratory, summary, chart, or completion images, and never call generate_image to visualize results — use mermaid code blocks for diagrams. If the user has told you not to generate images, obey that until they ask for one. If you are unsure whether the user wants an image, ask instead of generating.";
export const INLINE_ATTACHMENT_DIRECTIVE =
  "When you create or capture an image file, rely on the runtime attachment flow. Do not run base64 on screenshot/image files. Do not embed data: image URLs in your visible response.";
export const NON_NATIVE_VISION_DIRECTIVE =
  "The current model configuration cannot inspect attached images directly in this turn. Attached images were provided only as text placeholders. Do not claim to have viewed image contents directly. If image analysis is required, explain the limitation or use the configured vision MCP server when available.";
export const MEMORY_INTENT_RETRY_DIRECTIVE =
  "Do not say that you saved, stored, remembered, updated, or deleted a memory unless you actually call the corresponding memory tool in that same response. If the fact is durable and would still matter in an unrelated future conversation, call the memory tool now — the call is the offer, so do not ask for permission in words first. If it only matters in this conversation, drop the claim, propose nothing, and answer normally without mentioning memory.";
export const EMPTY_ANSWER_RETRY_DIRECTIVE =
  "Your previous response was empty. Answer the user directly. Do not emit an empty response.";
export const FORCED_DIRECT_ANSWER_DIRECTIVE =
  "Stop using tools now. Answer the user directly from the information already gathered. Do not call any more tools.";
const PARALLEL_TOOL_CALLS_DIRECTIVE = [
  "<use_parallel_tool_calls>",
  "If you intend to call multiple tools and there are no dependencies between the tool calls, make all of the independent tool calls in the same step. Prioritize calling tools simultaneously whenever the actions can be done in parallel rather than sequentially. For example, when reading 3 pages, make 3 read_page calls at the same time. Read-only tools run concurrently; tools that change state run one at a time in the order you emit them.",
  "However, if some tool calls depend on previous calls to inform dependent values, do NOT call these tools in parallel and instead call them sequentially. Never use placeholders or guess missing parameters in tool calls.",
  "</use_parallel_tool_calls>"
].join("\n");
const MERMAID_DIAGRAM_DIRECTIVE =
  "When you need to present diagrams (flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, Gantt charts, pie charts, mind maps, or any other diagram type), use mermaid.js syntax inside a fenced code block with the `mermaid` language identifier. For example:\n\n```mermaid\ngraph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Success]\n    B -->|No| D[Try Again]\n```\n\nAlways prefer mermaid diagrams over ASCII art or text-based diagrams.";

export const BOT_AUTHORED_PROMPT_PREFIX = "[Message from ";

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
            "When one question spans multiple facets, pass several distinct queries in a single web_search call (queries) — they execute in parallel, so one call is usually enough."
          ]
        : [
            "If you can answer confidently and accurately from your training data, do so without searching."
          ])
    );
  }

  return lines.join("\n");
}

export function buildDynamicSkillsSegment(skills: Skill[], skillManageEnabled = false) {
  if (!skills.length && !skillManageEnabled) return "";

  const lines: string[] = [];

  if (skills.length) {
    lines.push("Available skills (metadata only — call load_skill to get full instructions):");
    for (const skill of skills) {
      const marker = isLibrarySkillId(skill.id) ? " (shared)" : "";
      const state = skill.state === "archived" ? " [archived]" : skill.state === "stale" ? " [stale]" : "";
      lines.push(`- ${getSkillResolvedName(skill)}${marker}${state}: ${getSkillResolvedDescription(skill)}`);
    }
    if (skillManageEnabled) {
      lines.push(
        "Skills marked (shared) live in this team's shared library — every agent here reads and writes the same skills.",
        "When the user asks you to learn, capture, or save a workflow as a skill, load the skill-authoring skill first and follow it.",
        "With skill_manage, prefer patching a loaded skill over patching an umbrella, over adding a support file, over creating a new skill. Creation is the last resort."
      );
    }
  } else {
    lines.push(
      "No skills are available yet. With skill_manage you can create reusable skills in this team's shared library; they become available via load_skill in future turns.",
      "When the user asks you to learn, capture, or save a workflow as a skill, load the skill-authoring skill first and follow it."
    );
  }

  return lines.join("\n");
}

export function buildInvokedSkillsDirective(loadedSkills: string[]) {
  return [
    "The user invoked the skills below with / for this message. Their full instructions are already loaded: follow them for this request and do not call load_skill for them again.",
    ...loadedSkills
  ].join("\n\n");
}

export function buildBotMentionDirective(botNames: string[]) {
  const mentions = botNames.map((name) => `@${name}`).join(", ");
  return [
    `The user addressed this message to ${mentions}.`,
    "Hand the request off with message_bot instead of doing the work yourself: one call per mentioned bot, each with the part of the request meant for that bot and the context it needs.",
    "Then briefly tell the user who you handed it to. Their replies arrive in this conversation."
  ].join(" ");
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

export function extractImageAttachments(promptMessages: PromptMessage[]): Array<{ id: string; filename: string; absolutePath: string }> {
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

function appendTrailingGuidance(promptMessages: PromptMessage[], guidance: string[]): PromptMessage[] {
  const content = guidance.filter(Boolean).join("\n\n");
  if (!content) return promptMessages;
  return [...promptMessages, { role: "user", content, volatile: true }];
}

export function splitLateSystemMessages(promptMessages: PromptMessage[]) {
  const systemIndex = promptMessages.findIndex((message) => message.role === "system");
  const late = promptMessages.filter((message, index) => message.role === "system" && index !== systemIndex);
  return {
    promptMessages: promptMessages.filter((message) => !late.includes(message)),
    guidance: late.map((message) => (typeof message.content === "string" ? message.content : ""))
  };
}

export function getEffectiveVisionMode(
  settings: RuntimeProviderProfile,
  hasVisionServers: boolean
): VisionMode {
  if (settings.visionMode === "native") {
    return "native";
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
}): { promptMessages: PromptMessage[]; guidance: string[] } {
  const imageAttachments = extractImageAttachments(input.promptMessages);
  if (imageAttachments.length === 0) {
    return { promptMessages: input.promptMessages, guidance: [] };
  }

  const visionServers = input.visionMcpServers ?? [];
  const effectiveVisionMode = getEffectiveVisionMode(input.settings, visionServers.length > 0);
  if (effectiveVisionMode === "native") {
    return { promptMessages: input.promptMessages, guidance: [] };
  }

  const providerPromptMessages = replaceImagesWithTextPlaceholders(input.promptMessages);

  if (effectiveVisionMode === "mcp" && visionServers.length > 0) {
    return {
      promptMessages: providerPromptMessages,
      guidance: [buildVisionMcpDirective(visionServers, imageAttachments)]
    };
  }

  if (effectiveVisionMode === "provider") {
    return {
      promptMessages: providerPromptMessages,
      guidance: [buildProviderVisionDirective(imageAttachments)]
    };
  }

  return { promptMessages: providerPromptMessages, guidance: [NON_NATIVE_VISION_DIRECTIVE] };
}

export function appendSystemCapabilitySegments(input: {
  promptMessages: PromptMessage[];
  skills: Skill[];
  mcpServers: McpServer[];
  mcpToolSets: ToolSet[];
  hasWebSearch: boolean;
  parallelWebSearch: boolean;
  hasImageGeneration: boolean;
  effectiveVisionMode: VisionMode;
}): PromptMessage[] {
  const visibleMcpServers = input.mcpServers.filter(
    (server) => !(server.isVisionMcp && input.effectiveVisionMode !== "mcp")
  );

  const systemSegments: string[] = [];

  if (input.skills.length || visibleMcpServers.length || input.mcpToolSets.length) {
    systemSegments.push(
      buildCapabilitiesStableSegment(
        visibleMcpServers,
        input.hasWebSearch,
        input.parallelWebSearch,
        new Set(
          input.mcpToolSets
            .filter((toolSet) => toolSet.authRequired)
            .map((toolSet) => toolSet.server.id)
        )
      )
    );
  }

  if (input.hasImageGeneration) {
    systemSegments.push(IMAGE_TOOL_POLICY_DIRECTIVE, IMAGE_TOOL_LATEST_REQUEST_DIRECTIVE);
  }

  systemSegments.push(PARALLEL_TOOL_CALLS_DIRECTIVE, MERMAID_DIAGRAM_DIRECTIVE, MARKDOWN_FORMATTING_RULES);

  const systemIndex = input.promptMessages.findIndex((message) => message.role === "system");
  return systemIndex === -1
    ? [{ role: "system", content: systemSegments.join("\n\n") }, ...input.promptMessages]
    : input.promptMessages.map((message, index) =>
        index === systemIndex ? { ...message, content: `${message.content}\n\n${systemSegments.join("\n\n")}` } : message
      );
}

export function buildStepPromptMessages(input: {
  promptMessages: PromptMessage[];
  settings: RuntimeProviderProfile;
  visionMcpServers?: McpServer[];
  skills: Skill[];
  skillManageEnabled?: boolean;
  turnGuidance: string[];
}): PromptMessage[] {
  const prepared = prepareProviderPromptMessages({
    promptMessages: input.promptMessages,
    settings: input.settings,
    visionMcpServers: input.visionMcpServers
  });
  return appendTrailingGuidance(prepared.promptMessages, [
    buildDynamicSkillsSegment(input.skills, input.skillManageEnabled),
    ...input.turnGuidance,
    ...prepared.guidance
  ]);
}

export function buildForcedAnswerPromptMessages(input: {
  promptMessages: PromptMessage[];
  settings: RuntimeProviderProfile;
  visionMcpServers?: McpServer[];
  guidance: string[];
  directive?: string;
}): PromptMessage[] {
  const prepared = prepareProviderPromptMessages({
    promptMessages: input.promptMessages,
    settings: input.settings,
    visionMcpServers: input.visionMcpServers
  });
  return appendTrailingGuidance(prepared.promptMessages, [
    ...input.guidance,
    ...prepared.guidance,
    input.directive ?? FORCED_DIRECT_ANSWER_DIRECTIVE
  ]);
}

export const MAX_TOOL_RESULT_CHARS = 8000;
const REPLAYABLE_TOOL_ACTION_KINDS = new Set<MessageAction["kind"]>(["mcp_tool_call", "shell_command", "image_generation"]);

function collectReplayableActions(actions: MessageAction[] | undefined): MessageAction[] {
  return (actions ?? [])
    .filter(
      (action) =>
        action.kind === "draft_message" ||
        (REPLAYABLE_TOOL_ACTION_KINDS.has(action.kind) &&
          action.status === "completed" &&
          action.resultSummary.trim().length > 0)
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function getReplayedToolResult(action: MessageAction) {
  return action.kind === "draft_message" ? describeMessageDraftForPrompt(action) : action.resultSummary;
}

function toProviderToolCall(action: MessageAction) {
  return {
    id: action.id,
    name: action.toolName ??
      (action.kind === "shell_command"
        ? "execute_shell_command"
        : action.kind === "image_generation"
          ? "generate_image"
          : action.label),
    arguments: JSON.stringify(action.arguments ?? {})
  };
}

function truncateToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[…truncated]`;
}

function getStoredAssistantImageAttachments(
  conversationId: string,
  conversationMessages?: Message[]
): MessageAttachment[] {
  try {
    const messages = conversationMessages ?? listMessages(conversationId);
    return getMostRecentAssistantImageAttachments(messages, getLatestUserMessageIndex(messages));
  } catch {
    return [];
  }
}

function resolveBaselineImages(
  input: { messages: Message[]; conversationId?: string; conversationMessages?: Message[] },
  latestUserMessageIndex: number
): MessageAttachment[] {
  const fromPrompt = getMostRecentAssistantImageAttachments(input.messages, latestUserMessageIndex);
  const baseline = fromPrompt.length
    ? fromPrompt
    : input.conversationId
      ? getStoredAssistantImageAttachments(input.conversationId, input.conversationMessages)
      : [];
  return baseline.slice(0, MAX_BASELINE_IMAGES);
}

function selectPromptImageIds(
  messages: Message[],
  baselineImages: MessageAttachment[]
): Set<string> {
  const included = new Set<string>(baselineImages.map((attachment) => attachment.id));

  for (let index = messages.length - 1; index >= 0 && included.size < MAX_PROMPT_IMAGES; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;

    for (const attachment of message.attachments ?? []) {
      if (attachment.kind !== "image") continue;
      included.add(attachment.id);
      if (included.size >= MAX_PROMPT_IMAGES) break;
    }
  }

  return included;
}

export function buildPromptMessages(input: {
  systemPrompt: string;
  personaContent?: string;
  conversationId?: string;
  messages: Message[];
  conversationMessages?: Message[];
  activeMemoryNodes: MemoryNode[];
  userInput?: string;
  maxAttachmentTextTokens?: number;
  memoriesEnabled?: boolean;
  memoryUserId?: string | null;
  memoryBotId?: string | null;
  memoriesRigor?: MemoryRigor;
  selectedMemories?: UserMemory[];
}): PromptMessage[] {
  const remainingAttachmentTextTokens = {
    value: input.maxAttachmentTextTokens ?? Number.POSITIVE_INFINITY
  };

  const systemParts: string[] = [input.systemPrompt];
  let recalledMemoriesBlock = "";

  if (input.personaContent?.trim()) {
    systemParts.push(input.personaContent.trim());
  }

  if (input.memoriesEnabled) {
    const memories = input.selectedMemories ?? (input.memoryUserId
      ? listMemoriesForPrompt(input.memoryUserId, input.memoryBotId ? { botId: input.memoryBotId } : undefined)
      : []);
    if (memories.length > 0) {
      recalledMemoriesBlock =
        "<memory>\n" +
        memories.map((m) => `${m.id}: [${m.category}] ${m.content}`).join("\n") +
        "\n</memory>";
    }
    systemParts.push(buildMemorySystemGuidance(input.memoriesRigor ?? "balanced"));
  }

  systemParts.push(buildAutomationProposalGuidance(env.TZ));

  if (input.activeMemoryNodes.length) {
    systemParts.push(
      "## Compacted Memory\n" + input.activeMemoryNodes
        .map((node) => renderMemoryNode(node.content))
        .join("\n\n")
    );
  }

  const visibleSystemMessages = input.messages.filter(
    (m) => m.role === "system" && m.systemKind !== "compaction_notice" && isVisibleMessage(m)
  );
  for (const msg of visibleSystemMessages) {
    systemParts.push(msg.content);
  }

  const promptMessages: PromptMessage[] = [
    { role: "system", content: systemParts.join("\n\n") }
  ];
  const latestUserMessageIndex = getLatestUserMessageIndex(input.messages);
  const baselineImages = resolveBaselineImages(input, latestUserMessageIndex);
  const includedImageIds = selectPromptImageIds(input.messages, baselineImages);

  input.messages.forEach((message, index) => {
    if (message.role === "system") return;

    if (message.role === "assistant") {
      if (message.status === "error" || isEmptyStreamingAssistantPlaceholder(message)) {
        return;
      }

      const replayableActions = collectReplayableActions(message.actions);
      const content = appendDeliveredFileLinks(message.content, message.attachments);

      if (!content.trim() && replayableActions.length === 0) {
        return;
      }

      promptMessages.push({
        role: "assistant",
        content,
        ...(replayableActions.length
          ? { toolCalls: replayableActions.map(toProviderToolCall) }
          : {})
      });

      for (const action of replayableActions) {
        promptMessages.push(
          buildToolResultMessage(action.id, truncateToolResult(getReplayedToolResult(action)))
        );
      }
      return;
    }

    promptMessages.push({
      role: "user",
      content: buildUserPromptContent(
        message,
        remainingAttachmentTextTokens,
        {
          baselineImages: index === latestUserMessageIndex ? baselineImages : [],
          includedImageIds
        }
      )
    });
  });

  if (input.userInput) {
    promptMessages.push({
      role: "user",
      content: input.userInput
    });
  }

  if (recalledMemoriesBlock) {
    promptMessages.push({ role: "system", content: recalledMemoriesBlock });
  }

  return promptMessages;
}
