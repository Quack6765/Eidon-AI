import type { Plugin } from "unified";
import type { Root, List, ListItem } from "mdast";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";

const MAX_TIGHT_ITEM_LEN = 200;

const remarkTightenLists: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "list", (list: List) => {
      const items = list.children as ListItem[];
      const allShortSingleParagraph = items.every((item) => {
        if (item.children.length !== 1) return false;
        if (item.children[0].type !== "paragraph") return false;
        return toString(item).length <= MAX_TIGHT_ITEM_LEN;
      });
      if (allShortSingleParagraph) {
        list.spread = false;
        for (const item of items) item.spread = false;
      }
    });
  };
};

export default remarkTightenLists;
