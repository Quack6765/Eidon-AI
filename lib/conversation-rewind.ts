import type { MessageRole } from "@/lib/types";

export function getHistoryCutIndex(role: MessageRole, messageIndex: number) {
  return role === "user" ? messageIndex : messageIndex + 1;
}

export function planConversationRewind<T extends { id: string; role: MessageRole }>(
  messages: T[],
  messageId: string
) {
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  const message = messages[messageIndex];

  if (!message || message.role === "system") {
    return null;
  }

  return {
    message,
    removedMessages: messages.slice(getHistoryCutIndex(message.role, messageIndex)),
    restoresDraft: message.role === "user"
  };
}

export function describeRewind(removedCount: number) {
  return `Rewound ${removedCount} ${removedCount === 1 ? "message" : "messages"}`;
}
