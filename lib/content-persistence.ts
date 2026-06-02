import { bindAttachmentsToMessage, getMessage } from "@/lib/conversations";
import { stripAttachmentStyleImageMarkdown } from "@/lib/assistant-image-markdown";
import { inferAssistantLocalAttachments, importAssistantLocalFileAttachment } from "@/lib/assistant-local-attachments";
import type { MessageAction } from "@/lib/types";
import { extractAgentBrowserScreenshotPaths } from "./shell-tokenizer";

function appendFailureNotes(content: string, failureNotes: string[]) {
  const trimmed = content.trim();

  if (failureNotes.length === 0) {
    return trimmed;
  }

  const appendedNotes = failureNotes.join("\n\n");
  return trimmed ? `${trimmed}\n\n${appendedNotes}` : appendedNotes;
}

function sanitizeAssistantContent(
  conversationId: string,
  messageId: string,
  content: string
) {
  const inferred = inferAssistantLocalAttachments({
    conversationId,
    content,
    workspaceRoot: process.cwd(),
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

export function attachAssistantFilesFromCompletedAction(conversationId: string, messageId: string, action: MessageAction) {
  if (action.kind !== "shell_command") {
    return;
  }

  const command =
    typeof action.arguments?.command === "string"
      ? action.arguments.command.trim()
      : action.detail.trim();

  if (!command) {
    return;
  }

  const screenshotPaths = extractAgentBrowserScreenshotPaths(command);
  if (!screenshotPaths.length) {
    return;
  }

  const attachmentIds: string[] = [];
  const existingAttachments = [...(getMessage(messageId)?.attachments ?? [])];

  for (const screenshotPath of screenshotPaths) {
    const outcome = importAssistantLocalFileAttachment({
      conversationId,
      sourcePath: screenshotPath,
      workspaceRoot: process.cwd(),
      existingAttachments
    });

    if (outcome.type !== "attach") {
      continue;
    }

    attachmentIds.push(outcome.attachment.id);
    existingAttachments.push(outcome.attachment);
  }

  if (attachmentIds.length > 0) {
    bindAttachmentsToMessage(conversationId, messageId, attachmentIds);
  }
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
    appendSegment(content: string) {
      if (!content) {
        return "";
      }

      const sanitized = sanitizeAssistantContent(conversationId, messageId, content);
      persistedRawContent += content;
      persistedSanitizedContent += sanitized.content;
      recordFailureNote(sanitized.failureNote);
      return sanitized.content;
    },
    finalize(content: string) {
      if (!content) {
        return appendFailureNotes(persistedSanitizedContent, failureNotes);
      }

      if (content.startsWith(persistedRawContent)) {
        const remainder = content.slice(persistedRawContent.length);
        if (remainder) {
          const sanitized = sanitizeAssistantContent(conversationId, messageId, remainder);
          persistedRawContent += remainder;
          persistedSanitizedContent += sanitized.content;
          recordFailureNote(sanitized.failureNote);
        }

        return appendFailureNotes(persistedSanitizedContent, failureNotes);
      }

      if (!persistedRawContent) {
        const sanitized = sanitizeAssistantContent(conversationId, messageId, content);
        persistedRawContent = content;
        persistedSanitizedContent = sanitized.content;
        recordFailureNote(sanitized.failureNote);
      }

      return appendFailureNotes(persistedSanitizedContent, failureNotes);
    }
  };
}
