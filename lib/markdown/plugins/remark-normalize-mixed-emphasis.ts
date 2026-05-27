// lib/markdown/plugins/remark-normalize-mixed-emphasis.ts
import type { Plugin } from "unified";
import type { Root, Text, Strong, Emphasis, Parent, PhrasingContent } from "mdast";
import { visit } from "unist-util-visit";

const LITERAL_MARKER_LEAK = /(^|[^\w*_~])(\*\*|__|~~)(?=[^\w*_~]|$)/g;

const remarkNormalizeMixedEmphasis: Plugin<[], Root> = () => {
  return (tree) => {
    // Strip literal ** __ ~~ left in text nodes by mixed-marker confusion.
    visit(tree, "text", (node: Text, _index, parent) => {
      if (!parent) return;
      const parentType = (parent as { type: string }).type;
      if (
        parentType === "code" ||
        parentType === "inlineCode" ||
        parentType === "html"
      ) {
        return;
      }
      const original = node.value;
      const replaced = original.replace(LITERAL_MARKER_LEAK, "$1");
      if (replaced !== original) {
        node.value = replaced;
      }
    });

    // Handle mixed-marker strong-wrapping-emphasis: **_text_** parses to
    // strong > emphasis > text. Unwrap the strong, keeping only the emphasis
    // children, to avoid *** output.
    visit(tree, "strong", (node: Strong, index, parent) => {
      if (index === undefined || !parent) return;
      if (
        node.children.length === 1 &&
        node.children[0].type === "emphasis"
      ) {
        const inner = node.children[0] as Emphasis;
        (parent as Parent).children.splice(index, 1, ...(inner.children as PhrasingContent[]));
        return index + inner.children.length;
      }
    });
  };
};

export default remarkNormalizeMixedEmphasis;
