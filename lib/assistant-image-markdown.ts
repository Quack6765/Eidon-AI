import type { MessageAttachment } from "@/lib/types";

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MARKDOWN_LINK_PATTERN = /(?<!\!)\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
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

function splitByCodeSegments(content: string) {
  const segments: Array<{ isCode: boolean; text: string }> = [];
  let proseStart = 0;
  let cursor = 0;

  while (cursor < content.length) {
    if (content.startsWith("```", cursor)) {
      if (cursor > proseStart) {
        segments.push({ isCode: false, text: content.slice(proseStart, cursor) });
      }

      const closingFenceIndex = content.indexOf("```", cursor + 3);
      const segmentEnd = closingFenceIndex === -1 ? content.length : closingFenceIndex + 3;
      segments.push({ isCode: true, text: content.slice(cursor, segmentEnd) });
      cursor = segmentEnd;
      proseStart = cursor;
      continue;
    }

    if (content[cursor] === "`") {
      const closingTickIndex = content.indexOf("`", cursor + 1);
      const newlineIndex = content.indexOf("\n", cursor + 1);
      if (closingTickIndex !== -1 && (newlineIndex === -1 || closingTickIndex < newlineIndex)) {
        if (cursor > proseStart) {
          segments.push({ isCode: false, text: content.slice(proseStart, cursor) });
        }

        segments.push({ isCode: true, text: content.slice(cursor, closingTickIndex + 1) });
        cursor = closingTickIndex + 1;
        proseStart = cursor;
        continue;
      }
    }

    cursor += 1;
  }

  if (proseStart < content.length) {
    segments.push({ isCode: false, text: content.slice(proseStart) });
  }

  return segments;
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
