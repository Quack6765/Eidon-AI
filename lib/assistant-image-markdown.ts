import type { MessageAttachment } from "@/lib/types";

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MARKDOWN_LINK_PATTERN = /(?<!\!)\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isExternalTarget(target: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function shouldStripTarget(target: string, attachments: MessageAttachment[]) {
  if (isExternalTarget(target)) {
    return false;
  }

  return attachments.some((attachment) => attachment.relativePath.endsWith(target));
}

export function stripAttachmentStyleImageMarkdown(
  content: string,
  attachments: MessageAttachment[] = []
) {
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const textAttachments = attachments.filter((attachment) => attachment.kind === "text");
  if (!content || (imageAttachments.length === 0 && textAttachments.length === 0)) {
    return content;
  }

  const sanitizedImages = content.replace(MARKDOWN_IMAGE_PATTERN, (match, rawTarget: string) => {
    const target = rawTarget.trim();
    if (!shouldStripTarget(target, imageAttachments)) {
      return match;
    }

    return "";
  });

  const sanitized = sanitizedImages.replace(MARKDOWN_LINK_PATTERN, (match, rawTarget: string) => {
    const target = rawTarget.trim();
    if (!shouldStripTarget(target, textAttachments)) {
      return match;
    }

    return "";
  });

  return sanitized
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
