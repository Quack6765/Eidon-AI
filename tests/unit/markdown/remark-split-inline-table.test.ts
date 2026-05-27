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
});
