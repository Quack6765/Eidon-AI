import type {
  ConversationSnapshot,
  PublicConversationView
} from "@/lib/types";

export function toSharedConversationView(snapshot: ConversationSnapshot): PublicConversationView {
  return {
    conversation: {
      id: snapshot.conversation.id,
      title: snapshot.conversation.title,
      createdAt: snapshot.conversation.createdAt,
      updatedAt: snapshot.conversation.updatedAt
    },
    messages: snapshot.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      textSegments: (message.textSegments ?? []).map((segment) => ({
        id: segment.id,
        content: segment.content,
        sortOrder: segment.sortOrder,
        createdAt: segment.createdAt
      })),
      attachments: (message.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        kind: attachment.kind,
        byteSize: attachment.byteSize,
        createdAt: attachment.createdAt
      }))
    }))
  };
}
