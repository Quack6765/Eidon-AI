export class ChatTurnStoppedError extends Error {
  constructor() {
    super("Chat turn stopped by user");
    this.name = "ChatTurnStoppedError";
  }
}

const activeTurns = new Map<string, ReturnType<typeof createChatTurnControl>>();

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

export function registerChatTurn(conversationId: string) {
  const control = createChatTurnControl(conversationId);
  activeTurns.set(conversationId, control);
  return control;
}

export function requestStop(conversationId: string) {
  activeTurns.get(conversationId)?.requestStop();
}

export function clearChatTurn(conversationId: string) {
  activeTurns.delete(conversationId);
}
