// tests/unit/markdown/remark-merge-unclosed-inline-code.test.ts
import { describe, it, expect } from "vitest";
import remarkMergeUnclosedInlineCode from "@/lib/markdown/plugins/remark-merge-unclosed-inline-code";
import { runPlugin } from "./_harness";

describe("remark-merge-unclosed-inline-code", () => {
  it("merges item text ending in unclosed backtick with sub-item closing it", () => {
    const out = runPlugin(
      "- PlayStation: `L1\n  - R1`",
      remarkMergeUnclosedInlineCode
    );
    expect(out).toBe("- PlayStation: `L1/R1`");
  });

  it("leaves well-formed inline code alone", () => {
    const input = "- PlayStation: `L1` / `R1`";
    expect(runPlugin(input, remarkMergeUnclosedInlineCode)).toBe(input);
  });

  it("is idempotent", () => {
    const once = runPlugin(
      "- A: `x\n  - y`",
      remarkMergeUnclosedInlineCode
    );
    const twice = runPlugin(once, remarkMergeUnclosedInlineCode);
    expect(twice).toBe(once);
  });

  it("handles tail text after closing backtick in sub-item", () => {
    const out = runPlugin(
      "- A: `open\n  - close` extra",
      remarkMergeUnclosedInlineCode
    );
    expect(out).toContain("`open/close`");
    expect(out).toContain("extra");
  });

  it("skips items with multiple sub-list children", () => {
    const input = "- A: `text\n  - sub1\n  - sub2`";
    const out = runPlugin(input, remarkMergeUnclosedInlineCode);
    expect(out).toContain("A:");
  });

  it("skips items where sub-item paragraph text has no closing backtick", () => {
    const out = runPlugin(
      "- open `code\n  - no closing backtick here",
      remarkMergeUnclosedInlineCode
    );
    expect(out).toContain("open");
  });

  it("skips single-child list items (no sub-list present)", () => {
    const input = "- just text here";
    const out = runPlugin(input, remarkMergeUnclosedInlineCode);
    expect(out).toBe(input);
  });
});
