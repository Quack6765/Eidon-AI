// tests/unit/markdown/remark-normalize-mixed-emphasis.test.ts
import { describe, it, expect } from "vitest";
import remarkNormalizeMixedEmphasis from "@/lib/markdown/plugins/remark-normalize-mixed-emphasis";
import { runPlugin } from "./_harness";

describe("remark-normalize-mixed-emphasis", () => {
  it("strips literal ** when adjacent to existing emphasis nodes (mixed-marker leakage)", () => {
    // Synthetic: parser left **_Bold and Italic_** as literal text fragments.
    const out = runPlugin("**_Bold and Italic_**", remarkNormalizeMixedEmphasis);
    expect(out).not.toContain("**");
    expect(out).toContain("Bold and Italic");
  });

  it("leaves clean literal ** inside code blocks alone", () => {
    const input = "```\n**not bold**\n```";
    expect(runPlugin(input, remarkNormalizeMixedEmphasis)).toBe(input);
  });

  it("is idempotent", () => {
    const once = runPlugin("**_X_**", remarkNormalizeMixedEmphasis);
    const twice = runPlugin(once, remarkNormalizeMixedEmphasis);
    expect(twice).toBe(once);
  });
});
