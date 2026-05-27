import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph, Text } from "mdast";
import { visit, SKIP } from "unist-util-visit";

const LEADING_GT = /^(>+)\s*(.*)$/;

const remarkNormalizeBlockquoteNesting: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const newChildren: Blockquote["children"] = [];
      for (const child of node.children) {
        if (child.type !== "paragraph") {
          newChildren.push(child);
          continue;
        }
        const first = child.children[0];
        if (first?.type !== "text") {
          newChildren.push(child);
          continue;
        }
        const m = (first as Text).value.match(LEADING_GT);
        if (!m) {
          newChildren.push(child);
          continue;
        }
        const depth = m[1].length;
        const stripped = m[2];
        let inner: Blockquote["children"][number] = {
          type: "paragraph",
          children: [
            { type: "text", value: stripped } as Text,
            ...child.children.slice(1),
          ],
        } as Paragraph;
        for (let d = 0; d < depth; d++) {
          inner = { type: "blockquote", children: [inner] } as Blockquote;
        }
        if (inner.type === "blockquote") {
          newChildren.push(...inner.children);
        } else {
          newChildren.push(inner);
        }
      }
      node.children = newChildren;
      return SKIP;
    });
  };
};

export default remarkNormalizeBlockquoteNesting;
