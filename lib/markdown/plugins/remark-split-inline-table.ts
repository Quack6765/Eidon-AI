import type { Plugin } from "unified";
import type { Root, Paragraph, Table, TableRow, TableCell } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { flattenInline, parseInline } from "../ast-helpers";

const SEPARATOR_RUN = /\|\s*(?::?-{3,}:?\s*\|\s*){1,}/;

function splitCells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

const remarkSplitInlineTable: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;
      const raw = flattenInline(node.children);

      if (!raw.includes("|")) return;
      const sepMatch = raw.match(SEPARATOR_RUN);
      if (!sepMatch || sepMatch.index === undefined) return;

      const headerSrc = raw.slice(0, sepMatch.index).trim();
      const restSrc = raw.slice(sepMatch.index + sepMatch[0].length).trim();
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
          // Remove leading/trailing empty strings from split
          if (i === 0 && c === "") return false;
          if (i === arr.length - 1 && c === "") return false;
          return true;
        });
        if (cells.length === colCount) {
          dataRows.push(cells);
        }
      }

      if (dataRows.length === 0) return;

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

      parent.children.splice(index, 1, table);
      return [SKIP, index + 1];
    });
  };
};

export default remarkSplitInlineTable;
