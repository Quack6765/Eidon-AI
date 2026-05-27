import type { Plugin } from "unified";
import type { Root, ListItem, Paragraph } from "mdast";
import { visit } from "unist-util-visit";
import { flattenInline, parseInline } from "../ast-helpers";

const INLINE_MARKER_MULTI = /\s\*\s(?=\S)/g;
const INLINE_MARKER_SINGLE = /(?:\s|(?<=\w|\)|\]))\*\s(?=[A-Z`])/g;
const MIN_MARKERS_MULTI = 2;

function hasBalancedStrong(s: string): boolean {
  return ((s.match(/\*\*/g) || []).length) % 2 === 0;
}

const remarkSplitInlineListMarkers: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "listItem", (item: ListItem, index, parent) => {
      if (index === undefined || !parent || parent.type !== "list") return;
      const firstChild = item.children[0];
      if (!firstChild || firstChild.type !== "paragraph") return;

      const combined = flattenInline(firstChild.children);
      const multiMatches = combined.match(INLINE_MARKER_MULTI);
      const useMulti = !!(multiMatches && multiMatches.length >= MIN_MARKERS_MULTI);
      const pattern = useMulti ? INLINE_MARKER_MULTI : INLINE_MARKER_SINGLE;
      const minSegments = useMulti ? MIN_MARKERS_MULTI + 1 : 2;

      const allMatches = combined.match(pattern);
      if (!allMatches || allMatches.length === 0) return;

      const segments = combined
        .split(pattern)
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments.length < minSegments) return;
      if (segments.some((s) => !hasBalancedStrong(s))) return;

      const newItems: ListItem[] = segments.map((seg) => ({
        type: "listItem",
        spread: false,
        children: [
          {
            type: "paragraph",
            children: parseInline(seg),
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
