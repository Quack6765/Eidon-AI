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
});
