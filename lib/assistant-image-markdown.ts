import type { MessageAttachment } from "@/lib/types";
import {
  decodeMarkdownTarget,
  findMarkdownTargets,
  isExternalMarkdownTarget,
  normalizeProtectedMarkdownContent
} from "@/lib/assistant-markdown-parsing";

const ASSISTANT_DATA_IMAGE_PATTERN = /^data:image\/[^;,]+;base64,/i;

function sanitizeProseSegment(content: string, imageAttachments: MessageAttachment[], textAttachments: MessageAttachment[]) {
  const matches = findMarkdownTargets(content);
  if (matches.length === 0) {
    return { content, changed: false };
  }

  const buildLocalTargetSet = (attachments: MessageAttachment[]) =>
    new Set(attachments.flatMap((attachment) => [attachment.filename, attachment.relativePath]));

  const imageAttachmentTargets = buildLocalTargetSet(imageAttachments);
  const textAttachmentTargets = buildLocalTargetSet(textAttachments);
  const parts: string[] = [];
  let cursor = 0;
  let changed = false;

  for (const match of matches) {
    const normalizedTarget = decodeMarkdownTarget(match.target.trim());
    const shouldStrip = match.isImage
      ? ASSISTANT_DATA_IMAGE_PATTERN.test(normalizedTarget) ||
        (!isExternalMarkdownTarget(normalizedTarget) && imageAttachmentTargets.has(normalizedTarget))
      : !isExternalMarkdownTarget(normalizedTarget) &&
        textAttachmentTargets.has(normalizedTarget);

    if (!shouldStrip) {
      continue;
    }

    parts.push(content.slice(cursor, match.start));
    cursor = match.end;
    changed = true;
  }

  if (!changed) {
    return { content, changed: false };
  }

  parts.push(content.slice(cursor));
  return { content: parts.join(""), changed: true };
}

export function stripAttachmentStyleImageMarkdown(
  content: string,
  attachments: MessageAttachment[] = []
) {
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const textAttachments = attachments.filter((attachment) => attachment.kind === "text");
  if (!content) {
    return content;
  }

  const sanitized = sanitizeProseSegment(content, imageAttachments, textAttachments);

  if (!sanitized.changed) {
    return content;
  }

  return normalizeProtectedMarkdownContent(sanitized.content);
}
