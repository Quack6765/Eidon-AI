import { broadcastBotUpdateForMessage } from "@/lib/bot-runs";
import { getMessage } from "@/lib/conversations";
import { getConversationManager } from "@/lib/ws-singleton";
import type { MessageAction } from "@/lib/types";

export function broadcastActionUpdate(action: MessageAction) {
  broadcastBotUpdateForMessage(action.messageId);
  const conversationId = getMessage(action.messageId)?.conversationId;
  if (!conversationId) return;
  const event = { type: "action_complete" as const, action };
  getConversationManager().broadcast(conversationId, { type: "delta", conversationId, event });
  void import("@/lib/chat-turn")
    .then(({ getChatEmitter }) => getChatEmitter().emit("delta", conversationId, event))
    .catch(() => undefined);
}
