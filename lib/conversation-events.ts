export const CONVERSATION_TITLE_UPDATED_EVENT = "hermes:conversation-title-updated";
export const CONVERSATION_REMOVED_EVENT = "hermes:conversation-removed";

export type ConversationTitleUpdatedDetail = {
  conversationId: string;
  title: string;
};

export type ConversationRemovedDetail = {
  conversationId: string;
};

export function dispatchConversationTitleUpdated(
  detail: ConversationTitleUpdatedDetail
) {
  window.dispatchEvent(
    new CustomEvent<ConversationTitleUpdatedDetail>(
      CONVERSATION_TITLE_UPDATED_EVENT,
      { detail }
    )
  );
}

export function dispatchConversationRemoved(detail: ConversationRemovedDetail) {
  window.dispatchEvent(
    new CustomEvent<ConversationRemovedDetail>(
      CONVERSATION_REMOVED_EVENT,
      { detail }
    )
  );
}
