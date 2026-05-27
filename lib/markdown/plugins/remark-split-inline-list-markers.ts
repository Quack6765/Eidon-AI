import type { Plugin } from "unified";
import type { Root, ListItem, Paragraph, Text } from "mdast";
import { visit } from "unist-util-visit";
import { flattenInline } from "../ast-helpers";

const INLINE_MARKER = /\s\*\s(?=\S)/g;
const MIN_MARKERS = 2;

const remarkSplitInlineListMarkers: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "listItem", (item: ListItem, index, parent) => {
      if (index === undefined || !parent || parent.type !== "list") return;
      const firstChild = item.children[0];
      if (!firstChild || firstChild.type !== "paragraph") return;

      const combined = flattenInline(firstChild.children);
      const markers = combined.match(INLINE_MARKER);
      if (!markers || markers.length < MIN_MARKERS) return;

      const segments = combined
        .split(INLINE_MARKER)
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments.length < MIN_MARKERS + 1) return;

      const newItems: ListItem[] = segments.map((seg) => ({
        type: "listItem",
        spread: false,
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: seg } as Text],
          } as Paragraph,
        ],
      }));

      if (item.children.length > 1) {
        newItems[newItems.length - 1].children.push(...item.children.slice(1));
      }

      parent.children.splice(index, 1, ...newItems);
    });
  };
};

export default remarkSplitInlineListMarkers;
