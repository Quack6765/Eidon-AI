export const CONVERSATION_TITLE_UPDATED_EVENT = "hermes:conversation-title-updated";
export const CONVERSATION_REMOVED_EVENT = "hermes:conversation-removed";
export const CONVERSATION_ACTIVITY_UPDATED_EVENT = "hermes:conversation-activity-updated";

export type ConversationTitleUpdatedDetail = {
  conversationId: string;
  title: string;
};

export type ConversationRemovedDetail = {
  conversationId: string;
};

export type ConversationActivityUpdatedDetail = {
  conversationId: string;
  isActive: boolean;
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

export function dispatchConversationActivityUpdated(
  detail: ConversationActivityUpdatedDetail
) {
  window.dispatchEvent(
    new CustomEvent<ConversationActivityUpdatedDetail>(
      CONVERSATION_ACTIVITY_UPDATED_EVENT,
      { detail }
    )
  );
}
