export type ParsedMarkdownTarget = {
  start: number;
  end: number;
  target: string;
  isImage: boolean;
};

function readRepeatedRun(content: string, startIndex: number, marker: string) {
  let cursor = startIndex;

  while (cursor < content.length && content[cursor] === marker) {
    cursor += 1;
  }

  return cursor - startIndex;
}

function hasExactRun(content: string, startIndex: number, marker: string, runLength: number) {
  if (startIndex < 0 || startIndex + runLength > content.length) {
    return false;
  }

  for (let index = 0; index < runLength; index += 1) {
    if (content[startIndex + index] !== marker) {
      return false;
    }
  }

  return content[startIndex + runLength] !== marker;
}

function findLineEnd(content: string, lineStart: number) {
  const newlineIndex = content.indexOf("\n", lineStart);
  return newlineIndex === -1 ? content.length : newlineIndex;
}

function nextLineStart(content: string, lineStart: number) {
  const lineEnd = findLineEnd(content, lineStart);
  return lineEnd < content.length ? lineEnd + 1 : content.length;
}

function findClosingInlineCodeSpan(content: string, searchStart: number, runLength: number) {
  for (let cursor = searchStart; cursor < content.length; cursor += 1) {
    if (content[cursor] !== "`") {
      continue;
    }

    if (hasExactRun(content, cursor, "`", runLength)) {
      return cursor;
    }
  }

  return -1;
}

