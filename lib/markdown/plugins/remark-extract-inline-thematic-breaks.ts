// lib/markdown/plugins/remark-extract-inline-thematic-breaks.ts
import type { Plugin } from "unified";
import type { Root, Paragraph, ThematicBreak, Text } from "mdast";
import { visit, SKIP } from "unist-util-visit";

const INLINE_HR = /(\w)([-*_])\2{2,}(\w)/;

const remarkExtractInlineThematicBreaks: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;
      const firstChild = node.children[0];
      if (!firstChild || firstChild.type !== "text") return;
      const raw = firstChild.value;

      const match = raw.match(INLINE_HR);
      if (!match || match.index === undefined) return;

      const before = raw.slice(0, match.index + 1);
      const after = raw.slice(match.index + match[0].length - 1);

      const replacements: (Paragraph | ThematicBreak)[] = [];
      if (before.trim()) {
        replacements.push({
          type: "paragraph",
          children: [{ type: "text", value: before } as Text],
        });
      }
      replacements.push({ type: "thematicBreak" });
      if (after.trim()) {
        replacements.push({
          type: "paragraph",
          children: [{ type: "text", value: after } as Text],
        });
      }

      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });
  };
};

export default remarkExtractInlineThematicBreaks;
