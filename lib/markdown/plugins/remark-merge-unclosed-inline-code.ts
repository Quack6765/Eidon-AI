// lib/markdown/plugins/remark-merge-unclosed-inline-code.ts
import type { Plugin } from "unified";
import type { Root, ListItem, Text, InlineCode } from "mdast";
import { visit, SKIP } from "unist-util-visit";

const remarkMergeUnclosedInlineCode: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "listItem", (item: ListItem) => {
      // Heuristic: item has [paragraph (ending in `text), list (with one item starting with text`)]
      if (item.children.length < 2) return;
      const para = item.children[0];
      const sublist = item.children[1];
      if (para.type !== "paragraph") return;
      if (sublist.type !== "list") return;
      if (sublist.children.length !== 1) return;
      const subItem = sublist.children[0];
      if (subItem.type !== "listItem") return;
      if (subItem.children.length !== 1) return;
      const subPara = subItem.children[0];
      if (subPara.type !== "paragraph") return;

      const lastChild = para.children[para.children.length - 1];
      const firstSubChild = subPara.children[0];
      if (lastChild?.type !== "text" || firstSubChild?.type !== "text") return;

      const openMatch = lastChild.value.match(/(.*)`([^`\n]*)$/);
      if (!openMatch) return;
      const closeMatch = firstSubChild.value.match(/^([^`\n]*)`(.*)$/);
      if (!closeMatch) return;

      const beforeBacktick = openMatch[1];
      const openTextOnly = openMatch[2];
      const closeTextOnly = closeMatch[1];
      const tailText = closeMatch[2];

      const inlineCode: InlineCode = {
        type: "inlineCode",
        value: `${openTextOnly}/${closeTextOnly}`,
      };

      const newChildren = para.children.slice(0, -1);
      if (beforeBacktick) {
        newChildren.push({ type: "text", value: beforeBacktick } as Text);
      }
      newChildren.push(inlineCode);
      if (tailText) {
        newChildren.push({ type: "text", value: tailText } as Text);
      }

      para.children = newChildren;
      // Drop the sub-list that was an artifact of the parser misreading.
      item.children = item.children.slice(0, 1);
    });
  };
};

export default remarkMergeUnclosedInlineCode;
