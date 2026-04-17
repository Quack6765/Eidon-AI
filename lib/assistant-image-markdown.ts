import type { MessageAttachment } from "@/lib/types";

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MARKDOWN_LINK_PATTERN = /(?<!\!)\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CODE_SEGMENT_PATTERN = /```[\s\S]*?```|`[^`\n]+`/g;
const ASSISTANT_DATA_IMAGE_PATTERN = /^data:image\/[^;,]+;base64,/i;

function isExternalTarget(target: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function isAssistantDataImageTarget(target: string) {
  return ASSISTANT_DATA_IMAGE_PATTERN.test(target.trim());
}

function shouldStripTarget(target: string, attachments: MessageAttachment[]) {
  if (isAssistantDataImageTarget(target)) {
    return true;
  }

  if (isExternalTarget(target)) {
    return false;
  }

  return attachments.some((attachment) => attachment.relativePath.endsWith(target));
}

function sanitizeProseSegment(content: string, imageAttachments: MessageAttachment[], textAttachments: MessageAttachment[]) {
  const sanitizedImages = content.replace(MARKDOWN_IMAGE_PATTERN, (match, rawTarget: string) => {
    const target = rawTarget.trim();
    if (!shouldStripTarget(target, imageAttachments)) {
      return match;
    }

    return "";
  });

  return sanitizedImages.replace(MARKDOWN_LINK_PATTERN, (match, rawTarget: string) => {
    const target = rawTarget.trim();
    if (!shouldStripTarget(target, textAttachments)) {
      return match;
    }

    return "";
  });
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

  const parts: string[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(CODE_SEGMENT_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push(sanitizeProseSegment(content.slice(lastIndex, start), imageAttachments, textAttachments));
    }

    parts.push(match[0]);
    lastIndex = start + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(sanitizeProseSegment(content.slice(lastIndex), imageAttachments, textAttachments));
  }

  return parts.join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
