import OpenAI from "openai";

import { getAttachmentDataUrl } from "@/lib/attachments";
import { ensureFreshGithubAccessToken, runGithubCopilotChat, streamGithubCopilotChat } from "@/lib/github-copilot";
import { buildCopilotTools, type CopilotToolContext } from "@/lib/copilot-tools";
import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import { estimatePromptTokens, setActiveTokenizer } from "@/lib/tokenization";
import { normalizeLineBreaks } from "@/lib/text-utils";
import type {
  ChatStreamEvent,
  MessageActionKind,
  MessageAction,
  PromptMessage,
  ProviderProfile,
  ProviderProfileWithApiKey,
  ToolDefinition,
  ProviderToolCall
} from "@/lib/types";

function buildDateContextSystemContent() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localTime = now.toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long"
  });

  return [
    "Current date and time context for this request (not shown to the user):",
    `- Local: ${localTime} (${timezone})`,
    `- UTC: ${now.toISOString()}`
  ].join("\n");
}

function withDateContextSystemMessage(messages: PromptMessage[]): PromptMessage[] {
  const contextMessage: PromptMessage = {
    role: "system",
    content: buildDateContextSystemContent()
  };

  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex === -1) {
    return [contextMessage, ...messages];
  }

  const systemMessage = messages[systemIndex];
  const systemContent = typeof systemMessage.content === "string"
    ? systemMessage.content
    : systemMessage.content.map((part) => "text" in part ? part.text : "").join("");

  return messages.map((message, index) => {
    if (index !== systemIndex) return message;
    return {
      ...message,
      content: `${systemContent}\n\n${contextMessage.content}`
    };
  });
}

function withDateContextSystemPrompt(systemPrompt: string) {
  const context = buildDateContextSystemContent();
  return `${systemPrompt.trim()}\n\n${context}`;
}

function createClient(settings: ProviderProfile, apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: settings.apiBaseUrl
  });
}

function toResponseContentParts(content: PromptMessage["content"]) {
  const parts = typeof content === "string"
    ? [{ type: "text" as const, text: content }]
    : content;

  return parts.map((part) => {
    if (part.type === "text") {
      return {
        type: "input_text" as const,
        text: part.text
      };
    }

    return {
      type: "input_image" as const,
      image_url: getAttachmentDataUrl(part)
    };
  });
}

function toChatCompletionContentParts(content: PromptMessage["content"]) {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    if (part.type === "text") {
      return {
        type: "text" as const,
        text: part.text
      };
    }

    return {
      type: "image_url" as const,
      image_url: {
        url: getAttachmentDataUrl(part)
      }
    };
  });
}

function buildResponsesInput(messages: PromptMessage[]): any[] {
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: typeof message.content === "string" ? message.content : message.content.map(p => "text" in p ? p.text : "").join("")
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const toolCall of message.toolCalls) {
        input.push({
          type: "function_call",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          call_id: toolCall.id
        });
      }
      if (typeof message.content === "string" && message.content.trim()) {
        input.push({ role: "assistant", content: toResponseContentParts(message.content) });
      }
      continue;
    }

    input.push({
      role: message.role,
      content: toResponseContentParts(message.content)
    });
  }

  return input;
}

function buildChatCompletionMessages(messages: PromptMessage[]): any[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: message.toolCallId ?? "",
        content: typeof message.content === "string" ? message.content : message.content.map(p => "text" in p ? p.text : "").join("")
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: typeof message.content === "string" && message.content.trim() ? message.content : null,
        tool_calls: message.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
      };
    }

    return {
      role: message.role,
      content: toChatCompletionContentParts(message.content)
    };
  });
}

function normalizeReasoningEffort(
  effort: ProviderProfile["reasoningEffort"]
): "low" | "medium" | "high" {
  if (effort === "xhigh") {
    return "high";
  }

  return effort;
}

