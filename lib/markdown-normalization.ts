import type { RemendHandler } from "remend";

type BlockKind =
  | "heading"
  | "code-fence"
  | "blockquote"
  | "table"
  | "unordered-list"
  | "ordered-list"
  | "hr"
  | "other";

function classifyLine(line: string): BlockKind {
  const trimmed = line.trimStart();
  if (/^#{1,6}\s/.test(trimmed)) return "heading";
  if (/^`{3,}/.test(trimmed)) return "code-fence";
  if (/^>\s?/.test(trimmed)) return "blockquote";
  if (/^\|/.test(trimmed)) return "table";
  if (/^[-*+]\s/.test(trimmed)) return "unordered-list";
  if (/^\d{1,3}[.)]\s/.test(trimmed)) return "ordered-list";
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) return "hr";
  return "other";
}

function needsBlankLineBetween(
  prevKind: BlockKind,
  currentKind: BlockKind,
  currentIndent: number,
): boolean {
  if (
    currentIndent > 0 &&
    (currentKind === "unordered-list" || currentKind === "ordered-list")
  ) {
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

function fixCollapsedTableRows(text: string): string {
  let r = text;
  r = r.replace(/\|\|(?=\s*[`!*\w])/g, "|\n|");
  r = r.replace(/(\|) (\| \w)/g, "$1\n$2");
  r = r.replace(/(\|)(#{1,6}\s\S)/g, "$1\n$2");
  return r;
}

function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineText = text.slice(lineStart);
  const indent = lineText.match(/^[ \t]*/);
  return indent ? indent[0] : "";
}

function lineIsListItem(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineText = text.slice(lineStart);
  return /^\s*([-*+]|\d{1,3}[.)])\s/.test(lineText);
}

function subItemIndentAt(text: string, offset: number): string {
  const indent = lineIndentAt(text, offset);
  if (lineIsListItem(text, offset)) {
    return indent + "  ";
  }
  return indent;
}

