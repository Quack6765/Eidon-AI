import { createAttachments } from "@/lib/attachments";
import { getMessage } from "@/lib/conversations";
import { bindAttachmentsToMessage } from "@/lib/attachments";
import { stripAttachmentStyleImageMarkdown } from "@/lib/assistant-image-markdown";
import { inferAssistantLocalAttachments } from "@/lib/assistant-local-attachments";
import { consumeScreenshotArtifact } from "@/lib/screenshot-artifact-capabilities";
import type { MessageAction } from "@/lib/types";

function appendFailureNotes(content: string, failureNotes: string[]) {
  const trimmed = content.trim();

  if (failureNotes.length === 0) {
    return trimmed;
  }

  const appendedNotes = failureNotes.join("\n\n");
  return trimmed ? `${trimmed}\n\n${appendedNotes}` : appendedNotes;
}

async function sanitizeAssistantContent(
  conversationId: string,
  messageId: string,
  content: string
) {
  const inferred = await inferAssistantLocalAttachments({
    conversationId,
    content,
    existingAttachments: getMessage(messageId)?.attachments ?? [],
    tidyWhitespace: false
  });

  if (inferred.attachments.length > 0) {
    bindAttachmentsToMessage(
      conversationId,
      messageId,
      inferred.attachments.map((attachment) => attachment.id)
    );
  }

  const sanitizedContent = stripAttachmentStyleImageMarkdown(
    inferred.content,
    getMessage(messageId)?.attachments ?? []
  );

  return {
    content: sanitizedContent,
    failureNote: inferred.failureNote
  };
}

export async function attachAssistantFilesFromCompletedAction(conversationId: string, messageId: string, action: MessageAction) {
  if (action.kind !== "shell_command") {
    return;
  }

  const artifact = consumeScreenshotArtifact(action.id);
  if (!artifact) {
    return;
  }

  if ((getMessage(messageId)?.attachments ?? []).some(
    (attachment) => attachment.filename === artifact.filename
  )) {
    return;
  }

  const [attachment] = await createAttachments(conversationId, [artifact]);
  bindAttachmentsToMessage(conversationId, messageId, [attachment.id]);
}

export function createAssistantContentPersistenceTracker(
  conversationId: string,
  messageId: string
) {
  let persistedRawContent = "";
  let persistedSanitizedContent = "";
  const failureNotes: string[] = [];
  const failureNoteSet = new Set<string>();

  const recordFailureNote = (failureNote: string) => {
    if (!failureNote || failureNoteSet.has(failureNote)) {
      return;
    }

    failureNoteSet.add(failureNote);
    failureNotes.push(failureNote);
  };

  return {
    async appendSegment(content: string) {
      if (!content) {
        return "";
      }

      const sanitized = await sanitizeAssistantContent(conversationId, messageId, content);
      persistedRawContent += content;
      persistedSanitizedContent += sanitized.content;
      recordFailureNote(sanitized.failureNote);
      return sanitized.content;
    },
    async finalize(content: string) {
      if (!content) {
        return appendFailureNotes(persistedSanitizedContent, failureNotes);
      }

      if (content.startsWith(persistedRawContent)) {
        const remainder = content.slice(persistedRawContent.length);
        if (remainder) {
          const sanitized = await sanitizeAssistantContent(conversationId, messageId, remainder);
          persistedRawContent += remainder;
          persistedSanitizedContent += sanitized.content;
          recordFailureNote(sanitized.failureNote);
        }

        return appendFailureNotes(persistedSanitizedContent, failureNotes);
      }

      if (!persistedRawContent) {
        const sanitized = await sanitizeAssistantContent(conversationId, messageId, content);
        persistedRawContent = content;
        persistedSanitizedContent = sanitized.content;
        recordFailureNote(sanitized.failureNote);
      }

      return appendFailureNotes(persistedSanitizedContent, failureNotes);
    }
  };
}