function buildReasoningConfig(settings: ProviderProfile) {
  if (!supportsVisibleReasoning(settings.model, settings.apiMode)) {
    return undefined;
  }

  const effort = normalizeReasoningEffort(settings.reasoningEffort);

  if (settings.reasoningSummaryEnabled) {
    return {
      effort,
      summary: "auto"
    } as const;
  }

  return {
    effort
  } as const;
}

function buildChatCompletionsOptions(settings: ProviderProfile) {
  if (!supportsVisibleReasoning(settings.model, settings.apiMode)) {
    return {};
  }

  const effort = normalizeReasoningEffort(settings.reasoningEffort);

  if (settings.apiBaseUrl.includes("ollama.com")) {
    const ollamaEffort = settings.reasoningSummaryEnabled ? effort : "none";

    return {
      extra_body: {
        reasoning_effort: ollamaEffort,
        reasoning: {
          effort: ollamaEffort
        }
      }
    } as const;
  }

  return {
    extra_body: {
      thinking: {
        type: settings.reasoningSummaryEnabled ? "enabled" : "disabled"
      }
    }
  } as const;
}

function getResponseText(output: unknown) {
  if (typeof output === "string") {
    return output;
  }

  if (
    output &&
    typeof output === "object" &&
    "output_text" in output &&
    typeof (output as { output_text?: string }).output_text === "string"
  ) {
    return (output as { output_text: string }).output_text;
  }

  if (
    output &&
    typeof output === "object" &&
    "output" in output &&
    Array.isArray((output as { output?: unknown[] }).output)
  ) {
    return (output as { output: unknown[] }).output
      .flatMap((item) => {
        if (
          item &&
          typeof item === "object" &&
          "content" in item &&
          Array.isArray((item as { content?: unknown[] }).content)
        ) {
          return (item as { content: Array<{ text?: string }> }).content
            .map((part) => part.text ?? "")
            .filter(Boolean);
        }

        return [];
      })
      .join("");
  }

  return "";
}

function getResponseOutputItemMessageText(item: unknown) {
  if (
    !item ||
    typeof item !== "object" ||
    !("content" in item) ||
    !Array.isArray((item as { content?: unknown[] }).content)
  ) {
    return "";
  }

  return normalizeLineBreaks(
    (item as { content: unknown[] }).content
      .flatMap((part) => {
        if (!part || typeof part !== "object") {
          return [];
        }

        const text = "text" in part && typeof (part as { text?: string }).text === "string"
          ? (part as { text: string }).text
          : "";

        if (!text) {
          return [];
        }

        const type = "type" in part && typeof (part as { type?: string }).type === "string"
          ? (part as { type: string }).type
          : "";

        if (!type || type === "output_text" || type === "text") {
          return [text];
        }

        return [];
      })
      .join("")
  );
}

function mergeRecoveredStreamText(current: string, recovered: string) {
  const nextText = normalizeLineBreaks(recovered);

  if (!nextText || nextText === current) {
    return {
      nextText: current,
      delta: ""
    };
  }

  if (nextText.startsWith(current)) {
    return {
      nextText,
      delta: nextText.slice(current.length)
    };
  }

  return {
    nextText,
    delta: ""
  };
}