function expandLineInline(line: string): string {
  let r = line;

  r = r.replace(/^(#{1,6})([^#\s\n])/, "$1 $2");

  r = r.replace(/^(-{3,})(?=[^\n])/, "\n$1\n");
  r = r.replace(/(?<=\S)(-{3,})$/, "\n$1\n");

  r = r.replace(/([^\s#_|>#`])(#{1,6}\s\S)/g, "$1\n$2");

  r = r.replace(/([^\s|])(\| [^ |-])/g, "$1\n$2");

  r = r.replace(
    /([^\s\d.)_<>(#`])(\d{1,3}[.)]\s)/g,
    (match, before: string, marker: string) => {
      if (/[0-9.]/.test(before)) return match;
      return `${before}\n${marker}`;
    },
  );

  r = r.replace(
    /([^\s*_|>#`])([-]\s(?:\[[ x]\]\s)?)/g,
    (match, before: string, _marker: string) => {
      if (before === "|" || before === ">" || before === "-") return match;
      return `${before}\n${_marker}`;
    },
  );

  r = r.replace(
    /(\*{1,3})([ \t]+)([*+]\s(?:\[[ x]\]\s)?)/g,
    (
      match: string,
      emphasis: string,
      spaces: string,
      marker: string,
      offset: number,
      fullString: string,
    ) => {
      if (spaces.includes("\n")) return match;
      const indent = subItemIndentAt(fullString, offset);
      return `${emphasis}\n${indent}${marker}`;
    },
  );

  r = r.replace(
    /(\S)([ \t]+)([*+]\s(?:\[[ x]\]\s)?)/g,
    (
      match: string,
      before: string,
      spaces: string,
      marker: string,
      offset: number,
      fullString: string,
    ) => {
      if (spaces.includes("\n")) return match;
      if (before === "*" || before === "+") return match;
      const afterIdx = offset + before.length + spaces.length + marker.length;
      const afterChar = fullString[afterIdx];
      if (/\d/.test(before) && afterChar && /\d/.test(afterChar)) return match;
      const indent = subItemIndentAt(fullString, offset);
      return `${before}\n${indent}${marker}`;
    },
  );

  r = r.replace(
    /(\S)([*+]\s(?:\[[ x]\]\s)?)/g,
    (
      match: string,
      before: string,
      marker: string,
      offset: number,
      fullString: string,
    ) => {
      if (before === "*" || before === "+") return match;
      const afterIdx = offset + before.length + marker.length;
      const afterChar = fullString[afterIdx];
      if (/\d/.test(before) && afterChar && /\d/.test(afterChar)) return match;
      const indent = subItemIndentAt(fullString, offset);
      return `${before}\n${indent}${marker}`;
    },
  );

  r = r.replace(
    /(\*{1,3})([ \t]*)(>(?:[ \t]|$))/gm,
    (
      _match: string,
      emphasis: string,
      spaces: string,
      marker: string,
      offset: number,
      fullString: string,
    ) => {
      if (spaces.includes("\n")) return _match;
      const indent = subItemIndentAt(fullString, offset);
      return `${emphasis}\n${indent}${marker}`;
    },
  );

  r = r.replace(
    /(\S)([ \t]+)(>(?:[ \t]*>)+[ \t]?)/gm,
    (
      _match: string,
      before: string,
      spaces: string,
      marker: string,
      offset: number,
      fullString: string,
    ) => {
      if (spaces.includes("\n")) return _match;
      if (before === ">") return _match;
      const afterIdx = offset + before.length + spaces.length + marker.length;
      const afterChar = fullString[afterIdx];
      if (/\d/.test(before) && afterChar && /\d/.test(afterChar))
        return _match;
      if (/[<>=!]=?/.test(before) && afterChar && /\d/.test(afterChar))
        return _match;
      const indent = subItemIndentAt(fullString, offset);
      return `${before}\n${indent}${marker}`;
    },
  );

  return r;
}

export function normalizeMarkdown(text: string): string {
  const preprocessed = fixCollapsedTableRows(text);
  const lines = preprocessed.split("\n");
  const output: string[] = [];
  let insideFence = false;
  let insideTable = false;
  let prevBlockKind: BlockKind | null = null;
  let rootListKind: BlockKind | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (/^`{3,}/.test(trimmed) && !insideFence) {
      insideFence = true;
      const prevLine = output.length > 0 ? output[output.length - 1] : "";
      if (output.length > 0 && prevLine.trim() !== "") {
        output.push("");
      }
      output.push(line);
      prevBlockKind = "code-fence";
      rootListKind = null;
      continue;
    }

    if (/^`{3,}/.test(trimmed) && insideFence) {
      insideFence = false;
      output.push(line);
      prevBlockKind = "code-fence";
      rootListKind = null;
      continue;
    }

    if (insideFence) {
      output.push(line);
      continue;
    }

    const expanded = expandLineInline(line);
    const subLines = expanded.split("\n");

    for (const subLine of subLines) {
      const subTrimmed = subLine.trimStart();

      if (/^\|/.test(subTrimmed)) {
        if (!insideTable) {
          insideTable = true;
          const prevLine =
            output.length > 0 ? output[output.length - 1] : "";
          if (
            output.length > 0 &&
            prevLine.trim() !== "" &&
            prevBlockKind !== "table"
          ) {
            output.push("");
          }
        }
        output.push(subLine);
        prevBlockKind = "table";
        rootListKind = null;
        continue;
      }

      if (insideTable && subTrimmed !== "" && !/^\|/.test(subTrimmed)) {
        insideTable = false;
      }

      const kind = classifyLine(subLine);
      const indent = subLine.length - subTrimmed.length;
      const prevLine =
        output.length > 0 ? output[output.length - 1] : "";
      const prevIsBlank = prevLine.trim() === "";

      if (
        indent === 0 &&
        (kind === "ordered-list" || kind === "unordered-list")
      ) {
        if (rootListKind === kind && !prevIsBlank) {
          output.push(subLine);
          prevBlockKind = kind;
          continue;
        }
        rootListKind = kind;
      } else if (
        indent > 0 &&
        (kind === "ordered-list" || kind === "unordered-list")
      ) {
        output.push(subLine);
        prevBlockKind = kind;
        continue;
      } else if (
        kind !== "ordered-list" &&
        kind !== "unordered-list"
      ) {
        rootListKind = null;
      }

      if (
        output.length > 0 &&
        !prevIsBlank &&
        prevBlockKind !== null &&
        needsBlankLineBetween(prevBlockKind, kind, indent)
      ) {
        output.push("");
      }

      output.push(subLine);
      prevBlockKind = kind;
    }
  }

  return output.join("\n");
}

export const MARKDOWN_REMEND_HANDLERS: RemendHandler[] = [];
