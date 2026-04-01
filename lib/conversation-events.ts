export const CONVERSATION_TITLE_UPDATED_EVENT = "hermes:conversation-title-updated";

export type ConversationTitleUpdatedDetail = {
  conversationId: string;
  title: string;
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
