import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export type ParsedMarkdownTarget = {
  start: number;
  end: number;
  target: string;
  isImage: boolean;
};

type MarkdownPosition = {
  start?: { offset?: number | null };
  end?: { offset?: number | null };
};

type MarkdownNode = {
  type: string;
  url?: string | null;
  position?: MarkdownPosition;
  children?: MarkdownNode[];
};

const MARKDOWN_PARSE_OPTIONS = {
  extensions: [gfm()],
  mdastExtensions: [gfmFromMarkdown()]
};

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

function shouldIgnoreEscapedNode(content: string, node: MarkdownNode, start: number) {
  if (node.type !== "link" || start === 0) {
    return false;
  }

  const precedingIndex = start - 1;
  return content[precedingIndex] === "!" && isEscapedCharacter(content, precedingIndex);
}

function collectMarkdownTargets(node: MarkdownNode, content: string, matches: ParsedMarkdownTarget[]) {
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

  for (const child of node.children ?? []) {
    collectMarkdownTargets(child, content, matches);
  }
}

export function findMarkdownTargets(content: string): ParsedMarkdownTarget[] {
  if (!content) {
    return [];
  }

  const tree = fromMarkdown(content, MARKDOWN_PARSE_OPTIONS) as MarkdownNode;
  const matches: ParsedMarkdownTarget[] = [];
  collectMarkdownTargets(tree, content, matches);
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
