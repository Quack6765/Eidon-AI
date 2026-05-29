// tests/unit/markdown/remark-split-inline-table.test.ts
import { describe, it, expect } from "vitest";
import remarkSplitInlineTable from "@/lib/markdown/plugins/remark-split-inline-table";
import { runPlugin } from "./_harness";

describe("remark-split-inline-table", () => {
  it("splits a collapsed table with | | separators", () => {
    const out = runPlugin(
      "| A | B | |---|---| | a1 | b1 | | a2 | b2 |",
      remarkSplitInlineTable
    );
    expect(out).toContain("| A  | B  |");
    expect(out).toContain("| :- | :- |");
    expect(out).toContain("| a1 | b1 |");
    expect(out).toContain("| a2 | b2 |");
  });

  it("splits a collapsed table with || separators (no space)", () => {
    const out = runPlugin(
      "| A | B ||---|---|| a1 | b1 |",
      remarkSplitInlineTable
    );
    expect(out).toContain("| A  | B  |");
    expect(out).toContain("| a1 | b1 |");
  });

  it("does not modify a well-formed table", () => {
    const input = "| A | B |\n| - | - |\n| 1 | 2 |";
    const out = runPlugin(input, remarkSplitInlineTable);
    expect(out).toContain("| A | B |");
  });

  it("does not modify prose containing pipes", () => {
    const input = "Use the | operator carefully | otherwise things break.";
    expect(runPlugin(input, remarkSplitInlineTable)).toBe(input);
  });

  it("is idempotent", () => {
    const input = "| A | B | |---|---| | a | b |";
    const once = runPlugin(input, remarkSplitInlineTable);
    const twice = runPlugin(once, remarkSplitInlineTable);
    expect(twice).toBe(once);
  });

  it("preserves the last row when a trailing |--- artifact follows", () => {
    const input =
      "| A | B ||---|---|| a1 | b1 || a2 | b2 || a3 | b3 |---";
    const out = runPlugin(input, remarkSplitInlineTable);
    expect(out).toContain("| a1");
    expect(out).toContain("| a2");
    expect(out).toContain("| a3");
    expect(out.split("\n").filter((l) => l.startsWith("|")).length).toBeGreaterThanOrEqual(5);
  });

  it("renders a header-only table when the separator is truncated and no data rows follow", () => {
    const input = "| Squad | Focus | Lead | Members | |---|---";
    const out = runPlugin(input, remarkSplitInlineTable);
    expect(out).toMatch(/\|\s*Squad\s*\|/);
    expect(out).toMatch(/\|\s*Focus\s*\|/);
    expect(out).toMatch(/\|\s*Lead\s*\|/);
    expect(out).toMatch(/\|\s*Members\s*\|/);
    expect(out.split("\n").filter((l) => l.startsWith("|")).length).toBeGreaterThanOrEqual(2);
  });

  it("splits prose-glued-to-table into a paragraph + a real table", () => {
    const input =
      "Settings are loaded in the following order of precedence | Priority | Source ||---|---| | 1 | Default values | | 2 | Environment file |";
    const out = runPlugin(input, remarkSplitInlineTable);
    expect(out).toMatch(/^Settings are loaded in the following order of precedence$/m);
    expect(out).toMatch(/\|\s*Priority\s*\|/);
    expect(out).toMatch(/\|\s*Source\s*\|/);
    expect(out).toMatch(/\|\s*1\s*\|\s*Default values\s*\|/);
    expect(out).toMatch(/\|\s*2\s*\|\s*Environment file\s*\|/);
  });

  it("reconstructs table when header row is glued into a heading, separator on next line", () => {
    const input =
      "### Basic Table| Header 1 | Header 2 | Header 3 |\n|----------|----------|----------| | Cell 1.1 | Cell 1.2 | Cell 1.3 | | Cell 2.1 | Cell 2.2 | Cell 2.3 |";
    const out = runPlugin(input, remarkSplitInlineTable);
    expect(out).toMatch(/^### Basic Table\s*$/m);
    expect(out).toMatch(/\|\s*Header 1\s*\|\s*Header 2\s*\|\s*Header 3\s*\|/);
    expect(out).toMatch(/\|\s*Cell 1\.1\s*\|/);
    expect(out).toMatch(/\|\s*Cell 2\.3\s*\|/);
  });

  it("does not build a table when the header has fewer than two columns", () => {
    const input = "Prefix text | OneColumn ||---| | only |";
    const out = runPlugin(input, remarkSplitInlineTable);
    // No reconstructed table: the separator must NOT end up on its own line.
    expect(out).not.toMatch(/^\s*\|\s*:?-+:?\s*\|\s*$/m);
    expect(out).toContain("OneColumn");
  });

  it("does not build a table when no pipe precedes the separator run", () => {
    const input = "Just some prose without columns here |---|---|";
    const out = runPlugin(input, remarkSplitInlineTable);
    expect(out).toContain("Just some prose without columns here");
  });
});
