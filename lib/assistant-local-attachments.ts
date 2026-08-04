import fs from "node:fs";
import path from "node:path";

import { createAttachments, importAttachmentFromLocalFile } from "@/lib/attachments";
import {
  decodeMarkdownTarget,
  findMarkdownTargets,
  isExternalMarkdownTarget,
  normalizeProtectedMarkdownContentOutsideCodeBlocks,
  parseAssistantDataImageTarget
} from "@/lib/assistant-markdown-parsing";
import { env } from "@/lib/env";
import type { MessageAttachment } from "@/lib/types";

const GENERATED_IMAGE_DISPLAY_NAME = "generated image";
const FILE_TIMESTAMP_TOLERANCE_MS = 5_000;

type InferAssistantLocalAttachmentsInput = {
  conversationId: string;
  content: string;
  workspaceRoot?: string;
  authorizedLocalPaths?: string[];
  existingAttachments?: MessageAttachment[];
  tidyWhitespace?: boolean;
};

type InferAssistantLocalAttachmentsResult = {
  content: string;
  attachments: MessageAttachment[];
  failureNote: string;
};

type LocalTargetOutcome =
  | { type: "ignore" }
  | { type: "attach"; attachment: MessageAttachment }
  | { type: "already_attached"; displayName: string }
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
  return normalizeProtectedMarkdownContentOutsideCodeBlocks(content);
}

function buildFailureNote(deniedNames: Set<string>, failedNames: Set<string>) {
  const parts: string[] = [];

  if (deniedNames.size > 0) {
    const deniedList = [...deniedNames].map((name) => `\`${name}\``).join(", ");
    parts.push(`I couldn't attach ${deniedList} because the file was not produced by a completed tool action in this turn.`);
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

export async function importAssistantLocalFileAttachment(input: {
  conversationId: string;
  sourcePath: string;
  authorizedLocalPaths: string[];
  createdAfter?: string;
  createdBefore?: string;
  existingAttachments?: MessageAttachment[];
}): Promise<LocalTargetOutcome> {
  if (isExternalMarkdownTarget(input.sourcePath) || !path.isAbsolute(input.sourcePath)) {
    return { type: "ignore" };
  }

  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync(input.sourcePath);
  } catch {
    return { type: "error", displayName: path.basename(input.sourcePath) || input.sourcePath };
  }

  const displayName = path.basename(input.sourcePath) || input.sourcePath;
  if ((input.existingAttachments ?? []).some((attachment) => attachment.filename === displayName)) {
    return { type: "already_attached", displayName };
  }

  const appDataRoot = normalizeRoot(env.EIDON_DATA_DIR);
  const blockedByAppData = appDataRoot ? isPathInsideRoot(canonicalPath, appDataRoot) : false;
  const authorizedPaths = new Set(
    input.authorizedLocalPaths.flatMap((authorizedPath) => {
      try {
        return [fs.realpathSync(authorizedPath)];
      } catch {
        return [];
      }
    })
  );

  if (!authorizedPaths.has(canonicalPath) || blockedByAppData) {
    return { type: "deny", displayName };
  }

  try {
    if (fs.lstatSync(input.sourcePath).isSymbolicLink()) {
      return { type: "deny", displayName };
    }

    const stats = fs.statSync(canonicalPath);
    const createdAfter = input.createdAfter ? new Date(input.createdAfter).getTime() : null;
    const createdBefore = input.createdBefore ? new Date(input.createdBefore).getTime() : null;

    if (
      (createdAfter !== null && stats.mtimeMs < createdAfter - FILE_TIMESTAMP_TOLERANCE_MS) ||
      (createdBefore !== null && stats.mtimeMs > createdBefore + FILE_TIMESTAMP_TOLERANCE_MS)
    ) {
      return { type: "deny", displayName };
    }
  } catch {
    return { type: "error", displayName };
  }

  try {
    const attachment = await importAttachmentFromLocalFile(input.conversationId, canonicalPath);
    return { type: "attach", attachment };
  } catch {
    return { type: "error", displayName };
  }
}

export async function inferAssistantLocalAttachments(
  input: InferAssistantLocalAttachmentsInput
): Promise<InferAssistantLocalAttachmentsResult> {
  if (!input.content) {
    return {
      content: input.content,
      attachments: [],
      failureNote: ""
    };
  }

  const attachmentCache = new Map<string, LocalTargetOutcome>();
  const attachments: MessageAttachment[] = [];
  const deniedNames = new Set<string>();
  const failedNames = new Set<string>();

  const resolveTarget = async (rawTarget: string, isImage: boolean): Promise<LocalTargetOutcome> => {
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
          displayName: GENERATED_IMAGE_DISPLAY_NAME
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
          const [attachment] = await createAttachments(input.conversationId, [
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
            displayName: GENERATED_IMAGE_DISPLAY_NAME
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

    const outcome = await importAssistantLocalFileAttachment({
      conversationId: input.conversationId,
      sourcePath: decodedTarget,
      authorizedLocalPaths: input.authorizedLocalPaths ?? [],
      existingAttachments: [...(input.existingAttachments ?? []), ...attachments]
    });

    attachmentCache.set(canonicalPath, outcome);
    if (outcome.type === "attach") {
      attachments.push(outcome.attachment);
    }

    return outcome;
  };

  const sanitizeProseSegment = async (segment: string) => {
    const matches = findMarkdownTargets(segment);
    if (matches.length === 0) {
      return segment;
    }

    const parts: string[] = [];
    let cursor = 0;

    for (const match of matches) {
      const outcomes = match.definitionUsage
        ? await Promise.all([
            ...(match.definitionUsage.link ? [resolveTarget(match.target, false)] : []),
            ...(match.definitionUsage.image ? [resolveTarget(match.target, true)] : [])
          ])
        : [await resolveTarget(match.target, match.isImage)];

      const shouldStrip = outcomes.every((outcome) => outcome.type !== "ignore");
      if (!shouldStrip) {
        continue;
      }

      parts.push(segment.slice(cursor, match.start));

      for (const outcome of outcomes) {
        if (outcome.type === "deny") {
          deniedNames.add(outcome.displayName);
        } else if (outcome.type === "error") {
          failedNames.add(outcome.displayName);
        }
      }

      cursor = match.end;
    }

    parts.push(segment.slice(cursor));
    return parts.join("");
  };

  const sanitizedContent = await sanitizeProseSegment(input.content);

  return {
    content: input.tidyWhitespace === false ? sanitizedContent : collapseWhitespace(sanitizedContent),
    attachments,
    failureNote: buildFailureNote(deniedNames, failedNames)
  };
}
