import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export type ParsedMarkdownTarget = {
  start: number;
  end: number;
  target: string;
  isImage: boolean;
};

export type ParsedAssistantDataImageTarget =
  | { type: "none" }
  | {
      type: "invalid";
      cacheKey: string;
    }
  | {
      type: "unsupported";
      cacheKey: string;
    }
  | {
      type: "valid";
      cacheKey: string;
      filename: string;
      mimeType: string;
      bytes: Buffer;
    };

type MarkdownPosition = {
  start?: { offset?: number | null };
  end?: { offset?: number | null };
};

type MarkdownNode = {
  type: string;
  url?: string | null;
  identifier?: string | null;
  position?: MarkdownPosition;
  children?: MarkdownNode[];
};

type MarkdownDefinition = {
  start: number;
  end: number;
  target: string;
};

const MARKDOWN_PARSE_OPTIONS = {
  extensions: [gfm()],
  mdastExtensions: [gfmFromMarkdown()]
};

const ASSISTANT_DATA_IMAGE_PREFIX_PATTERN = /^data:image\//i;
const ASSISTANT_DATA_IMAGE_PATTERN = /^data:(image\/[^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i;
const ASSISTANT_DATA_IMAGE_TYPES = new Map<string, { extension: string; mimeType: string }>([
  ["image/png", { extension: "png", mimeType: "image/png" }],
  ["image/jpeg", { extension: "jpeg", mimeType: "image/jpeg" }],
  ["image/jpg", { extension: "jpg", mimeType: "image/jpeg" }],
  ["image/webp", { extension: "webp", mimeType: "image/webp" }],
  ["image/gif", { extension: "gif", mimeType: "image/gif" }]
]);

function isEscapedCharacter(content: string, index: number) {
  let backslashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && content[cursor] === "\\") {
    backslashCount += 1;
    cursor -= 1;
  }

  return backslashCount % 2 === 1;
}

function getNodeOffsets(node: MarkdownNode) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;

  if (typeof start !== "number" || typeof end !== "number" || start < 0 || end <= start) {
    return null;
  }

  return { start, end };
}

function collectDefinitionNodes(node: MarkdownNode, definitions: Map<string, MarkdownDefinition>) {
  if (node.type === "definition" && typeof node.identifier === "string" && typeof node.url === "string") {
    const offsets = getNodeOffsets(node);
    if (offsets && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, {
        start: offsets.start,
        end: offsets.end,
        target: node.url
      });
    }
  }

  for (const child of node.children ?? []) {
    collectDefinitionNodes(child, definitions);
  }
}

function shouldIgnoreEscapedNode(content: string, node: MarkdownNode, start: number) {
  if (node.type !== "link" || start === 0) {
    return false;
  }

  const precedingIndex = start - 1;
  return content[precedingIndex] === "!" && isEscapedCharacter(content, precedingIndex);
}

function collectMarkdownTargets(
  node: MarkdownNode,
  content: string,
  definitions: Map<string, MarkdownDefinition>,
  usedDefinitions: Map<string, boolean>,
  matches: ParsedMarkdownTarget[]
) {
  if ((node.type === "link" || node.type === "image") && typeof node.url === "string") {
    const offsets = getNodeOffsets(node);
    if (offsets && !shouldIgnoreEscapedNode(content, node, offsets.start)) {
      matches.push({
        start: offsets.start,
        end: offsets.end,
        target: node.url,
        isImage: node.type === "image"
      });
    }
  }

  if ((node.type === "linkReference" || node.type === "imageReference") && typeof node.identifier === "string") {
    const offsets = getNodeOffsets(node);
    const definition = definitions.get(node.identifier);
    if (offsets && definition) {
      matches.push({
        start: offsets.start,
        end: offsets.end,
        target: definition.target,
        isImage: node.type === "imageReference"
      });

      if (node.type === "imageReference") {
        usedDefinitions.set(node.identifier, true);
      } else if (!usedDefinitions.has(node.identifier)) {
        usedDefinitions.set(node.identifier, false);
      }
    }
  }

  for (const child of node.children ?? []) {
    collectMarkdownTargets(child, content, definitions, usedDefinitions, matches);
  }
}

export function findMarkdownTargets(content: string): ParsedMarkdownTarget[] {
  if (!content) {
    return [];
  }

  const tree = fromMarkdown(content, MARKDOWN_PARSE_OPTIONS) as MarkdownNode;
  const definitions = new Map<string, MarkdownDefinition>();
  collectDefinitionNodes(tree, definitions);

  const usedDefinitions = new Map<string, boolean>();
  const matches: ParsedMarkdownTarget[] = [];
  collectMarkdownTargets(tree, content, definitions, usedDefinitions, matches);

  for (const [identifier, isImage] of usedDefinitions) {
    const definition = definitions.get(identifier);
    if (!definition) {
      continue;
    }

    matches.push({
      start: definition.start,
      end: definition.end,
      target: definition.target,
      isImage
    });
  }

  matches.sort((left, right) => left.start - right.start);
  return matches;
}

export function normalizeProtectedMarkdownContent(content: string) {
  return content
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/(?:\n[ \t]*)+$/, "")
    .replace(/[ \t]+$/, "");
}

export function decodeMarkdownTarget(target: string) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

export function isExternalMarkdownTarget(target: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
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

export function parseAssistantDataImageTarget(target: string): ParsedAssistantDataImageTarget {
  const trimmedTarget = target.trim();
  if (!ASSISTANT_DATA_IMAGE_PREFIX_PATTERN.test(trimmedTarget)) {
    return { type: "none" };
  }

  const match = ASSISTANT_DATA_IMAGE_PATTERN.exec(trimmedTarget);
  if (!match) {
    return {
      type: "invalid",
      cacheKey: trimmedTarget
    };
  }

  const normalizedMimeType = match[1].toLowerCase();
  const base64Value = match[2];
  const bytes = decodeAssistantDataImageBytes(base64Value);

  if (!bytes) {
    return {
      type: "invalid",
      cacheKey: trimmedTarget
    };
  }

  const supportedType = ASSISTANT_DATA_IMAGE_TYPES.get(normalizedMimeType);
  if (!supportedType) {
    return {
      type: "unsupported",
      cacheKey: trimmedTarget
    };
  }

  return {
    type: "valid",
    cacheKey: trimmedTarget,
    filename: `generated.${supportedType.extension}`,
    mimeType: supportedType.mimeType,
    bytes
  };
}
