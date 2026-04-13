export class ChatTurnStoppedError extends Error {
  constructor() {
    super("Chat turn stopped by user");
    this.name = "ChatTurnStoppedError";
  }
}

export type ChatTurnControl = ReturnType<typeof createChatTurnControl>;

const activeTurns = new Map<string, ChatTurnControl>();

export function createChatTurnControl(conversationId: string, abortController = new AbortController()) {
  let stopped = false;

  return {
    conversationId,
    abortController,
    get stopped() {
      return stopped;
    },
    requestStop() {
      stopped = true;
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    },
    throwIfStopped() {
      if (stopped || abortController.signal.aborted) {
        throw new ChatTurnStoppedError();
      }
    }
  };
}

export function claimChatTurnStart(conversationId: string, control = createChatTurnControl(conversationId)) {
  if (activeTurns.has(conversationId)) {
    return { ok: false as const };
  }

  activeTurns.set(conversationId, control);
  return {
    ok: true as const,
    control
  };
}

export function registerChatTurn(conversationId: string) {
  const claimed = claimChatTurnStart(conversationId);
  if (!claimed.ok) {
    throw new Error("Conversation already has an active assistant turn");
  }

  return claimed.control;
}

export function requestStop(conversationId: string) {
  activeTurns.get(conversationId)?.requestStop();
}

export function releaseChatTurnStart(conversationId: string, control?: ChatTurnControl) {
  if (!control) {
    activeTurns.delete(conversationId);
    return;
  }

  if (activeTurns.get(conversationId) === control) {
    activeTurns.delete(conversationId);
  }
}

export function clearChatTurn(conversationId: string) {
  releaseChatTurnStart(conversationId);
}
