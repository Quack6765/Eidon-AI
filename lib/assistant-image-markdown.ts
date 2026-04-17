import type { MessageAttachment } from "@/lib/types";
import {
  findMarkdownTargets,
  getMarkdownTargetFilename,
  isExternalMarkdownTarget,
  splitByCodeSegments
} from "@/lib/assistant-markdown-parsing";

const ASSISTANT_DATA_IMAGE_PATTERN = /^data:image\/[^;,]+;base64,/i;

function sanitizeProseSegment(content: string, imageAttachments: MessageAttachment[], textAttachments: MessageAttachment[]) {
  const matches = findMarkdownTargets(content);
  if (matches.length === 0) {
    return content;
  }

  const imageAttachmentNames = new Set(imageAttachments.map((attachment) => attachment.filename));
  const textAttachmentNames = new Set(textAttachments.map((attachment) => attachment.filename));
  const parts: string[] = [];
  let cursor = 0;

  for (const match of matches) {
    const normalizedTarget = match.target.trim();
    const shouldStrip = match.isImage
      ? ASSISTANT_DATA_IMAGE_PATTERN.test(normalizedTarget) ||
        (!isExternalMarkdownTarget(normalizedTarget) &&
          imageAttachmentNames.has(getMarkdownTargetFilename(normalizedTarget)))
      : !isExternalMarkdownTarget(normalizedTarget) &&
        textAttachmentNames.has(getMarkdownTargetFilename(normalizedTarget));

    if (!shouldStrip) {
      continue;
    }

    parts.push(content.slice(cursor, match.start));
    cursor = match.end;
  }

  parts.push(content.slice(cursor));
  return parts.join("");
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

  const parts = splitByCodeSegments(content).map((segment) =>
    segment.isCode ? segment.text : sanitizeProseSegment(segment.text, imageAttachments, textAttachments)
  );

  return parts.join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
