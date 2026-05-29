import type { Plugin } from "unified";
import type { Root, Paragraph, Heading, Table, TableRow, TableCell } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { flattenInline, parseInline } from "../ast-helpers";

const SEPARATOR_RUN = /\|\s*(?::?-{3,}:?\s*\|\s*){1,}/;
const HEADING_WITH_HEADER_ROW = /^([^|]+?)\s*(\|.+\|)\s*$/;

function splitCells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

const remarkSplitInlineTable: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;
      let raw = flattenInline(node.children);

      if (!raw.includes("|")) return;
      let prevHeadingIdx = -1;
      let headingTitle = "";
      let headingDepth: 1 | 2 | 3 | 4 | 5 | 6 = 3;

      if (raw.trimStart().startsWith("|") && index > 0) {
        const prev = parent.children[index - 1];
        if (prev && prev.type === "heading") {
          const prevText = flattenInline(prev.children);
          const headingMatch = prevText.match(HEADING_WITH_HEADER_ROW);
          if (headingMatch) {
            const title = headingMatch[1].trim();
            const headerRow = headingMatch[2].trim();
            const headerCellCount = headerRow.replace(/^\|/, "").replace(/\|$/, "").split("|").length;
            if (title && headerCellCount >= 2) {
              raw = headerRow + " " + raw.trim();
              prevHeadingIdx = index - 1;
              headingTitle = title;
              headingDepth = prev.depth;
            }
          }
        }
      }

      const sepMatch = raw.match(SEPARATOR_RUN);
      if (!sepMatch || sepMatch.index === undefined) return;

      const beforeSep = raw.slice(0, sepMatch.index).trim();
      let prosePrefix = "";
      let headerSrc = beforeSep;
      if (!beforeSep.startsWith("|")) {
        const firstPipe = beforeSep.indexOf("|");
        if (firstPipe < 0) return;
        prosePrefix = beforeSep.slice(0, firstPipe).trim();
        headerSrc = beforeSep.slice(firstPipe).trim();
      }
      const restSrcRaw = raw.slice(sepMatch.index + sepMatch[0].length).trim();
      const restSrc = restSrcRaw.replace(/\s*\|?\s*[-=]{3,}\s*$/, "").trim();
      if (!headerSrc.startsWith("|") || !headerSrc.endsWith("|")) return;

      const headerCells = splitCells(headerSrc);
      const colCount = headerCells.length;
      if (colCount < 2) return;

      const dataRows: string[][] = [];
      // Split restSrc into rows by splitting on pipe-space-pipe boundaries.
      // Normalize: ensure restSrc starts/ends with |.
      const restNorm = (restSrc.startsWith("|") ? restSrc : "|" + restSrc)
        .replace(/\|\s*$/, "|");
      // Split on the pattern "| |" (row boundaries) to get individual row strings.
      const rowStrings = restNorm.split(/\|\s*\|/).filter(Boolean);

      for (const rowStr of rowStrings) {
        const cells = rowStr.split("|").map((c) => c.trim()).filter((c, i, arr) => {
          if (i === 0 && c === "") return false;
          if (i === arr.length - 1 && c === "") return false;
          return true;
        });
        if (cells.length === colCount) {
          dataRows.push(cells);
        }
      }

      const table: Table = {
        type: "table",
        align: new Array(colCount).fill("left"),
        children: [
          {
            type: "tableRow",
            children: headerCells.map(
              (c): TableCell => ({
                type: "tableCell",
                children: parseInline(c),
              })
            ),
          } as TableRow,
          ...dataRows.map(
            (cells): TableRow => ({
              type: "tableRow",
              children: cells.map(
                (c): TableCell => ({
                  type: "tableCell",
                  children: parseInline(c),
                })
              ),
            })
          ),
        ],
      };

      const replacements: (Paragraph | Heading | Table)[] = [];
      if (prevHeadingIdx >= 0) {
        replacements.push({
          type: "heading",
          depth: headingDepth,
          children: parseInline(headingTitle),
        });
      }
      if (prosePrefix) {
        replacements.push({
          type: "paragraph",
          children: parseInline(prosePrefix),
        });
      }
      replacements.push(table);
      const spliceStart = prevHeadingIdx >= 0 ? prevHeadingIdx : index;
      const spliceCount = prevHeadingIdx >= 0 ? 2 : 1;
      parent.children.splice(spliceStart, spliceCount, ...replacements);
      return [SKIP, spliceStart + replacements.length];
    });
  };
};

export default remarkSplitInlineTable;
