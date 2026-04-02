import { dispatchConversationRemoved } from "@/lib/conversation-events";

export async function deleteConversationIfStillEmpty(conversationId: string | null) {
  if (!conversationId) {
    return false;
  }

  const response = await fetch(`/api/conversations/${conversationId}?onlyIfEmpty=1`, {
    method: "DELETE",
    keepalive: true
  });

  if (!response.ok) {
    return false;
  }

  const result = (await response.json()) as { deleted?: boolean };

  if (result.deleted) {
    dispatchConversationRemoved({ conversationId });
  }

  return Boolean(result.deleted);
}
