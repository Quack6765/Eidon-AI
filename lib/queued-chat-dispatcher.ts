import {
  claimNextQueuedMessageForDispatch,
  createQueuedMessage,
  deleteQueuedMessage,
  failQueuedMessage,
  getConversation,
  listQueuedMessages,
  markOrphanedQueuedMessagesFailed,
  moveQueuedMessageToFront,
  requeueQueuedMessage
} from "@/lib/conversations";
import { getBotByConversationId } from "@/lib/bots";
import { requestRedirect } from "@/lib/chat-turn-control";
import type { ConversationManager } from "@/lib/conversation-manager";
import type { StartChatTurn } from "@/lib/chat-turn";
import type { ChatInputMode } from "@/lib/types";

const dispatchLocks = new Set<string>();

function isBusyTurnFailure(errorMessage: string | undefined) {
  return /already has an active/i.test(errorMessage ?? "");
}

function broadcastQueueUpdated(manager: ConversationManager, conversationId: string) {
  manager.broadcast(conversationId, {
    type: "queue_updated",
    conversationId,
    queuedMessages: listQueuedMessages(conversationId)
  });
}

export function queueFollowUpMessage(input: { conversationId: string; content: string; mode?: ChatInputMode }) {
  const queuedMessage = createQueuedMessage(input);
  if (getBotByConversationId(input.conversationId)) {
    requestRedirect(input.conversationId, queuedMessage.id);
  }
  return queuedMessage;
}

export function sendQueuedMessageNow(input: { conversationId: string; queuedMessageId: string }) {
  if (!moveQueuedMessageToFront(input)) return false;
  requestRedirect(input.conversationId, input.queuedMessageId);
  return true;
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
          quietWhenBusy: true,
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
        if (result.status === "failed" && isBusyTurnFailure(result.errorMessage)) {
          requeueQueuedMessage({
            conversationId,
            queuedMessageId: queued.id
          });
          broadcastQueueUpdated(manager, conversationId);
          return;
        }
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
