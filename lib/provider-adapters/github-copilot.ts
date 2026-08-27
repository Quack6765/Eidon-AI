import { buildCopilotTools } from "@/lib/copilot-tools";
import {
  ensureFreshGithubAccessToken,
  runGithubCopilotChat,
  streamGithubCopilotChat
} from "@/lib/github-copilot";
import { listGithubCopilotModels } from "@/lib/github-copilot";
import {
  cancelGithubProviderConnectionFlow,
  createGithubProviderConnectionFlow,
  getGithubProviderConnectionFlow
} from "@/lib/provider-adapters/github-provider-connection";
import { MAX_RUNTIME_TOOL_RESULT_CHARS, truncateText } from "@/lib/bounded-text";
import { estimatePromptTokens, setActiveTokenizer } from "@/lib/tokenization";
import {
  withDateContextSystemPrompt
} from "@/lib/provider-message-formatting";
import { stripThinkingDelimiters } from "@/lib/thinking-delimiter-parsing";
import type {
  ChatStreamEvent,
  MessageAction,
  MessageActionKind,
  ReasoningEffort,
  RuntimeProviderProfile
} from "@/lib/types";
import type {
  ProviderStreamInput,
  ProviderStreamResult,
  ProviderTextInput,
  ProviderTextPurpose
} from "@/lib/provider-adapters/types";

export const githubCopilotConnectionFlows = {
  create: createGithubProviderConnectionFlow,
  get: getGithubProviderConnectionFlow,
  cancel: cancelGithubProviderConnectionFlow
};

const LOW_EFFORT_PURPOSES: ReadonlySet<ProviderTextPurpose> = new Set(["title", "web_search_planning", "speech_cleanup"]);

export async function callGithubCopilotText(input: ProviderTextInput) {
  const settings = LOW_EFFORT_PURPOSES.has(input.purpose)
    ? {
        ...input.settings,
        reasoningEffort: (input.settings.reasoningEffort === "none" ? "none" : "low") as ReasoningEffort,
        reasoningSummaryEnabled: false
      }
    : input.settings;
  const freshSettings = await ensureFreshGithubAccessToken(settings, input.abortSignal);
  const result = await runGithubCopilotChat({
    ...freshSettings,
    systemPrompt: withDateContextSystemPrompt(freshSettings.systemPrompt),
    messages: [{ role: "user", content: input.prompt }],
    abortSignal: input.abortSignal
  });
  const text = stripThinkingDelimiters(
    typeof result === "string" ? result : JSON.stringify(result)
  );
  if (!text.trim()) throw new Error("Provider returned an empty response");
  return text;
}

export async function discoverGithubCopilotModels(settings: RuntimeProviderProfile) {
  const profile = await ensureFreshGithubAccessToken(settings);
  const models = await listGithubCopilotModels(profile);
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    maxContextWindowTokens: model.capabilities?.limits?.max_context_window_tokens ?? null
  }));
}

