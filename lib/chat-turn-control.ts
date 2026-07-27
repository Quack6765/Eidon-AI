export class ChatTurnStoppedError extends Error {
  constructor() {
    super("Chat turn stopped by user");
    this.name = "ChatTurnStoppedError";
  }
}

export type ChatTurnControl = ReturnType<typeof createChatTurnControl>;

export function throwIfChatTurnAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ChatTurnStoppedError();
  }
}

const CHAT_TURN_REGISTRY_KEY = Symbol.for("eidon:chat-turn-registry");

function getActiveTurns() {
  const globalRegistry = globalThis as Record<symbol, Map<string, ChatTurnControl> | undefined>;
  let activeTurns = globalRegistry[CHAT_TURN_REGISTRY_KEY];

  if (!activeTurns) {
    activeTurns = new Map<string, ChatTurnControl>();
    globalRegistry[CHAT_TURN_REGISTRY_KEY] = activeTurns;
  }

  return activeTurns;
}

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
      if (stopped) {
        throw new ChatTurnStoppedError();
      }
      throwIfChatTurnAborted(abortController.signal);
    }
  };
}

export function claimChatTurnStart(conversationId: string, control = createChatTurnControl(conversationId)) {
  const activeTurns = getActiveTurns();
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
  getActiveTurns().get(conversationId)?.requestStop();
}

export function releaseChatTurnStart(conversationId: string, control?: ChatTurnControl) {
  const activeTurns = getActiveTurns();
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
