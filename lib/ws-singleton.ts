import { createConversationManager, type ConversationManager } from "@/lib/conversation-manager";

const WS_MANAGER_KEY = Symbol.for("eidon:conversation-manager");

export function getConversationManager(): ConversationManager {
  let manager = (globalThis as Record<symbol, ConversationManager | undefined>)[WS_MANAGER_KEY];
  if (!manager) {
    manager = createConversationManager();
    (globalThis as Record<symbol, ConversationManager | undefined>)[WS_MANAGER_KEY] = manager;
  }
  return manager;
}
