// lib/markdown/plugins/remark-close-unbalanced-emphasis.ts
import type { Plugin } from "unified";
import type { Root, Text, Strong, PhrasingContent, Parent } from "mdast";
import { visit } from "unist-util-visit";
import { countMarkerRuns } from "../ast-helpers";

function expandTextToStrong(node: Text): PhrasingContent[] {
  const raw = node.value;
  const parts: PhrasingContent[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(raw)) !== null) {
    if (m.index > last) {
      parts.push({ type: "text", value: raw.slice(last, m.index) } as Text);
    }
    parts.push({
      type: "strong",
      children: [{ type: "text", value: m[1] } as Text],
    } as Strong);
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    parts.push({ type: "text", value: raw.slice(last) } as Text);
  }
  return parts.length > 0 ? parts : [node];
}

const remarkCloseUnbalancedEmphasis: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (index === undefined || !parent) return;
      const raw = node.value;
      const runs = countMarkerRuns(raw, "**");
      if (runs === 0) return;
      let value = raw;
      if (runs % 2 === 1) {
        // Determine whether to prepend or append ** based on adjacency.
        // Opener fragment: char before ** is space/start → append **
        // Closer fragment: char after ** is space/end → prepend **
        const firstIdx = raw.indexOf("**");
        const charBefore = firstIdx > 0 ? raw[firstIdx - 1] : " ";
        const charAfter = firstIdx + 2 < raw.length ? raw[firstIdx + 2] : " ";
        const isOpener = /\s/.test(charBefore) || firstIdx === 0;
        const isCloser = /\s/.test(charAfter) || firstIdx + 2 >= raw.length;
        if (isCloser && !isOpener) {
          value = "**" + raw;
        } else {
          value = raw + "**";
        }
      }
      const expanded = expandTextToStrong({ ...node, value });
      if (expanded.length === 1 && expanded[0].type === "text") return;
      (parent as Parent).children.splice(index, 1, ...expanded);
      return index + expanded.length;
    });
  };
};

export default remarkCloseUnbalancedEmphasis;