export async function* streamGithubCopilotResponse(
  input: ProviderStreamInput
): AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void> {
  const { settings, promptMessages } = input;
  setActiveTokenizer(settings.tokenizerModel ?? "gpt-tokenizer");
  const freshSettings = await ensureFreshGithubAccessToken(settings, input.abortSignal);
  const messageTexts = promptMessages.map((m) =>
    typeof m.content === "string" ? m.content : m.content.map((p) => "text" in p ? p.text : "").join("")
  );

  type CopilotEvent = {
    type: string;
    timestamp?: string;
    data?: Record<string, unknown>;
  };
  type QueueItem = { done: true } | { event: ChatStreamEvent };

  const eventQueue: QueueItem[] = [];
  let resolveQueue: ((item: QueueItem) => void) | null = null;

  function enqueue(item: QueueItem) {
    if (resolveQueue) {
      const r = resolveQueue;
      resolveQueue = null;
      r(item);
    } else {
      eventQueue.push(item);
    }
  }

  function dequeue(): Promise<QueueItem> {
    if (eventQueue.length > 0) {
      return Promise.resolve(eventQueue.shift()!);
    }
    return new Promise<QueueItem>((resolve) => {
      resolveQueue = resolve;
    });
  }

  let answer = "";
  let thinking = "";

  const copilotTools = input.runtimeToolContext
    ? buildCopilotTools({
        ...input.runtimeToolContext,
        settings: freshSettings,
        promptMessages: input.runtimeToolContext.promptMessages ?? promptMessages
      })
    : undefined;
  const customCopilotToolNames = new Set((copilotTools ?? []).map((tool) => tool.name));
  const liveCopilotActions = new Map<string, MessageAction>();

  function summarizeCopilotArguments(args: Record<string, unknown> | undefined) {
    if (!args || !Object.keys(args).length) return "";
    const firstScalar = Object.entries(args).find(([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    );
    if (firstScalar) {
      return `${firstScalar[0]}=${String(firstScalar[1])}`;
    }
    const json = JSON.stringify(args);
    return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  }

  function inferCopilotActionKind(toolName: string): MessageActionKind {
    if (toolName === "execute_shell_command") return "shell_command";
    if (toolName === "load_skill") return "skill_load";
    if (toolName === "create_memory" || toolName === "update_memory" || toolName === "delete_memory") {
      return toolName;
    }
    return "mcp_tool_call";
  }

  const copilotPromise = streamGithubCopilotChat({
    ...freshSettings,
    systemPrompt: withDateContextSystemPrompt(freshSettings.systemPrompt),
    messages: messageTexts.map((content) => ({ role: "user" as const, content })),
    abortSignal: input.abortSignal,
    ...(copilotTools?.length ? { tools: copilotTools } : {}),
    onEvent: (rawEvent: unknown) => {
      const event = rawEvent as CopilotEvent;

      if (event.type === "assistant.message_delta" && event.data?.deltaContent) {
        answer += event.data.deltaContent as string;
        enqueue({ event: { type: "answer_delta", text: event.data.deltaContent as string } });
      } else if (event.type === "assistant.reasoning_delta" && event.data?.deltaContent) {
        thinking += event.data.deltaContent as string;
        enqueue({ event: { type: "thinking_delta", text: event.data.deltaContent as string } });
      } else if (event.type === "assistant.reasoning" && event.data?.content) {
        thinking += event.data.content as string;
        enqueue({ event: { type: "thinking_delta", text: event.data.content as string } });
      } else if (event.type === "tool.execution_start" && event.data) {
        const toolData = event.data as {
          toolCallId: string;
          toolName: string;
          arguments?: Record<string, unknown>;
        };
        if (customCopilotToolNames.has(toolData.toolName)) {
          return;
        }
        const action: MessageAction = {
          id: toolData.toolCallId,
          messageId: "",
          kind: inferCopilotActionKind(toolData.toolName),
          status: "running",
          serverId: null,
          skillId: null,
          toolName: toolData.toolName,
          label: toolData.toolName,
          detail: summarizeCopilotArguments(toolData.arguments),
          arguments: toolData.arguments ?? null,
          resultSummary: "",
          sortOrder: 0,
          startedAt: event.timestamp ?? new Date().toISOString(),
          completedAt: null,
          proposalState: null,
          proposalPayload: null,
          proposalUpdatedAt: null
        };
        liveCopilotActions.set(toolData.toolCallId, action);
        enqueue({ event: { type: "action_start", action } });
      } else if (event.type === "tool.execution_complete" && event.data) {
        const toolData = event.data as {
          toolCallId: string;
          toolName: string;
          success: boolean;
          result?: { content?: string; detailedContent?: string };
          error?: { message?: string };
        };
        if (customCopilotToolNames.has(toolData.toolName)) {
          return;
        }
        const existing = liveCopilotActions.get(toolData.toolCallId);
        const resultSummary =
          toolData.result?.detailedContent ??
          toolData.result?.content ??
          toolData.error?.message ??
          "";
        const action: MessageAction = {
          id: toolData.toolCallId,
          messageId: "",
          kind: existing?.kind ?? inferCopilotActionKind(toolData.toolName),
          status: toolData.success ? "completed" : "error",
          serverId: existing?.serverId ?? null,
          skillId: existing?.skillId ?? null,
          toolName: existing?.toolName ?? toolData.toolName,
          label: existing?.label ?? toolData.toolName,
          detail: existing?.detail ?? "",
          arguments: existing?.arguments ?? null,
          resultSummary: truncateText(resultSummary, MAX_RUNTIME_TOOL_RESULT_CHARS),
          sortOrder: existing?.sortOrder ?? 0,
          startedAt: existing?.startedAt ?? event.timestamp ?? new Date().toISOString(),
          completedAt: event.timestamp ?? new Date().toISOString(),
          proposalState: existing?.proposalState ?? null,
          proposalPayload: existing?.proposalPayload ?? null,
          proposalUpdatedAt: existing?.proposalUpdatedAt ?? null
        };
        liveCopilotActions.delete(toolData.toolCallId);
        enqueue({ event: { type: toolData.success ? "action_complete" : "action_error", action } });
      } else if (event.type === "session.error" && event.data?.message) {
        enqueue({ event: { type: "error", message: event.data.message as string } });
      }
    }
  });

  void copilotPromise.then(
    () => enqueue({ done: true }),
    (error: Error) => {
      console.error("[copilot/stream] promise rejected:", error.message);
      enqueue({ event: { type: "error", message: error.message } });
      enqueue({ done: true });
    }
  );

  let item = await dequeue();
  while (!("done" in item)) {
    yield item.event;
    item = await dequeue();
  }

  return { answer, thinking, usage: { inputTokens: estimatePromptTokens(promptMessages) } };
}
