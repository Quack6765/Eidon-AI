export type ParsedMarkdownTarget = {
  start: number;
  end: number;
  target: string;
  isImage: boolean;
};

function readBacktickRun(content: string, startIndex: number) {
  let cursor = startIndex;

  while (cursor < content.length && content[cursor] === "`") {
    cursor += 1;
  }

  return cursor - startIndex;
}

function hasExactBacktickRun(content: string, startIndex: number, runLength: number) {
  if (startIndex < 0 || startIndex + runLength > content.length) {
    return false;
  }

  for (let index = 0; index < runLength; index += 1) {
    if (content[startIndex + index] !== "`") {
      return false;
    }
  }

  return content[startIndex + runLength] !== "`";
}

function isFenceStart(content: string, startIndex: number, runLength: number) {
  return runLength >= 3 && (startIndex === 0 || content[startIndex - 1] === "\n");
}

function findClosingFence(content: string, searchStart: number, runLength: number) {
  for (let cursor = searchStart; cursor < content.length; cursor += 1) {
    if (content[cursor] !== "`") {
      continue;
    }

    if (!isFenceStart(content, cursor, runLength)) {
      continue;
    }

    if (hasExactBacktickRun(content, cursor, runLength)) {
      return cursor;
    }
  }

  return -1;
}

function findClosingInlineCodeSpan(content: string, searchStart: number, runLength: number) {
  for (let cursor = searchStart; cursor < content.length; cursor += 1) {
    if (content[cursor] !== "`") {
      continue;
    }

    if (hasExactBacktickRun(content, cursor, runLength)) {
      return cursor;
    }
  }

  return -1;
}

export function splitByCodeSegments(content: string) {
  const segments: Array<{ isCode: boolean; text: string }> = [];
  let proseStart = 0;
  let cursor = 0;

  while (cursor < content.length) {
    if (content[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    const runLength = readBacktickRun(content, cursor);
    if (runLength === 0) {
      cursor += 1;
      continue;
    }

    if (isFenceStart(content, cursor, runLength)) {
      if (cursor > proseStart) {
        segments.push({ isCode: false, text: content.slice(proseStart, cursor) });
      }

      const closingFenceIndex = findClosingFence(content, cursor + runLength, runLength);
      const segmentEnd = closingFenceIndex === -1 ? content.length : closingFenceIndex + runLength;
      segments.push({ isCode: true, text: content.slice(cursor, segmentEnd) });
      cursor = segmentEnd;
      proseStart = cursor;
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

export function getMarkdownTargetFilename(target: string) {
  const decodedTarget = decodeMarkdownTarget(target.trim());
  const normalizedTarget = decodedTarget.replace(/\\/g, "/");
  const lastSlashIndex = normalizedTarget.lastIndexOf("/");
  return lastSlashIndex === -1 ? normalizedTarget : normalizedTarget.slice(lastSlashIndex + 1);
}