function splitInlineCodeSegments(content: string) {
  const segments: Array<{ isCode: boolean; text: string }> = [];
  let proseStart = 0;
  let cursor = 0;

  while (cursor < content.length) {
    if (content[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    const runLength = readRepeatedRun(content, cursor, "`");
    if (runLength === 0) {
      cursor += 1;
      continue;
    }

    const closingSpanIndex = findClosingInlineCodeSpan(content, cursor + runLength, runLength);
    if (closingSpanIndex !== -1) {
      if (cursor > proseStart) {
        segments.push({ isCode: false, text: content.slice(proseStart, cursor) });
      }

      const segmentEnd = closingSpanIndex + runLength;
      segments.push({ isCode: true, text: content.slice(cursor, segmentEnd) });
      cursor = segmentEnd;
      proseStart = cursor;
      continue;
    }

    cursor += runLength;
  }

  if (proseStart < content.length) {
    segments.push({ isCode: false, text: content.slice(proseStart) });
  }

  return segments;
}

function countFenceIndent(content: string, lineStart: number, lineEnd: number) {
  let cursor = lineStart;
  let indent = 0;

  while (cursor < lineEnd && content[cursor] === " " && indent < 3) {
    cursor += 1;
    indent += 1;
  }

  return cursor;
}

function parseFenceStart(content: string, lineStart: number, lineEnd: number) {
  const markerStart = countFenceIndent(content, lineStart, lineEnd);
  if (markerStart >= lineEnd) {
    return null;
  }

  const marker = content[markerStart];
  if (marker !== "`" && marker !== "~") {
    return null;
  }

  const runLength = readRepeatedRun(content, markerStart, marker);
  if (runLength < 3) {
    return null;
  }

  return { marker, runLength };
}

function isClosingFenceLine(
  content: string,
  lineStart: number,
  lineEnd: number,
  marker: string,
  minimumRunLength: number
) {
  const markerStart = countFenceIndent(content, lineStart, lineEnd);
  if (markerStart >= lineEnd || content[markerStart] !== marker) {
    return false;
  }

  const runLength = readRepeatedRun(content, markerStart, marker);
  if (runLength < minimumRunLength) {
    return false;
  }

  for (let cursor = markerStart + runLength; cursor < lineEnd; cursor += 1) {
    if (content[cursor] !== " " && content[cursor] !== "\t") {
      return false;
    }
  }

  return true;
}

function isBlankLine(content: string, lineStart: number, lineEnd: number) {
  for (let cursor = lineStart; cursor < lineEnd; cursor += 1) {
    if (content[cursor] !== " " && content[cursor] !== "\t") {
      return false;
    }
  }

  return true;
}

function isIndentedCodeLine(content: string, lineStart: number, lineEnd: number) {
  if (lineStart >= lineEnd) {
    return false;
  }

  if (content[lineStart] === "\t") {
    return true;
  }

  return content.startsWith("    ", lineStart);
}

export function splitByCodeSegments(content: string) {
  const blockSegments: Array<{ isCode: boolean; text: string }> = [];
  let proseStart = 0;
  let lineStart = 0;

  while (lineStart < content.length) {
    const lineEnd = findLineEnd(content, lineStart);
    const fence = parseFenceStart(content, lineStart, lineEnd);

    if (fence) {
      if (lineStart > proseStart) {
        blockSegments.push({ isCode: false, text: content.slice(proseStart, lineStart) });
      }

      let blockEnd = nextLineStart(content, lineStart);
      let searchLineStart = blockEnd;

      while (searchLineStart < content.length) {
        const searchLineEnd = findLineEnd(content, searchLineStart);
        if (isClosingFenceLine(content, searchLineStart, searchLineEnd, fence.marker, fence.runLength)) {
          blockEnd = nextLineStart(content, searchLineStart);
          break;
        }

        searchLineStart = nextLineStart(content, searchLineStart);
        blockEnd = searchLineStart;
      }

      blockSegments.push({ isCode: true, text: content.slice(lineStart, blockEnd) });
      proseStart = blockEnd;
      lineStart = blockEnd;
      continue;
    }

    if (isIndentedCodeLine(content, lineStart, lineEnd)) {
      if (lineStart > proseStart) {
        blockSegments.push({ isCode: false, text: content.slice(proseStart, lineStart) });
      }

      let blockEnd = nextLineStart(content, lineStart);
      let searchLineStart = blockEnd;

      while (searchLineStart < content.length) {
        const searchLineEnd = findLineEnd(content, searchLineStart);
        if (!isBlankLine(content, searchLineStart, searchLineEnd) &&
            !isIndentedCodeLine(content, searchLineStart, searchLineEnd)) {
          break;
        }

        searchLineStart = nextLineStart(content, searchLineStart);
        blockEnd = searchLineStart;
      }

      blockSegments.push({ isCode: true, text: content.slice(lineStart, blockEnd) });
      proseStart = blockEnd;
      lineStart = blockEnd;
      continue;
    }

    lineStart = nextLineStart(content, lineStart);
  }

  if (proseStart < content.length) {
    blockSegments.push({ isCode: false, text: content.slice(proseStart) });
  }

  return blockSegments.flatMap((segment) => (segment.isCode ? [segment] : splitInlineCodeSegments(segment.text)));
}

export function normalizeProtectedMarkdownContent(content: string) {
  return content
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/(?:\n[ \t]*)+$/, "")
    .replace(/[ \t]+$/, "");
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

function parseMarkdownTitle(content: string, startIndex: number) {
  const opener = content[startIndex];
  const closer = opener === "(" ? ")" : opener;
  if (opener !== `"` && opener !== `'` && opener !== "(") {
    return null;
  }

  let cursor = startIndex + 1;

  while (cursor < content.length) {
    const character = content[cursor];

    if (character === "\\") {
      cursor += 2;
      continue;
    }

    if (character === closer) {
      return cursor + 1;
    }

    cursor += 1;
  }

  return null;
}

function finalizeMarkdownDestination(content: string, startIndex: number, target: string) {
  let cursor = startIndex;

  while (cursor < content.length && (content[cursor] === " " || content[cursor] === "\t")) {
    cursor += 1;
  }

  if (cursor >= content.length) {
    return null;
  }

  if (content[cursor] === ")") {
    return {
      target,
      end: cursor + 1
    };
  }

  const afterTitle = parseMarkdownTitle(content, cursor);
  if (afterTitle === null) {
    return null;
  }

  cursor = afterTitle;
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
        return finalizeMarkdownDestination(content, cursor + 1, target);
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
        if (!target) {
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
      const target = targetParts.join("").trim();
      if (!target) {
        return null;
      }

      return finalizeMarkdownDestination(content, cursor, target);
    }

    targetParts.push(character);
    cursor += 1;
  }

  return null;
}

export function findMarkdownTargets(content: string): ParsedMarkdownTarget[] {
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
