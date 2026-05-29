import type { Plugin } from "unified";
import type { Root, List, ListItem, Text } from "mdast";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import { endsWithSentenceTerminator } from "../ast-helpers";

const MAX_ORPHAN_WORDS = 3;

const remarkMergeOrphanedListFragments: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "list", (list: List) => {
      const items = list.children as ListItem[];
      if (items.length < 2) return;
      const result: ListItem[] = [];
      for (const item of items) {
        const itemText = toString(item).trim();
        const wordCount = itemText.split(/\s+/).filter(Boolean).length;
        const isFragment =
          wordCount <= MAX_ORPHAN_WORDS && endsWithSentenceTerminator(itemText);
        const prev = result[result.length - 1];
        if (prev && isFragment) {
          const prevText = toString(prev).trim();
          if (!endsWithSentenceTerminator(prevText)) {
            const lastPara = prev.children[prev.children.length - 1];
            if (lastPara && "children" in lastPara && Array.isArray(lastPara.children)) {
              const lastText = lastPara.children[lastPara.children.length - 1];
              if (lastText && lastText.type === "text") {
                (lastText as Text).value = (lastText as Text).value + " " + itemText;
                continue;
              }
            }
          }
        }
        result.push(item);
      }
      list.children = result;
    });
  };
};

export default remarkMergeOrphanedListFragments;
