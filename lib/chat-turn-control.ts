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
const CHAT_TURN_RELEASE_WAITERS_KEY = Symbol.for("eidon:chat-turn-release-waiters");

function getActiveTurns() {
  const globalRegistry = globalThis as Record<symbol, Map<string, ChatTurnControl> | undefined>;
  let activeTurns = globalRegistry[CHAT_TURN_REGISTRY_KEY];

  if (!activeTurns) {
    activeTurns = new Map<string, ChatTurnControl>();
    globalRegistry[CHAT_TURN_REGISTRY_KEY] = activeTurns;
  }

  return activeTurns;
}

function getReleaseWaiters() {
  const globalRegistry = globalThis as Record<symbol, Map<string, Set<() => void>> | undefined>;
  let waiters = globalRegistry[CHAT_TURN_RELEASE_WAITERS_KEY];

  if (!waiters) {
    waiters = new Map<string, Set<() => void>>();
    globalRegistry[CHAT_TURN_RELEASE_WAITERS_KEY] = waiters;
  }

  return waiters;
}

function notifyReleaseWaiters(conversationId: string) {
  const waiters = getReleaseWaiters();
  const pending = waiters.get(conversationId);
  if (!pending) return;
  waiters.delete(conversationId);
  for (const resolve of pending) {
    resolve();
  }
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

export function hasActiveChatTurn(conversationId: string) {
  return getActiveTurns().has(conversationId);
}

export function requestStop(conversationId: string) {
  getActiveTurns().get(conversationId)?.requestStop();
}

export function waitForChatTurnRelease(conversationId: string, timeoutMs: number): Promise<void> {
  if (!hasActiveChatTurn(conversationId)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const waiters = getReleaseWaiters();
    let pending = waiters.get(conversationId);
    if (!pending) {
      pending = new Set();
      waiters.set(conversationId, pending);
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (timer) clearTimeout(timer);
      waiters.get(conversationId)?.delete(settle);
      resolve();
    };
    pending.add(settle);
    timer = setTimeout(settle, timeoutMs);
    timer.unref?.();
  });
}

export function releaseChatTurnStart(conversationId: string, control?: ChatTurnControl) {
  const activeTurns = getActiveTurns();
  if (!control) {
    if (activeTurns.delete(conversationId)) {
      notifyReleaseWaiters(conversationId);
    }
    return;
  }

  if (activeTurns.get(conversationId) === control) {
    activeTurns.delete(conversationId);
    notifyReleaseWaiters(conversationId);
  }
}

export function clearChatTurn(conversationId: string) {
  releaseChatTurnStart(conversationId);
}
