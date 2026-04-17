import type { MessageAttachment } from "@/lib/types";

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MARKDOWN_LINK_PATTERN = /(?<!\!)\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const FENCED_CODE_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;
const CODE_SEGMENT_PATTERN = /@@ASSISTANT_CODE_SEGMENT_(\d+)@@/g;

function isExternalTarget(target: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function shouldStripTarget(target: string, attachments: MessageAttachment[]) {
  if (isExternalTarget(target)) {
    return false;
  }

  return attachments.some((attachment) => attachment.relativePath.endsWith(target));
}

function maskCodeSegments(content: string) {
  const segments: string[] = [];

  const maskedFences = content.replace(FENCED_CODE_PATTERN, (match) => {
    const index = segments.push(match) - 1;
    return `@@ASSISTANT_CODE_SEGMENT_${index}@@`;
  });

  const masked = maskedFences.replace(INLINE_CODE_PATTERN, (match) => {
    const index = segments.push(match) - 1;
    return `@@ASSISTANT_CODE_SEGMENT_${index}@@`;
  });

  return { masked, segments };
}

function unmaskCodeSegments(content: string, segments: string[]) {
  return content.replace(CODE_SEGMENT_PATTERN, (_match, rawIndex: string) => {
    const index = Number(rawIndex);
    return segments[index] ?? "";
  });
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

  const { masked, segments } = maskCodeSegments(content);

  const sanitizedImages = masked.replace(MARKDOWN_IMAGE_PATTERN, (match, rawTarget: string) => {
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

  return unmaskCodeSegments(sanitized, segments)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