export async function callProviderText(input: {
  settings: ProviderProfileWithApiKey;
  prompt: string;
  purpose: "compaction" | "test" | "title" | "image_instruction";
  conversationId?: string;
}) {
  const { settings } = input;
  const contextualPrompt = withDateContextSystemMessage([{
    role: "user",
    content: input.prompt
  }]);

  if (settings.providerKind === "github_copilot") {
    const freshSettings = await ensureFreshGithubAccessToken(settings);
    const result = await runGithubCopilotChat({
      ...freshSettings,
      systemPrompt: withDateContextSystemPrompt(freshSettings.systemPrompt),
      messages: [{ role: "user", content: input.prompt }]
    });

    return typeof result === "string" ? result : JSON.stringify(result);
  }

  const client = createClient(settings, settings.apiKey);

  if (settings.apiMode === "responses") {
    const reasoning = buildReasoningConfig(settings);
    const response = await client.responses.create({
      model: settings.model,
      input: buildResponsesInput(contextualPrompt),
      max_output_tokens: Math.min(settings.maxOutputTokens, 4000),
      reasoning
    });

    const text = normalizeLineBreaks(getResponseText(response));

    if (!text.trim()) {
      throw new Error("Provider returned an empty response");
    }

    return text;
  }

  const response = await client.chat.completions.create({
    model: settings.model,
    messages: buildChatCompletionMessages(contextualPrompt),
    temperature: settings.temperature,
    max_completion_tokens: Math.min(settings.maxOutputTokens, 4000),
    ...buildChatCompletionsOptions(settings)
  });

  const text = normalizeLineBreaks(
    typeof response.choices[0]?.message?.content === "string"
      ? response.choices[0]?.message?.content
      : ""
  );

  if (!text.trim()) {
    throw new Error("Provider returned an empty response");
  }

  return text;
}

export async function* streamProviderResponse(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  tools?: ToolDefinition[];
  abortSignal?: AbortSignal;
  copilotToolContext?: CopilotToolContext;
}): AsyncGenerator<
  ChatStreamEvent,
  { answer: string; thinking: string; toolCalls?: ProviderToolCall[]; usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } },
  void
