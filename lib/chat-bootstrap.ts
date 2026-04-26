import type { MessageAttachment } from "@/lib/types";

export type ChatBootstrapPayload = {
  message: string;
  attachments: MessageAttachment[];
  personaId?: string;
};

function getChatBootstrapStorageKey(conversationId: string) {
  return `eidon:chat-bootstrap:${conversationId}`;
}

const HOME_SUBMIT_SIDEBAR_AUTO_HIDE_KEY = "eidon:shell:auto-hide-sidebar-conversation";

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

export function markHomeSubmitSidebarAutoHide(conversationId: string) {
  sessionStorage.setItem(HOME_SUBMIT_SIDEBAR_AUTO_HIDE_KEY, conversationId);
}

export function consumeHomeSubmitSidebarAutoHide(conversationId: string) {
  if (sessionStorage.getItem(HOME_SUBMIT_SIDEBAR_AUTO_HIDE_KEY) !== conversationId) {
    return false;
  }

  sessionStorage.removeItem(HOME_SUBMIT_SIDEBAR_AUTO_HIDE_KEY);
  return true;
}
