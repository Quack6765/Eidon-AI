import fs from "node:fs";
import path from "node:path";

import { createAttachmentsFromBytes, importAttachmentFromLocalFile } from "@/lib/attachments";
import { env } from "@/lib/env";
import type { MessageAttachment } from "@/lib/types";

const CODE_SEGMENT_PATTERN = /```[\s\S]*?```|`[^`\n]+`/g;
const TMP_ROOT = "/tmp";
const ASSISTANT_DATA_IMAGE_PREFIX_PATTERN = /^data:image\//i;
const ASSISTANT_DATA_IMAGE_PATTERN = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i;
const ASSISTANT_DATA_IMAGE_TYPES = new Map<string, { extension: string; mimeType: string }>([
  ["image/png", { extension: "png", mimeType: "image/png" }],
  ["image/jpeg", { extension: "jpeg", mimeType: "image/jpeg" }],
  ["image/jpg", { extension: "jpg", mimeType: "image/jpeg" }],
  ["image/webp", { extension: "webp", mimeType: "image/webp" }],
  ["image/gif", { extension: "gif", mimeType: "image/gif" }]
]);

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

type ParsedMarkdownTarget = {
  start: number;
  end: number;
  target: string;
  isImage: boolean;
};

type ParsedAssistantDataImageTarget =
  | { type: "none" }
  | {
      type: "invalid";
      cacheKey: string;
      displayName: string;
    }
  | {
      type: "valid";
      cacheKey: string;
      displayName: string;
      filename: string;
      mimeType: string;
      bytes: Buffer;
    };

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

function decodeAssistantDataImageBytes(base64Value: string) {
  if (!base64Value || base64Value.length % 4 !== 0) {
    return null;
  }

  const bytes = Buffer.from(base64Value, "base64");
  if (!bytes.length || bytes.toString("base64") !== base64Value) {
    return null;
  }

  return bytes;
}

function parseAssistantDataImageTarget(target: string): ParsedAssistantDataImageTarget {
  const trimmedTarget = target.trim();
  if (!ASSISTANT_DATA_IMAGE_PREFIX_PATTERN.test(trimmedTarget)) {
    return { type: "none" };
  }

  const match = ASSISTANT_DATA_IMAGE_PATTERN.exec(trimmedTarget);
  if (!match) {
    return {
      type: "invalid",
      cacheKey: trimmedTarget,
      displayName: "generated image"
    };
  }

  const normalizedMimeType = match[1].toLowerCase();
  const base64Value = match[2];
  const supportedType = ASSISTANT_DATA_IMAGE_TYPES.get(normalizedMimeType);
  const bytes = decodeAssistantDataImageBytes(base64Value);

  if (!supportedType || !bytes) {
    return {
      type: "invalid",
      cacheKey: trimmedTarget,
      displayName: "generated image"
    };
  }

  return {
    type: "valid",
    cacheKey: trimmedTarget,
    displayName: "generated image",
    filename: `generated.${supportedType.extension}`,
    mimeType: supportedType.mimeType,
    bytes
  };
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

function findMatchingBracket(content: string, startIndex: number) {
  let depth = 0;

  for (let index = startIndex; index < content.length; index += 1) {
    const character = content[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === "[") {
      depth += 1;
      continue;
    }

    if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function parseMarkdownDestination(content: string, openParenIndex: number) {
  let cursor = openParenIndex + 1;

  while (cursor < content.length && (content[cursor] === " " || content[cursor] === "\t")) {
    cursor += 1;
  }

  if (cursor >= content.length) {
    return null;
  }

  if (content[cursor] === "<") {
    const targetParts: string[] = [];
    cursor += 1;

    while (cursor < content.length) {
      const character = content[cursor];

      if (character === "\\") {
        if (cursor + 1 < content.length) {
          targetParts.push(content[cursor + 1]);
          cursor += 2;
          continue;
        }

        targetParts.push(character);
        cursor += 1;
        continue;
      }

      if (character === ">") {
        const target = targetParts.join("");
        cursor += 1;

        while (cursor < content.length && (content[cursor] === " " || content[cursor] === "\t")) {
          cursor += 1;
        }

        if (content[cursor] !== ")") {
          return null;
        }

        return {
          target,
          end: cursor + 1
        };
      }

      targetParts.push(character);
      cursor += 1;
    }

    return null;
  }

  const targetParts: string[] = [];
  let parenDepth = 0;

  while (cursor < content.length) {
    const character = content[cursor];

    if (character === "\\") {
      if (cursor + 1 < content.length) {
        targetParts.push(content[cursor + 1]);
        cursor += 2;
        continue;
      }

      targetParts.push(character);
      cursor += 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      targetParts.push(character);
      cursor += 1;
      continue;
    }

    if (character === ")") {
      if (parenDepth === 0) {
        const target = targetParts.join("").trim();
        if (!target || /\s/.test(target)) {
          return null;
        }

        return {
          target,
          end: cursor + 1
        };
      }

      parenDepth -= 1;
      targetParts.push(character);
      cursor += 1;
      continue;
    }

    if (/\s/.test(character)) {
      return null;
    }

    targetParts.push(character);
    cursor += 1;
  }

  return null;
}

function findMarkdownTargets(content: string): ParsedMarkdownTarget[] {
  const matches: ParsedMarkdownTarget[] = [];

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const isImage = character === "!" && content[index + 1] === "[";
    const labelStart = character === "[" ? index : isImage ? index + 1 : -1;

    if (labelStart === -1) {
      continue;
    }

    const labelEnd = findMatchingBracket(content, labelStart);
    if (labelEnd === -1 || content[labelEnd + 1] !== "(") {
      continue;
    }

    const destination = parseMarkdownDestination(content, labelEnd + 1);
    if (!destination) {
      continue;
    }

    matches.push({
      start: isImage ? index : labelStart,
      end: destination.end,
      target: destination.target,
      isImage
    });
    index = destination.end - 1;
  }

  return matches;
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
      if (parsedDataImage.type === "invalid") {
        const cached = attachmentCache.get(parsedDataImage.cacheKey);
        if (cached) {
          return cached;
        }

        const errorOutcome: LocalTargetOutcome = {
          type: "error",
          displayName: parsedDataImage.displayName
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

    const decodedTarget = decodeTarget(trimmedTarget);
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
