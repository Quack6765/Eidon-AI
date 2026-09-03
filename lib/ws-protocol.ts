import { MAX_ATTACHMENT_IDS_PER_MESSAGE, MAX_CHAT_MESSAGE_CHARS } from "@/lib/constants";
import { parseResearchRequest } from "@/lib/research-mode";
import type {
  BotRun,
  BotSummary,
  ChatResearchOptions,
  ChatStreamEvent,
  Message,
  MessageAction,
  MessageAttachment,
  MessageTextSegment,
  QueuedMessage
} from "@/lib/types";

export type MobileAttachmentDto = Omit<MessageAttachment, "relativePath" | "extractedText">;
export type MobileMessageDto = Omit<Message, "attachments"> & {
  attachments?: MobileAttachmentDto[];
};

export type ClientMessage =
  | { type: "subscribe"; conversationId: string }
  | { type: "request_snapshot"; conversationId: string }
  | { type: "unsubscribe"; conversationId: string }
  | { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string; research?: ChatResearchOptions }
  | { type: "stop"; conversationId: string }
  | { type: "queue_message"; conversationId: string; content: string }
  | { type: "update_queued_message"; conversationId: string; queuedMessageId: string; content: string }
  | { type: "delete_queued_message"; conversationId: string; queuedMessageId: string }
  | { type: "reorder_queued_messages"; conversationId: string; queuedMessageIds: string[] }
  | { type: "send_queued_message_now"; conversationId: string; queuedMessageId: string };

export type ServerMessage =
  | { type: "ready"; protocolVersion?: "v1"; activeConversations: { id: string; title: string; status: "idle" | "streaming" }[] }
  | { type: "snapshot"; conversationId: string; messages: MobileMessageDto[]; actions: MessageAction[]; segments: MessageTextSegment[]; queuedMessages: QueuedMessage[] }
  | { type: "queue_updated"; conversationId: string; queuedMessages: QueuedMessage[] }
  | { type: "delta"; conversationId: string; event: ChatStreamEvent }
  | { type: "user_message_persisted"; conversationId: string; message: MobileMessageDto }
  | { type: "error"; code?: string; message: string }
  | { type: "conversation_created"; conversation: { id: string; title: string; folderId: string | null; createdAt: string; updatedAt: string; isActive: boolean; isTemporary: boolean } }
  | { type: "conversation_deleted"; conversationId: string }
  | { type: "conversation_updated"; conversation: { id: string; title: string; folderId: string | null; updatedAt: string; isActive: boolean } }
  | { type: "conversation_activity"; conversationId: string; isActive: boolean }
  | { type: "conversation_title_updated"; conversationId: string; title: string }
  | { type: "bot_updated"; bot: BotSummary }
  | { type: "bot_deleted"; botId: string }
  | { type: "bot_run_updated"; run: BotRun };

export function serializeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

const MAX_CLIENT_IDENTIFIER_CHARS = 512;

function parseIdentifier(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_CLIENT_IDENTIFIER_CHARS
    ? value
    : null;
}

function parseContent(value: unknown) {
  return typeof value === "string" && value.length <= MAX_CHAT_MESSAGE_CHARS
    ? value
    : null;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
      return null;
    }

    const conversationId = parseIdentifier(parsed.conversationId);
    if (!conversationId) {
      return null;
    }

    if (
      parsed.type === "subscribe" ||
      parsed.type === "request_snapshot" ||
      parsed.type === "unsubscribe" ||
      parsed.type === "stop"
    ) {
      return { type: parsed.type, conversationId };
    }

    if (parsed.type === "message") {
      const content = parseContent(parsed.content);
      const attachmentIds = parsed.attachmentIds;
      const personaId = parsed.personaId;
      const research = parseResearchRequest(parsed.research);
      const hasValidAttachmentIds = attachmentIds === undefined || (
        Array.isArray(attachmentIds) &&
        attachmentIds.length <= MAX_ATTACHMENT_IDS_PER_MESSAGE &&
        attachmentIds.every((attachmentId) => Boolean(parseIdentifier(attachmentId)))
      );
      if (
        content === null ||
        !hasValidAttachmentIds ||
        (!content.trim() && (!Array.isArray(attachmentIds) || attachmentIds.length === 0)) ||
        (personaId !== undefined && !parseIdentifier(personaId)) ||
        research === null
      ) {
        return null;
      }

      return {
        type: "message",
        conversationId,
        content,
        ...(attachmentIds !== undefined ? { attachmentIds: attachmentIds as string[] } : {}),
        ...(personaId !== undefined ? { personaId: personaId as string } : {}),
        ...(research !== undefined ? { research } : {})
      };
    }

    if (parsed.type === "queue_message") {
      const content = parseContent(parsed.content);
      return content?.trim() ? { type: "queue_message", conversationId, content } : null;
    }

    const queuedMessageId = parseIdentifier(parsed.queuedMessageId);
    if (parsed.type === "reorder_queued_messages") {
      const queuedMessageIds = parsed.queuedMessageIds;
      if (
        !Array.isArray(queuedMessageIds) ||
        queuedMessageIds.length > MAX_ATTACHMENT_IDS_PER_MESSAGE ||
        queuedMessageIds.some((id) => !parseIdentifier(id)) ||
        new Set(queuedMessageIds).size !== queuedMessageIds.length
      ) {
        return null;
      }
      return {
        type: "reorder_queued_messages",
        conversationId,
        queuedMessageIds: queuedMessageIds as string[]
      };
    }

    if (!queuedMessageId) {
      return null;
    }

    if (parsed.type === "update_queued_message") {
      const content = parseContent(parsed.content);
      return content?.trim()
        ? { type: "update_queued_message", conversationId, queuedMessageId, content }
        : null;
    }

    if (parsed.type === "delete_queued_message" || parsed.type === "send_queued_message_now") {
      return { type: parsed.type, conversationId, queuedMessageId };
    }

    return null;
  } catch {
    return null;
  }
}
