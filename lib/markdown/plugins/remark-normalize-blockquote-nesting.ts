import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph, Text, BlockContent } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { flattenInline, parseInline } from "../ast-helpers";

const LEADING_GT = /^(>+)\s*(.*)$/;
const INLINE_BQ_MARKER = /([.!?*])\s*((?:>\s*){1,})(?=[A-Z*`])/g;

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

    visit(tree, "blockquote", (node: Blockquote) => {
      const newChildren: BlockContent[] = [];
      for (const child of node.children) {
        if (child.type !== "paragraph") {
          newChildren.push(child as BlockContent);
          continue;
        }
        const raw = flattenInline(child.children);
        const matches: Array<{ index: number; end: number; depth: number }> = [];
        for (const m of raw.matchAll(INLINE_BQ_MARKER)) {
          if (m.index === undefined) continue;
          const gtCount = (m[2].match(/>/g) || []).length;
          matches.push({
            index: m.index + m[1].length,
            end: m.index + m[0].length,
            depth: gtCount,
          });
        }
        if (matches.length === 0) {
          newChildren.push(child as BlockContent);
          continue;
        }

        const segments: { text: string; depth: number }[] = [];
        let last = 0;
        let prevDepth = 1;
        for (const mt of matches) {
          segments.push({ text: raw.slice(last, mt.index).trim(), depth: prevDepth });
          last = mt.end;
          prevDepth = mt.depth;
        }
        segments.push({ text: raw.slice(last).trim(), depth: prevDepth });

        for (const seg of segments) {
          if (!seg.text) continue;
          const para: Paragraph = {
            type: "paragraph",
            children: parseInline(seg.text),
          };
          if (seg.depth <= 1) {
            newChildren.push(para);
          } else {
            let wrapped: BlockContent = para;
            for (let d = 1; d < seg.depth; d++) {
              wrapped = { type: "blockquote", children: [wrapped] } as Blockquote;
            }
            newChildren.push(wrapped);
          }
        }
      }
      node.children = newChildren as Blockquote["children"];
    });
  };
};

export default remarkNormalizeBlockquoteNesting;
