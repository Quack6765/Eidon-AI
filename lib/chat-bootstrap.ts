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

export function consumeChatBootstrap(conversationId: string) {
  const key = getChatBootstrapStorageKey(conversationId);
  const raw = sessionStorage.getItem(key);

  if (!raw) {
    return null;
  }

  sessionStorage.removeItem(key);

  try {
    return JSON.parse(raw) as ChatBootstrapPayload;
  } catch {
    return null;
  }
}
