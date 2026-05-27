import type { Plugin } from "unified";
import type { Root, List, Paragraph } from "mdast";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";

const SHORT_PARA_MAX = 80;

const remarkRenumberOrderedLists: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "list", (node: List) => {
      if (node.ordered) {
        node.start = 1;
      }
    });

    visit(tree, (node) => {
      if (!("children" in node)) return;
      const children = (node as { children: unknown[] }).children;
      if (!Array.isArray(children)) return;
      for (let i = 0; i < children.length - 2; i++) {
        const a = children[i] as List;
        const mid = children[i + 1] as Paragraph;
        const b = children[i + 2] as List;
        if (
          a?.type === "list" &&
          a.ordered &&
          b?.type === "list" &&
          b.ordered &&
          mid?.type === "paragraph" &&
          toString(mid).trim().length <= SHORT_PARA_MAX
        ) {
          a.children.push(...b.children);
          children.splice(i + 1, 2);
          i--;
        }
      }
    });
  };
};

export default remarkRenumberOrderedLists;
