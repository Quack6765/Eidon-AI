import type { ChatResearchOptions, ComposerDraft, MessageAttachment } from "@/lib/types";

export type ChatBootstrapPayload = {
  message: string;
  attachments: MessageAttachment[];
  personaId?: string;
  research?: ChatResearchOptions;
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

function getComposerDraftStorageKey(conversationId: string) {
  return `eidon:composer-draft:${conversationId}`;
}

export function storeComposerDraft(conversationId: string, draft: ComposerDraft) {
  sessionStorage.setItem(getComposerDraftStorageKey(conversationId), JSON.stringify(draft));
}

export function consumeComposerDraft(conversationId: string): ComposerDraft | null {
  const key = getComposerDraftStorageKey(conversationId);
  const raw = sessionStorage.getItem(key);

  if (!raw) {
    return null;
  }

  sessionStorage.removeItem(key);

  try {
    const parsed = JSON.parse(raw) as Partial<ComposerDraft>;
    return {
      content: typeof parsed.content === "string" ? parsed.content : "",
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : []
    };
  } catch {
    return null;
  }
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
