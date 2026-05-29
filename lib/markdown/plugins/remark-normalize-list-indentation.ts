import type { Plugin } from "unified";
import type { Root, List, ListItem } from "mdast";
import { visit } from "unist-util-visit";

const remarkNormalizeListIndentation: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "list", (list: List) => {
      const items = list.children as ListItem[];
      if (items.length < 2) return;
      const result: ListItem[] = [];
      for (const item of items) {
        const col = item.position?.start.column ?? 1;
        const prev = result[result.length - 1];
        const prevCol = prev?.position?.start.column ?? 1;
        if (prev && col > prevCol) {
          const childList: List = {
            type: "list",
            ordered: list.ordered,
            spread: false,
            children: [item],
          };
          prev.children.push(childList);
        } else {
          result.push(item);
        }
      }
      list.children = result;
    });
  };
};

export default remarkNormalizeListIndentation;
