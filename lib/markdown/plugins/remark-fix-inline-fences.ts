// lib/markdown/plugins/remark-fix-inline-fences.ts
import type { Plugin } from "unified";
import type { Root, Code, Paragraph, Text } from "mdast";
import { visit, SKIP } from "unist-util-visit";

const FENCE_GLUED_AFTER = /^([\s\S]*?)```([A-Za-z0-9_+-]*)?\s*\n([\s\S]*?)\n```([^\n][\s\S]*)$/;

const remarkFixInlineFences: Plugin<[], Root> = () => {
  return (tree) => {
    // (c)+(d): paragraph whose text contains a full fence + trailing prose
    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;
      const firstChild = node.children[0];
      if (!firstChild || firstChild.type !== "text") return;
      const raw = firstChild.value;

      const match = raw.match(FENCE_GLUED_AFTER);
      if (!match) return;
      const [, before, lang, body, tail] = match;
      const replacements: (Paragraph | Code)[] = [];
      if (before.trim()) {
        replacements.push({
          type: "paragraph",
          children: [{ type: "text", value: before.trim() } as Text],
        });
      }
      replacements.push({
        type: "code",
        lang: lang || null,
        value: body,
      });
      if (tail.trim()) {
        replacements.push({
          type: "paragraph",
          children: [{ type: "text", value: tail.trim() } as Text],
        });
      }
      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });

    // (c) on existing code nodes whose value contains an internal closing fence
    visit(tree, "code", (node: Code, index, parent) => {
      if (index === undefined || !parent) return;
      const m = node.value.match(/^([\s\S]*?)\n```([^\n][\s\S]*)$/);
      if (!m) return;
      const [, body, tail] = m;
      node.value = body;
      const trailing: Paragraph = {
        type: "paragraph",
        children: [{ type: "text", value: tail.trim() } as Text],
      };
      parent.children.splice(index + 1, 0, trailing);
    });
  };
};

export default remarkFixInlineFences;
