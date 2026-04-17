import fs from "node:fs";
import path from "node:path";

import { importAttachmentFromLocalFile } from "@/lib/attachments";
import { env } from "@/lib/env";
import type { MessageAttachment } from "@/lib/types";

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MARKDOWN_LINK_PATTERN = /(?<!\!)\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CODE_SEGMENT_PATTERN = /```[\s\S]*?```|`[^`\n]+`/g;
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

function isExternalTarget(target: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function decodeTarget(target: string) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

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
  return content
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  const resolveTarget = (rawTarget: string): LocalTargetOutcome => {
    const decodedTarget = decodeTarget(rawTarget.trim());
    if (isExternalTarget(decodedTarget) || !path.isAbsolute(decodedTarget)) {
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
    const replaceTarget = (match: string, rawTarget: string) => {
      const outcome = resolveTarget(rawTarget);

      if (outcome.type === "ignore") {
        return match;
      }

      if (outcome.type === "deny") {
        deniedNames.add(outcome.displayName);
        return "";
      }

      if (outcome.type === "error") {
        failedNames.add(outcome.displayName);
        return "";
      }

      return "";
    };

    const withoutImages = segment.replace(MARKDOWN_IMAGE_PATTERN, replaceTarget);
    return withoutImages.replace(MARKDOWN_LINK_PATTERN, replaceTarget);
  };

  const parts: string[] = [];
  let lastIndex = 0;

  for (const match of input.content.matchAll(CODE_SEGMENT_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push(sanitizeProseSegment(input.content.slice(lastIndex, start)));
    }

    parts.push(match[0]);
    lastIndex = start + match[0].length;
  }

  if (lastIndex < input.content.length) {
    parts.push(sanitizeProseSegment(input.content.slice(lastIndex)));
  }

  return {
    content: collapseWhitespace(parts.join("")),
    attachments,
    failureNote: buildFailureNote(deniedNames, failedNames)
  };
}
