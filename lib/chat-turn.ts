import { requestStop } from "@/lib/chat-turn-control";
import { getConversationManager } from "@/lib/ws-singleton";
import { getChatEmitter, runTurnFromContent } from "@/lib/turn-session";
import type { ChatTurnOptions, ChatTurnResult, StartChatTurn } from "@/lib/turn-session";
import type { ChatResearchOptions, ChatStreamEvent } from "@/lib/types";

export type { ChatTurnOptions, ChatTurnResult, StartChatTurn } from "@/lib/turn-session";
export type { ChatEmitter } from "@/lib/turn-session";
export { getChatEmitter } from "@/lib/turn-session";

export async function* runAssistantTurn(input: {
  conversationId: string;
  content: string;
  attachmentIds?: string[];
  personaId?: string;
  research?: ChatResearchOptions;
  abortSignal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent, ChatTurnResult> {
  const events: ChatStreamEvent[] = [];
  let finished = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const emitter = getChatEmitter();
  const unsubscribeDelta = emitter.on("delta", (conversationId, event) => {
    if (conversationId !== input.conversationId) return;
    events.push(event as ChatStreamEvent);
    notify();
  });
  const unsubscribeStatus = emitter.on("status", (conversationId, status) => {
    if (conversationId !== input.conversationId || status !== "completed") return;
    finished = true;
    notify();
  });
  const stop = () => requestStop(input.conversationId);
  input.abortSignal?.addEventListener("abort", stop, { once: true });

  const resultPromise = startChatTurn(
    getConversationManager(),
    input.conversationId,
    input.content,
    input.attachmentIds ?? [],
    input.personaId,
    { research: input.research }
  ).then((result) => {
    if (result.status === "failed" || result.status === "skipped") {
      events.push({ type: "error", message: result.errorMessage ?? "Unable to start assistant turn" });
      finished = true;
      notify();
    }
    return result;
  }).catch((error) => {
    events.push({
      type: "error",
      message: error instanceof Error ? error.message : "Assistant turn failed"
    });
    finished = true;
    notify();
    return {
      status: "failed" as const,
      errorMessage: error instanceof Error ? error.message : "Assistant turn failed"
    };
  });

  try {
    while (!finished || events.length > 0) {
      if (!events.length) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      yield events.shift()!;
    }
    return await resultPromise;
  } finally {
    unsubscribeDelta();
    unsubscribeStatus();
    input.abortSignal?.removeEventListener("abort", stop);
  }
}

export async function startChatTurn(
  manager: Parameters<StartChatTurn>[0],
  conversationId: string,
  content: string,
  attachmentIds: string[],
  personaId?: string,
  options?: ChatTurnOptions
): Promise<ChatTurnResult> {
  return runTurnFromContent(manager, conversationId, content, attachmentIds, personaId, options);
}
