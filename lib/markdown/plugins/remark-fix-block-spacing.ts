import type { Plugin } from "unified";
import type { Root, Paragraph, Heading, Text } from "mdast";
import { visit, SKIP } from "unist-util-visit";

const HEADING_GLUED_PRE = /([^\s#])(#{1,6})(?=\s|[^#])/;
const HEADING_NO_SPACE = /^(#{1,6})([^#\s])/;
const SENTENCE_END = /[.!?]\s+[A-Z]/;
const CAPITAL_WORD_BOUNDARY = /\s+(?=[A-Z])/;
const MAX_HEADING_LEN = 80;

const remarkFixBlockSpacing: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;
      const firstChild = node.children[0];
      if (!firstChild || firstChild.type !== "text") return;
      const raw = firstChild.value;

      const noSpaceMatch = raw.match(HEADING_NO_SPACE);
      if (noSpaceMatch && node.children.length === 1) {
        const level = Math.min(noSpaceMatch[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
        const headingText = raw.slice(noSpaceMatch[1].length).trim();
        const heading: Heading = {
          type: "heading",
          depth: level,
          children: [{ type: "text", value: headingText } as Text],
        };
        parent.children.splice(index, 1, heading);
        return [SKIP, index + 1];
      }

      const glueMatch = raw.match(HEADING_GLUED_PRE);
      if (glueMatch && glueMatch.index !== undefined) {
        const before = raw.slice(0, glueMatch.index + glueMatch[1].length);
        const after = raw.slice(glueMatch.index + glueMatch[1].length);
        const hashRun = after.match(/^(#{1,6})\s*/);
        if (!hashRun) return;
        const headingStart = hashRun[0].length;
        const headingBody = after.slice(headingStart);

        const sentenceEnd = headingBody.search(SENTENCE_END);
        const capitalBoundary = headingBody.search(CAPITAL_WORD_BOUNDARY);
        const cut =
          sentenceEnd >= 0
            ? sentenceEnd + 1
            : capitalBoundary >= 0
            ? capitalBoundary
            : Math.min(headingBody.length, MAX_HEADING_LEN);

        const headingText = headingBody.slice(0, cut).trim();
        const trailingText = headingBody.slice(cut).trim();

        const level = Math.min(hashRun[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
        const replacements: (Paragraph | Heading)[] = [];

        if (before.trim()) {
          replacements.push({
            type: "paragraph",
            children: [{ type: "text", value: before } as Text],
          });
        }
        replacements.push({
          type: "heading",
          depth: level,
          children: [{ type: "text", value: headingText } as Text],
        });
        if (trailingText) {
          replacements.push({
            type: "paragraph",
            children: [{ type: "text", value: trailingText } as Text],
          });
        }

        if (node.children.length > 1) {
          const tail = node.children.slice(1);
          const last = replacements[replacements.length - 1];
          if (last.type === "paragraph") {
            last.children.push(...tail);
          }
        }

        parent.children.splice(index, 1, ...replacements);
        return [SKIP, index + replacements.length];
      }
    });
  };
};

export default remarkFixBlockSpacing;
