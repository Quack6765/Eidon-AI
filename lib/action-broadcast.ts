import { broadcastBotUpdateForMessage } from "@/lib/bot-runs";
import { publishConversationEvent } from "@/lib/conversation-event-bus";
import { getMessage } from "@/lib/conversations";
import type { MessageAction } from "@/lib/types";

export function broadcastActionUpdate(action: MessageAction) {
  broadcastBotUpdateForMessage(action.messageId);
  const conversationId = getMessage(action.messageId)?.conversationId;
  if (!conversationId) return;
  const event = { type: "action_complete" as const, action };
  publishConversationEvent({ kind: "delta", conversationId, event });
}
