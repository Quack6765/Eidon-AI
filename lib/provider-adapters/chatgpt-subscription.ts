import OpenAI from "openai";

import {
  buildChatgptHeaders,
  CHATGPT_CODEX_BASE_URL,
  CHATGPT_LABEL,
  getChatgptUsageLimits,
  listChatgptModels,
  refreshChatgptTokens,
  shouldRefreshChatgptToken
} from "@/lib/chatgpt-subscription";
import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import { providerHttpOptions } from "@/lib/provider-http";
import { ensureFreshOAuthAccessToken } from "@/lib/provider-oauth-refresh";
import {
  buildOpenAIResponsesInput,
  buildOpenAIResponsesTools
} from "@/lib/provider-adapters/openai-message-formatting";
import { streamOpenAIResponses } from "@/lib/provider-adapters/openai-responses-stream";
import { adapterStream, runAdapterText } from "@/lib/provider-adapters/kit";
import type {
  ProviderStreamInput,
  ProviderStreamResult,
  ProviderTextInput
} from "@/lib/provider-adapters/types";
import { normalizeLineBreaks } from "@/lib/text-utils";
import type {
  ChatStreamEvent,
  PromptMessage,
  RuntimeProviderProfile
} from "@/lib/types";

const DEFAULT_INSTRUCTIONS = "You are a helpful assistant.";

function ensureFreshChatgptAccessToken(profile: RuntimeProviderProfile, abortSignal?: AbortSignal) {
  return ensureFreshOAuthAccessToken(profile, {
    label: CHATGPT_LABEL,
    shouldRefresh: shouldRefreshChatgptToken,
    refresh: refreshChatgptTokens
  }, abortSignal);
}

function createChatgptClient(profile: RuntimeProviderProfile, conversationId?: string) {
  const accessToken = profile.credentials.accessToken ?? "";
  return new OpenAI({
    apiKey: accessToken,
    baseURL: CHATGPT_CODEX_BASE_URL,
    defaultHeaders: buildChatgptHeaders(accessToken, conversationId),
    ...providerHttpOptions
  });
}

function messageText(content: PromptMessage["content"]) {
  return typeof content === "string"
    ? content
    : content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
}

export function buildChatgptInput(messages: PromptMessage[]) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => messageText(message.content).trim())
    .filter(Boolean)
    .join("\n\n");
  const input = buildOpenAIResponsesInput(messages.filter((message) => message.role !== "system"))
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [item];
      if (item.type === "reasoning" && !item.encrypted_content) return [];
      const { id: _id, ...rest } = item;
      return [rest];
    });
  return { instructions: instructions || DEFAULT_INSTRUCTIONS, input };
}

function buildChatgptReasoning(settings: RuntimeProviderProfile) {
  if (!supportsVisibleReasoning(settings.model, "responses")) return undefined;
  const effort = settings.reasoningEffort === "max" ? "xhigh" : settings.reasoningEffort;
  return {
    effort,
    ...(settings.reasoningSummaryEnabled && effort !== "none" ? { summary: "auto" } : {})
  };
}

async function* streamChatgptSubscriptionWire(
  input: ProviderStreamInput
): AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void> {
  const settings = await ensureFreshChatgptAccessToken(input.settings, input.abortSignal);
  const { instructions, input: responsesInput } = buildChatgptInput(input.promptMessages);

  return yield* streamOpenAIResponses({
    client: createChatgptClient(settings, input.conversationId),
    params: {
      model: settings.model,
      instructions,
      input: responsesInput,
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: buildChatgptReasoning(settings),
      ...(input.conversationId ? { prompt_cache_key: input.conversationId } : {}),
      ...(input.tools?.length
        ? { tools: buildOpenAIResponsesTools(input.tools), tool_choice: "auto" }
        : {})
    },
    promptMessages: input.promptMessages,
    abortSignal: input.abortSignal
  });
}

export const streamChatgptSubscriptionResponse = adapterStream(
  { normalizePromptMessages: true, usageEvents: "kit" },
  streamChatgptSubscriptionWire
);

export function callChatgptSubscriptionText(input: ProviderTextInput) {
  return runAdapterText(input, async (settings) => {
    const stream = streamChatgptSubscriptionResponse({
      settings,
      promptMessages: [{ role: "user", content: input.prompt }],
      abortSignal: input.abortSignal,
      conversationId: input.conversationId
    });
    let step = await stream.next();
    while (!step.done) step = await stream.next();

    return normalizeLineBreaks(step.value.answer);
  });
}

export async function discoverChatgptSubscriptionModels(profile: RuntimeProviderProfile) {
  return listChatgptModels(await ensureFreshChatgptAccessToken(profile));
}

export async function getChatgptSubscriptionUsageLimits(profile: RuntimeProviderProfile) {
  return getChatgptUsageLimits(await ensureFreshChatgptAccessToken(profile));
}
