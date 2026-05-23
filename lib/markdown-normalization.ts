import type { RemendHandler } from "remend";

const ATX_HEADING_NO_SPACE = /^(#{1,6})([^#\s\n])/gm;
const HR_FUSED_BEFORE = /^(-{3,})(?=[^\n])/gm;
const HR_FUSED_AFTER = /(?<=\S)(-{3,})$/gm;

const INLINE_TABLE_OPENER = /([^\s|])(\| [^ |-])/g;
const INLINE_LIST_MARKER = /([^\s*_|>#`])([-]\s(?:\[[ x]\]\s)?)/g;
const INLINE_ORDERED_MARKER = /([^\s\d.)_<>(#`])(\d+[.)]\s)/g;
const INLINE_HEADING_MARKER = /([^\s#_|>#`])(#{1,6}\s\S)/g;

function splitAroundCodeFences(text: string): { text: string; insideCode: boolean }[] {
  const parts: { text: string; insideCode: boolean }[] = [];
  const fenceRegex = /^(`{3,})/gm;
  let lastEnd = 0;

  while (true) {
    const match = fenceRegex.exec(text);
    if (!match) break;

    const fenceStart = match.index;
    const fenceLen = match[1].length;
    const afterFence = fenceStart + fenceLen;
    const rest = text.slice(afterFence);
    const closeFence = rest.match(new RegExp(`\n((?:[ \t]*\n)?)` + "`".repeat(fenceLen) + `[ \t]*$`, "m"));

    if (closeFence) {
      const codeEnd = afterFence + (closeFence.index ?? 0) + closeFence[0].length;
      if (fenceStart > lastEnd) {
        parts.push({ text: text.slice(lastEnd, fenceStart), insideCode: false });
      }
      parts.push({ text: text.slice(fenceStart, codeEnd), insideCode: true });
      lastEnd = codeEnd;
      fenceRegex.lastIndex = codeEnd;
    } else {
      break;
    }
  }

  if (lastEnd < text.length) {
    parts.push({ text: text.slice(lastEnd), insideCode: false });
  }

  return parts.length > 0 ? parts : [{ text, insideCode: false }];
}

function applyOutsideCodeBlocks(text: string, fn: (t: string) => string): string {
  const parts = splitAroundCodeFences(text);
  return parts.map((part) => (part.insideCode ? part.text : fn(part.text))).join("");
}

function fixAtxHeadingSpace(text: string): string {
  return text.replace(ATX_HEADING_NO_SPACE, "$1 $2");
}

function fixHorizontalRuleFusion(text: string): string {
  let result = text;
  result = result.replace(HR_FUSED_BEFORE, "\n\n---\n\n");
  result = result.replace(HR_FUSED_AFTER, "\n\n---\n\n");
  return result;
}

function fixInlineBlockMarkersInner(text: string): string {
  let result = text;

  result = result.replace(INLINE_HEADING_MARKER, "$1\n$2");

  result = result.replace(INLINE_TABLE_OPENER, "$1\n$2");

  result = result.replace(INLINE_ORDERED_MARKER, (match, before, marker) => {
    if (/[0-9.]/.test(before)) return match;
    return `${before}\n${marker}`;
  });

  result = result.replace(INLINE_LIST_MARKER, (match, before, marker) => {
    if (before === "|" || before === ">" || before === "-") return match;
    return `${before}\n${marker}`;
  });

  return result;
}

function fixInlineBlockMarkers(text: string): string {
  return applyOutsideCodeBlocks(text, fixInlineBlockMarkersInner);
}

type BlockKind = "heading" | "code-fence" | "blockquote" | "table" | "unordered-list" | "ordered-list" | "hr" | "other";

function classifyLine(line: string): BlockKind {
  const trimmed = line.trimStart();

  if (/^#{1,6}\s/.test(trimmed)) return "heading";
  if (/^`{3,}/.test(trimmed)) return "code-fence";
  if (/^>\s?/.test(trimmed)) return "blockquote";
  if (/^\|/.test(trimmed)) return "table";
  if (/^[-*+]\s/.test(trimmed)) return "unordered-list";
  if (/^\d+[.)]\s/.test(trimmed)) return "ordered-list";
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) return "hr";
  return "other";
}

function needsBlankLineBetween(prevKind: BlockKind, currentKind: BlockKind, currentIndent: number): boolean {
  if (currentIndent > 0 && (currentKind === "unordered-list" || currentKind === "ordered-list")) {
    return false;
  }

  if (prevKind === "heading" || currentKind === "heading") {
    return true;
  }

  if (prevKind === currentKind) {
    return false;
  }

  return true;
}

function ensureBlockBlankLines(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let insideFence = false;
  let insideTable = false;
  let prevBlockKind: BlockKind | null = null;
  let rootListKind: BlockKind | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (/^`{3,}/.test(trimmed) && !insideFence) {
      insideFence = true;
      const prevLine = result.length > 0 ? result[result.length - 1] : "";
      if (i > 0 && prevLine.trim() !== "") {
        result.push("");
      }
      result.push(line);
      prevBlockKind = "code-fence";
      rootListKind = null;
      continue;
    }

    if (/^`{3,}/.test(trimmed) && insideFence) {
      insideFence = false;
      result.push(line);
      prevBlockKind = "code-fence";
      rootListKind = null;
      continue;
    }

    if (insideFence) {
      result.push(line);
      continue;
    }

    if (/^\|/.test(trimmed)) {
      if (!insideTable) {
        insideTable = true;
        const prevLine = result.length > 0 ? result[result.length - 1] : "";
        if (i > 0 && prevLine.trim() !== "" && prevBlockKind !== "table") {
          result.push("");
        }
      }
      result.push(line);
      prevBlockKind = "table";
      rootListKind = null;
      continue;
    }

    if (insideTable && trimmed !== "" && !/^\|/.test(trimmed)) {
      insideTable = false;
    }

    const kind = classifyLine(line);
    const indent = line.length - trimmed.length;
    const prevLine = result.length > 0 ? result[result.length - 1] : "";
    const prevIsBlank = prevLine.trim() === "";

    if (indent === 0 && (kind === "ordered-list" || kind === "unordered-list")) {
      if (rootListKind === kind && !prevIsBlank) {
        result.push(line);
        prevBlockKind = kind;
        continue;
      }
      rootListKind = kind;
    } else if (indent > 0 && (kind === "ordered-list" || kind === "unordered-list")) {
      result.push(line);
      prevBlockKind = kind;
      continue;
    } else if (kind !== "ordered-list" && kind !== "unordered-list") {
      rootListKind = null;
    }

    if (i > 0 && !prevIsBlank && prevBlockKind !== null && needsBlankLineBetween(prevBlockKind, kind, indent)) {
      result.push("");
    }

    result.push(line);
    prevBlockKind = kind;
  }

  return result.join("\n");
}

function fixCollapsedTableRowsInner(text: string): string {
  let result = text;
  result = result.replace(/\|\|(?=\s*[`!*\w])/g, "|\n|");
  result = result.replace(/(\|) (\| \w)/g, "$1\n$2");
  result = result.replace(/(\|)(#{1,6}\s\S)/g, "$1\n$2");
  return result;
}

function fixCollapsedTableRows(text: string): string {
  return applyOutsideCodeBlocks(text, fixCollapsedTableRowsInner);
}

export function normalizeMarkdown(text: string): string {
  let result = text;
  result = applyOutsideCodeBlocks(result, fixAtxHeadingSpace);
  result = applyOutsideCodeBlocks(result, fixHorizontalRuleFusion);
  result = fixInlineBlockMarkers(result);
  result = fixCollapsedTableRows(result);
  result = ensureBlockBlankLines(result);
  return result;
}

export const MARKDOWN_REMEND_HANDLERS: RemendHandler[] = [
  {
    name: "fix-atx-heading-space",
    handle: fixAtxHeadingSpace,
    priority: -5,
  },
  {
    name: "fix-horizontal-rule-fusion",
    handle: fixHorizontalRuleFusion,
    priority: -5,
  },
];
