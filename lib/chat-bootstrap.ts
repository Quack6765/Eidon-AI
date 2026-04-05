import type { MessageAttachment } from "@/lib/types";

export type ChatBootstrapPayload = {
  message: string;
  attachments: MessageAttachment[];
};

function getChatBootstrapStorageKey(conversationId: string) {
  return `hermes:chat-bootstrap:${conversationId}`;
}

export function storeChatBootstrap(
  conversationId: string,
  payload: ChatBootstrapPayload
) {
  sessionStorage.setItem(
    getChatBootstrapStorageKey(conversationId),
    JSON.stringify(payload)
  );
}

export function readChatBootstrap(conversationId: string) {
  const raw = sessionStorage.getItem(getChatBootstrapStorageKey(conversationId));

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ChatBootstrapPayload;
  } catch {
    return null;
  }
}

export function clearChatBootstrap(conversationId: string) {
  sessionStorage.removeItem(getChatBootstrapStorageKey(conversationId));
}