> {
  const { settings, promptMessages } = input;
  const contextualPromptMessages = withDateContextSystemMessage(promptMessages);
  setActiveTokenizer(settings.tokenizerModel ?? "gpt-tokenizer");

  if (settings.providerKind === "github_copilot") {
    const freshSettings = await ensureFreshGithubAccessToken(settings);
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

    const copilotTools = input.copilotToolContext
      ? buildCopilotTools(input.copilotToolContext)
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
            resultSummary,
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

    copilotPromise.catch((error: Error) => {
      console.error("[copilot/stream] promise rejected:", error.message);
      enqueue({ event: { type: "error", message: error.message } });
    });

    copilotPromise.finally(() => {
      enqueue({ done: true });
    });

    let item = await dequeue();
    while (!("done" in item)) {
      yield item.event;
      item = await dequeue();
    }

    return { answer, thinking, usage: { inputTokens: estimatePromptTokens(contextualPromptMessages) } };
  }

  const client = createClient(settings, settings.apiKey);
  const abortController = new AbortController();
  const signal = input.abortSignal ?? abortController.signal;
  let answer = "";
  let thinking = "";
  let usage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  } = {
    inputTokens: estimatePromptTokens(contextualPromptMessages)
  };

  if (settings.apiMode === "responses") {
    const reasoning = buildReasoningConfig(settings);

    const responseCreateParams: Record<string, unknown> = {
      model: settings.model,
      input: buildResponsesInput(contextualPromptMessages),
      stream: true,
      temperature: settings.temperature,
      max_output_tokens: settings.maxOutputTokens,
      reasoning
    };

    if (input.tools?.length) {
      const toolsWithStrict = input.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: true
      }));

      const toolsWithoutStrict = input.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: false
      }));

      responseCreateParams.tools = toolsWithStrict;

      let stream: AsyncIterable<any>;
      try {
        stream = await client.responses.create(
          responseCreateParams as any,
          { signal }
        ) as unknown as AsyncIterable<any>;
      } catch (createError) {
        const isSchemaError =
          createError instanceof Error &&
          (createError.message.includes("strict") ||
            createError.message.includes("schema") ||
            createError.message.includes("additionalProperties") ||
            (createError as any).status === 400);

        if (isSchemaError) {
          responseCreateParams.tools = toolsWithoutStrict;
          stream = await client.responses.create(
            responseCreateParams as any,
            { signal }
          ) as unknown as AsyncIterable<any>;
        } else {
          throw createError;
        }
      }

      const pendingToolCalls = new Map<string, { name: string; arguments: string }>();

      try {
        for await (const event of stream) {
          if (event.type === "response.function_call_arguments.delta") {
            continue;
          }

          if (
            event.type === "response.output_text.delta" ||
            event.type === "response.content_part.delta"
          ) {
            const text = normalizeLineBreaks(String(event.delta ?? ""));
            answer += text;
            yield { type: "answer_delta", text };
          }

          if (
            event.type === "response.reasoning_summary_text.delta" ||
            event.type === "response.reasoning_text.delta"
          ) {
            const text = "delta" in event ? normalizeLineBreaks(String(event.delta ?? "")) : "";
            thinking += text;
            yield { type: "thinking_delta", text };
          }

          if (event.type === "response.completed" && event.response?.usage) {
            usage = {
              inputTokens: event.response.usage.input_tokens ?? 0,
              outputTokens: event.response.usage.output_tokens ?? 0,
              reasoningTokens: event.response.usage.output_tokens_details?.reasoning_tokens
            };
          }

          if (event.type === "response.output_item.done") {
            const item = event.item as {
              type?: string;
              name?: string;
              arguments?: string;
              call_id?: string;
              summary?: Array<{ text?: string }>;
              content?: unknown[];
            };

            if (item.type === "function_call" && item.call_id) {
              pendingToolCalls.set(item.call_id, {
                name: item.name ?? "",
                arguments: item.arguments ?? ""
              });
            }

            if (item.type === "reasoning" && Array.isArray(item.summary)) {
              const combined = normalizeLineBreaks(item.summary.map((part) => part.text ?? "").join(""));
              const recovery = mergeRecoveredStreamText(thinking, combined);
              thinking = recovery.nextText;

              if (recovery.delta) {
                yield { type: "thinking_delta", text: recovery.delta };
              }
            }

            if (item.type === "message") {
              const recovery = mergeRecoveredStreamText(answer, getResponseOutputItemMessageText(item));
              answer = recovery.nextText;

              if (recovery.delta) {
                yield { type: "answer_delta", text: recovery.delta };
              }
            }
          }
        }
      } finally {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      }

      yield {
        type: "usage",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens
      };

      const toolCalls: ProviderToolCall[] = [];
      for (const [id, call] of pendingToolCalls) {
        toolCalls.push({ id, name: call.name, arguments: call.arguments });
      }

      return { answer, thinking, toolCalls: toolCalls.length ? toolCalls : undefined, usage };
    }

    const stream = await client.responses.create(
      responseCreateParams as any,
      { signal }
    ) as unknown as AsyncIterable<any>;

    const pendingToolCalls = new Map<string, { name: string; arguments: string }>();

    try {
      for await (const event of stream) {
        if (event.type === "response.function_call_arguments.delta") {
          continue;
        }

        if (
          event.type === "response.output_text.delta" ||
          event.type === "response.content_part.delta"
        ) {
          const text = normalizeLineBreaks(String(event.delta ?? ""));
          answer += text;
          yield { type: "answer_delta", text };
        }

        if (
          event.type === "response.reasoning_summary_text.delta" ||
          event.type === "response.reasoning_text.delta"
        ) {
          const text = "delta" in event ? normalizeLineBreaks(String(event.delta ?? "")) : "";
          thinking += text;
          yield { type: "thinking_delta", text };
        }

        if (event.type === "response.completed" && event.response?.usage) {
          usage = {
            inputTokens: event.response.usage.input_tokens ?? 0,
            outputTokens: event.response.usage.output_tokens ?? 0,
            reasoningTokens: event.response.usage.output_tokens_details?.reasoning_tokens
          };
        }

        if (event.type === "response.output_item.done") {
          const item = event.item as {
            type?: string;
            name?: string;
            arguments?: string;
            call_id?: string;
            summary?: Array<{ text?: string }>;
            content?: unknown[];
          };

          if (item.type === "function_call" && item.call_id) {
            pendingToolCalls.set(item.call_id, {
              name: item.name ?? "",
              arguments: item.arguments ?? ""
            });
          }

          if (item.type === "reasoning" && Array.isArray(item.summary)) {
            const combined = normalizeLineBreaks(item.summary.map((part) => part.text ?? "").join(""));
            const recovery = mergeRecoveredStreamText(thinking, combined);
            thinking = recovery.nextText;

            if (recovery.delta) {
              yield { type: "thinking_delta", text: recovery.delta };
            }
          }

          if (item.type === "message") {
            const recovery = mergeRecoveredStreamText(answer, getResponseOutputItemMessageText(item));
            answer = recovery.nextText;

            if (recovery.delta) {
              yield { type: "answer_delta", text: recovery.delta };
            }
          }
        }
      }
    } finally {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    }

    yield {
      type: "usage",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens
    };

    const toolCalls: ProviderToolCall[] = [];
    for (const [id, call] of pendingToolCalls) {
      toolCalls.push({ id, name: call.name, arguments: call.arguments });
    }

    return { answer, thinking, toolCalls: toolCalls.length ? toolCalls : undefined, usage };
  }

  const chatCreateParams: Record<string, unknown> = {
    model: settings.model,
    messages: buildChatCompletionMessages(contextualPromptMessages),
    stream: true,
    temperature: settings.temperature,
    max_completion_tokens: settings.maxOutputTokens,
    ...buildChatCompletionsOptions(settings)
  };

  if (input.tools?.length) {
    chatCreateParams.tools = input.tools;
  }

  const stream = await client.chat.completions.create(
    chatCreateParams as any,
    { signal }
  ) as unknown as AsyncIterable<any>;

  const toolCallChunks = new Map<string, { name: string; arguments: string }>();

  try {
    for await (const chunk of stream) {
      const rawDelta = chunk.choices[0]?.delta ?? {};
      const reasoningValue =
        "reasoning_content" in rawDelta
          ? (rawDelta as { reasoning_content?: string }).reasoning_content
          : "thinking" in rawDelta
            ? (rawDelta as { thinking?: string }).thinking
            : "reasoning" in rawDelta
              ? (rawDelta as { reasoning?: string }).reasoning
              : "";
      const reasoningDelta = normalizeLineBreaks(String(reasoningValue ?? ""));
      const delta = normalizeLineBreaks(chunk.choices[0]?.delta?.content ?? "");

      if (reasoningDelta) {
        thinking += reasoningDelta;
        yield { type: "thinking_delta", text: reasoningDelta };
      }

      if (delta) {
        answer += delta;
        yield { type: "answer_delta", text: delta };
      }

      if (rawDelta.tool_calls) {
        for (const toolCallChunk of rawDelta.tool_calls) {
          const index = String(toolCallChunk.index ?? 0);
          const existing = toolCallChunks.get(index);
          if (!existing) {
            toolCallChunks.set(index, {
              name: toolCallChunk.function?.name ?? "",
              arguments: toolCallChunk.function?.arguments ?? ""
            });
          } else {
            if (toolCallChunk.function?.name) {
              existing.name = toolCallChunk.function.name;
            }
            if (toolCallChunk.function?.arguments) {
              existing.arguments += toolCallChunk.function.arguments;
            }
          }
        }
      }

      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens
        };
      }
    }
  } finally {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  }

  yield {
    type: "usage",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens
  };

  const toolCalls: ProviderToolCall[] = [];
  for (const [, call] of toolCallChunks) {
    toolCalls.push({ id: `call_${toolCalls.length}`, name: call.name, arguments: call.arguments });
  }

  return { answer, thinking, toolCalls: toolCalls.length ? toolCalls : undefined, usage };
}
