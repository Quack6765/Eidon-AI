import {
  claimNextQueuedMessageForDispatch,
  deleteQueuedMessage,
  failQueuedMessage,
  getConversation,
  listQueuedMessages,
  markOrphanedQueuedMessagesFailed
} from "@/lib/conversations";
import type { ConversationManager } from "@/lib/conversation-manager";
import type { StartChatTurn } from "@/lib/chat-turn";

const dispatchLocks = new Set<string>();

function broadcastQueueUpdated(manager: ConversationManager, conversationId: string) {
  manager.broadcast(conversationId, {
    type: "queue_updated",
    conversationId,
    queuedMessages: listQueuedMessages(conversationId)
  });
}

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
        const recoveredCount = markOrphanedQueuedMessagesFailed(conversationId);
        if (recoveredCount > 0) {
          broadcastQueueUpdated(manager, conversationId);
        }
      }

      const queued = claimNextQueuedMessageForDispatch(conversationId);
      if (!queued) {
        return;
      }
      broadcastQueueUpdated(manager, conversationId);

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
            broadcastQueueUpdated(manager, conversationId);
          }
        }
      );

      if ((result.status === "failed" || result.status === "skipped") && !messagesCreated) {
        failQueuedMessage({
          conversationId,
          queuedMessageId: queued.id,
          failureMessage: result.errorMessage ?? "Unable to dispatch queued follow-up"
        });
        broadcastQueueUpdated(manager, conversationId);
      }
    }
  } finally {
    dispatchLocks.delete(conversationId);
  }
}
