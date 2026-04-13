import {
  claimNextQueuedMessageForDispatch,
  deleteQueuedMessage,
  failQueuedMessage,
  getConversation,
  markOrphanedQueuedMessagesFailed
} from "@/lib/conversations";
import type { ConversationManager } from "@/lib/conversation-manager";
import type { StartChatTurn } from "@/lib/chat-turn";

const dispatchLocks = new Set<string>();

export async function ensureQueuedDispatch({
  manager,
  conversationId,
  startChatTurn
}: {
  manager: ConversationManager;
  conversationId: string;
  startChatTurn: StartChatTurn;
}) {
  if (dispatchLocks.has(conversationId)) {
    return;
  }

  const conversation = getConversation(conversationId);
  if (!conversation || conversation.isActive) {
    return;
  }

  dispatchLocks.add(conversationId);

  try {
    while (true) {
      const currentConversation = getConversation(conversationId);
      if (!currentConversation || currentConversation.isActive) {
        return;
      }

      if (!manager.isActive(conversationId)) {
        markOrphanedQueuedMessagesFailed(conversationId);
      }

      const queued = claimNextQueuedMessageForDispatch(conversationId);
      if (!queued) {
        return;
      }

      let messagesCreated = false;
      const result = await startChatTurn(
        manager,
        conversationId,
        queued.content,
        [],
        undefined,
        {
          source: "queue",
          onMessagesCreated() {
            messagesCreated = true;
            deleteQueuedMessage({
              conversationId,
              queuedMessageId: queued.id
            });
          }
        }
      );

      if ((result.status === "failed" || result.status === "skipped") && !messagesCreated) {
        failQueuedMessage({
          conversationId,
          queuedMessageId: queued.id,
          failureMessage: result.errorMessage ?? "Unable to dispatch queued follow-up"
        });
      }
    }
  } finally {
    dispatchLocks.delete(conversationId);
  }
}
