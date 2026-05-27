import type { Plugin } from "unified";
import type { Root, Paragraph, Heading, RootContent } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { flattenInline, parseInline, parseFragment } from "../ast-helpers";

const HEADING_GLUED_IN_HEADING = /([^\s#])(#{1,6})(?=\s|[^#])/;

const HEADING_GLUED_PRE = /([^\s#])(#{1,6})(?=\s|[^#])/;
const HEADING_MID_LINE = /(\S)\s+(#{1,6})\s(?=\S)/;
const HEADING_NO_SPACE = /^(#{1,6})([^#\s])/;
const SENTENCE_END = /[.!?]\s+[A-Z]/;
const SENTENCE_STARTER = /\s+(?=[A-Z]\w*\s+[a-z])/;
const MAX_HEADING_LEN = 80;

const remarkFixBlockSpacing: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "heading", (node: Heading, index, parent) => {
      if (index === undefined || !parent) return;
      const raw = flattenInline(node.children);
      if (!raw) return;

      const inner = raw.match(HEADING_GLUED_IN_HEADING);
      if (!inner || inner.index === undefined) return;
      const beforeText = raw.slice(0, inner.index + inner[1].length).trim();
      const after = raw.slice(inner.index + inner[1].length);
      const hashRun = after.match(/^(#{1,6})\s*/);
      if (!hashRun) return;
      const tail = after.slice(hashRun[0].length);
      if (!tail.trim()) return;

      const replacements: RootContent[] = [];
      if (beforeText) {
        replacements.push({
          type: "heading",
          depth: node.depth,
          children: parseInline(beforeText),
        });
      }
      const innerDepth = Math.min(hashRun[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      replacements.push(...parseFragment(`${"#".repeat(innerDepth)} ${tail}`));
      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });

    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;
      const raw = flattenInline(node.children);
      if (!raw) return;

      const noSpaceMatch = raw.match(HEADING_NO_SPACE);
      if (noSpaceMatch && node.children.length === 1) {
        const level = Math.min(noSpaceMatch[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
        const headingText = raw.slice(noSpaceMatch[1].length).trim();
        const heading: Heading = {
          type: "heading",
          depth: level,
          children: parseInline(headingText),
        };
        parent.children.splice(index, 1, heading);
        return [SKIP, index + 1];
      }

      const midMatch = raw.match(HEADING_MID_LINE);
      if (midMatch && midMatch.index !== undefined) {
        const before = raw.slice(0, midMatch.index + 1).trimEnd();
        const after = raw.slice(midMatch.index + midMatch[0].length).trim();
        const hashRun = midMatch[2];

        const sentenceEnd = after.search(SENTENCE_END);
        const cut = sentenceEnd >= 0 ? sentenceEnd + 1 : after.length;
        const headingText = after.slice(0, cut).trim();
        const trailingText = after.slice(cut).trim();
        const level = Math.min(hashRun.length, 6) as 1 | 2 | 3 | 4 | 5 | 6;

        const replacements: (Paragraph | Heading)[] = [];
        if (before.trim()) {
          replacements.push({
            type: "paragraph",
            children: parseInline(before),
          });
        }
        replacements.push({
          type: "heading",
          depth: level,
          children: parseInline(headingText),
        });
        if (trailingText) {
          replacements.push({
            type: "paragraph",
            children: parseInline(trailingText),
          });
        }
        parent.children.splice(index, 1, ...replacements);
        return [SKIP, index + replacements.length];
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
        const sentenceStart = headingBody.search(SENTENCE_STARTER);
        const cut =
          sentenceEnd >= 0
            ? sentenceEnd + 1
            : sentenceStart >= 0
            ? sentenceStart
            : Math.min(headingBody.length, MAX_HEADING_LEN);

        const headingText = headingBody.slice(0, cut).trim();
        const trailingText = headingBody.slice(cut).trim();

        const level = Math.min(hashRun[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
        const replacements: (Paragraph | Heading)[] = [];

        if (before.trim()) {
          replacements.push({
            type: "paragraph",
            children: parseInline(before),
          });
        }
        replacements.push({
          type: "heading",
          depth: level,
          children: parseInline(headingText),
        });
        if (trailingText) {
          replacements.push({
            type: "paragraph",
            children: parseInline(trailingText),
          });
        }

        parent.children.splice(index, 1, ...replacements);
        return [SKIP, index + replacements.length];
      }
    });
  };
};

export default remarkFixBlockSpacing;
