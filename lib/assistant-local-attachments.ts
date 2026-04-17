import fs from "node:fs";
import path from "node:path";

import { createAttachmentsFromBytes, importAttachmentFromLocalFile } from "@/lib/attachments";
import {
  decodeMarkdownTarget,
  findMarkdownTargets,
  isExternalMarkdownTarget,
  normalizeProtectedMarkdownContent,
  parseAssistantDataImageTarget
} from "@/lib/assistant-markdown-parsing";
import { env } from "@/lib/env";
import type { MessageAttachment } from "@/lib/types";

const TMP_ROOT = "/tmp";

type InferAssistantLocalAttachmentsInput = {
  conversationId: string;
  content: string;
  workspaceRoot: string;
};

type InferAssistantLocalAttachmentsResult = {
  content: string;
  attachments: MessageAttachment[];
  failureNote: string;
};

type LocalTargetOutcome =
  | { type: "ignore" }
  | { type: "attach"; attachment: MessageAttachment }
  | { type: "deny"; displayName: string }
  | { type: "error"; displayName: string };

function normalizeRoot(rootPath: string) {
  try {
    return fs.realpathSync(rootPath);
  } catch {
    return path.resolve(rootPath);
  }
}

function isPathInsideRoot(candidatePath: string, rootPath: string) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function collapseWhitespace(content: string) {
  return normalizeProtectedMarkdownContent(content);
}

function buildFailureNote(deniedNames: Set<string>, failedNames: Set<string>) {
  const parts: string[] = [];

  if (deniedNames.size > 0) {
    const deniedList = [...deniedNames].map((name) => `\`${name}\``).join(", ");
    parts.push(`I couldn't attach ${deniedList} because only workspace files and /tmp are allowed.`);
  }

  if (failedNames.size > 0) {
    const failedList = [...failedNames].map((name) => `\`${name}\``).join(", ");
    parts.push(`I couldn't attach ${failedList} because the file could not be imported.`);
  }

  if (parts.length === 0) {
    return "";
  }

  return `Note: ${parts.join(" ")}`;
}

export function inferAssistantLocalAttachments(
  input: InferAssistantLocalAttachmentsInput
): InferAssistantLocalAttachmentsResult {
  if (!input.content) {
    return {
      content: input.content,
      attachments: [],
      failureNote: ""
    };
  }

  const workspaceRoot = normalizeRoot(input.workspaceRoot);
  const tmpRoot = normalizeRoot(TMP_ROOT);
  const appDataRoot = normalizeRoot(env.EIDON_DATA_DIR);
  const attachmentCache = new Map<string, LocalTargetOutcome>();
  const attachments: MessageAttachment[] = [];
  const deniedNames = new Set<string>();
  const failedNames = new Set<string>();

  const resolveTarget = (rawTarget: string, isImage: boolean): LocalTargetOutcome => {
    const trimmedTarget = rawTarget.trim();

    if (isImage) {
      const parsedDataImage = parseAssistantDataImageTarget(trimmedTarget);
      if (parsedDataImage.type === "invalid" || parsedDataImage.type === "unsupported") {
        const cached = attachmentCache.get(parsedDataImage.cacheKey);
        if (cached) {
          return cached;
        }

        const errorOutcome: LocalTargetOutcome = {
          type: "error",
          displayName: "generated image"
        };
        attachmentCache.set(parsedDataImage.cacheKey, errorOutcome);
        return errorOutcome;
      }

      if (parsedDataImage.type === "valid") {
        const cached = attachmentCache.get(parsedDataImage.cacheKey);
        if (cached) {
          return cached;
        }

        try {
          const [attachment] = createAttachmentsFromBytes(input.conversationId, [
            {
              filename: parsedDataImage.filename,
              mimeType: parsedDataImage.mimeType,
              bytes: parsedDataImage.bytes
            }
          ]);
          const attachOutcome: LocalTargetOutcome = { type: "attach", attachment };
          attachmentCache.set(parsedDataImage.cacheKey, attachOutcome);
          attachments.push(attachment);
          return attachOutcome;
        } catch {
          const errorOutcome: LocalTargetOutcome = {
            type: "error",
            displayName: parsedDataImage.displayName
          };
          attachmentCache.set(parsedDataImage.cacheKey, errorOutcome);
          return errorOutcome;
        }
      }
    }

    const decodedTarget = decodeMarkdownTarget(trimmedTarget);
    if (isExternalMarkdownTarget(decodedTarget) || !path.isAbsolute(decodedTarget)) {
      return { type: "ignore" };
    }

    let canonicalPath: string;
    try {
      canonicalPath = fs.realpathSync(decodedTarget);
    } catch {
      return { type: "error", displayName: path.basename(decodedTarget) || decodedTarget };
    }

    const cached = attachmentCache.get(canonicalPath);
    if (cached) {
      return cached;
    }

    const displayName = path.basename(decodedTarget) || decodedTarget;
    const allowedByRoot = isPathInsideRoot(canonicalPath, workspaceRoot) || isPathInsideRoot(canonicalPath, tmpRoot);
    const blockedByAppData = appDataRoot ? isPathInsideRoot(canonicalPath, appDataRoot) : false;

    if (!allowedByRoot || blockedByAppData) {
      const deniedOutcome: LocalTargetOutcome = { type: "deny", displayName };
      attachmentCache.set(canonicalPath, deniedOutcome);
      return deniedOutcome;
    }

    try {
      const attachment = importAttachmentFromLocalFile(input.conversationId, canonicalPath);
      const attachOutcome: LocalTargetOutcome = { type: "attach", attachment };
      attachmentCache.set(canonicalPath, attachOutcome);
      attachments.push(attachment);
      return attachOutcome;
    } catch {
      const errorOutcome: LocalTargetOutcome = { type: "error", displayName };
      attachmentCache.set(canonicalPath, errorOutcome);
      return errorOutcome;
    }
  };

  const sanitizeProseSegment = (segment: string) => {
    const matches = findMarkdownTargets(segment);
    if (matches.length === 0) {
      return segment;
    }

    const parts: string[] = [];
    let cursor = 0;

    for (const match of matches) {
      const outcome = resolveTarget(match.target, match.isImage);
      if (outcome.type === "ignore") {
        continue;
      }

      parts.push(segment.slice(cursor, match.start));

      if (outcome.type === "deny") {
        deniedNames.add(outcome.displayName);
      } else if (outcome.type === "error") {
        failedNames.add(outcome.displayName);
      }

      cursor = match.end;
    }

    parts.push(segment.slice(cursor));
    return parts.join("");
  };

  const sanitizedContent = sanitizeProseSegment(input.content);

  return {
    content: collapseWhitespace(sanitizedContent),
    attachments,
    failureNote: buildFailureNote(deniedNames, failedNames)
  };
}
