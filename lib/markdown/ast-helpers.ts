export function countMarkerRuns(text: string, marker: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text.startsWith(marker, i)) {
      count++;
      i += marker.length;
      while (text.startsWith(marker, i)) i += marker.length;
    } else {
      i++;
    }
  }
  return count;
}

export function pipeDensity(text: string): number {
  if (!text) return 0;
  const pipes = (text.match(/\|/g) || []).length;
  return pipes / text.length;
}

const TERMINATORS = new Set([".", "!", "?"]);
export function endsWithSentenceTerminator(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  return TERMINATORS.has(trimmed[trimmed.length - 1]);
}

import type { PhrasingContent } from "mdast";

/**
 * Reconstruct the source-like markdown string of a paragraph's inline content
 * so plugins can pattern-match across nodes the parser split (e.g. inline code
 * inside a row of pipes). The result re-applies the syntax wrappers (` for
 * inlineCode, ** for strong, etc.) so the consumer can re-parse or split it.
 */
export function flattenInline(children: readonly PhrasingContent[]): string {
  let out = "";
  for (const c of children) {
    if (c.type === "text") out += c.value;
    else if (c.type === "inlineCode") out += "`" + c.value + "`";
    else if (c.type === "strong") out += "**" + flattenInline(c.children) + "**";
    else if (c.type === "emphasis") out += "*" + flattenInline(c.children) + "*";
    else if (c.type === "delete") out += "~~" + flattenInline(c.children) + "~~";
    else if ("value" in c && typeof c.value === "string") out += c.value;
    else if ("children" in c && Array.isArray(c.children))
      out += flattenInline(c.children as PhrasingContent[]);
  }
  return out;
}
