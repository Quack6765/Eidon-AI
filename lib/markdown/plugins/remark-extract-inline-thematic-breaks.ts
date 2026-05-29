import type { Plugin } from "unified";
import type { Root, Paragraph, Heading, ThematicBreak, Text, RootContent } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { flattenInline, parseInline, parseFragment } from "../ast-helpers";

const INLINE_HR = /([^\s|:])([-*_])\2{2,}(?=[^|\s:])(?!\2)/;
const TRAILING_HR = /([^\s|])([-*_])\2{2,}\s*$/;
const LEADING_HR = /^\s*([-*_])\1{2,}(?=[#*+-])(?!\1)/;
const PURE_HR = /^\s*([-*_])\1{2,}\s*$/;

const remarkExtractInlineThematicBreaks: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;
      const raw = flattenInline(node.children);
      if (!raw) return;

      if (PURE_HR.test(raw)) {
        parent.children.splice(index, 1, { type: "thematicBreak" });
        return [SKIP, index + 1];
      }

      const leadMatch = raw.match(LEADING_HR);
      if (leadMatch && leadMatch.index !== undefined) {
        const after = raw.slice(leadMatch[0].length);
        const replacements: RootContent[] = [{ type: "thematicBreak" }];
        if (after.trim()) {
          replacements.push(...parseFragment(after));
        }
        parent.children.splice(index, 1, ...replacements);
        return [SKIP, index + replacements.length];
      }

      const midMatch = raw.match(INLINE_HR);
      if (midMatch && midMatch.index !== undefined) {
        const before = raw.slice(0, midMatch.index + 1);
        const after = raw.slice(midMatch.index + midMatch[0].length);
        const replacements: (Paragraph | ThematicBreak)[] = [];
        if (before.trim()) {
          replacements.push({
            type: "paragraph",
            children: parseInline(before),
          });
        }
        replacements.push({ type: "thematicBreak" });
        if (after.trim()) {
          replacements.push({
            type: "paragraph",
            children: parseInline(after),
          });
        }
        parent.children.splice(index, 1, ...replacements);
        return [SKIP, index + replacements.length];
      }

      const tailMatch = raw.match(TRAILING_HR);
      if (tailMatch && tailMatch.index !== undefined) {
        const before = raw.slice(0, tailMatch.index + 1);
        const replacements: (Paragraph | ThematicBreak)[] = [];
        if (before.trim()) {
          replacements.push({
            type: "paragraph",
            children: parseInline(before),
          });
        }
        replacements.push({ type: "thematicBreak" });
        parent.children.splice(index, 1, ...replacements);
        return [SKIP, index + replacements.length];
      }
    });

    visit(tree, "heading", (node: Heading, index, parent) => {
      if (index === undefined || !parent) return;
      const lastChild = node.children[node.children.length - 1];
      if (!lastChild || lastChild.type !== "text") return;
      const raw = lastChild.value;

      const tailMatch = raw.match(TRAILING_HR);
      if (!tailMatch || tailMatch.index === undefined) return;

      const trimmed = raw.slice(0, tailMatch.index + 1);
      const newChildren = node.children.slice(0, -1);
      if (trimmed.trim()) {
        newChildren.push({ type: "text", value: trimmed } as Text);
      }
      const newHeading: Heading = {
        type: "heading",
        depth: node.depth,
        children: newChildren,
      };
      const replacements: RootContent[] = [newHeading, { type: "thematicBreak" }];
      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });
  };
};

export default remarkExtractInlineThematicBreaks;
