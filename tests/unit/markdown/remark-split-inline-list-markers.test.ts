import { describe, it, expect } from "vitest";
import remarkSplitInlineListMarkers from "@/lib/markdown/plugins/remark-split-inline-list-markers";
import { runPlugin } from "./_harness";

describe("remark-split-inline-list-markers", () => {
  it("splits sibling items separated by ` * ` markers", () => {
    const input =
      "- Cargo haulers * Class-A heavy freighters * Sub-type: Deep space variants";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("- Cargo haulers");
    expect(out).toContain("- Class-A heavy freighters");
    expect(out).toContain("- Sub-type: Deep space variants");
  });

  it("does not fire on single inline ` * ` (ambiguous with emphasis/asterisk)", () => {
    const input = "- one * two";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toBe("- one \\* two");
  });

  it("preserves trailing sub-list children on the last new item", () => {
    const input = "- a * b * c\n\n  - sub of last";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("- c");
    expect(out).toContain("- sub of last");
  });

  it("ignores inline asterisks inside strong markers (`** **`)", () => {
    const input = "- **A * B** is bold";
    const out = runPlugin(input, remarkSplitInlineListMarkers);
    expect(out).toContain("**A \\* B**");
    expect(out).not.toMatch(/^- B/m);
  });

  it("is idempotent", () => {
    const input = "- a * b * c";
    const once = runPlugin(input, remarkSplitInlineListMarkers);
    const twice = runPlugin(once, remarkSplitInlineListMarkers);
    expect(twice).toBe(once);
  });
});
