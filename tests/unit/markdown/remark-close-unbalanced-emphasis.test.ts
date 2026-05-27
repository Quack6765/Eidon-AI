// tests/unit/markdown/remark-close-unbalanced-emphasis.test.ts
import { describe, it, expect } from "vitest";
import remarkCloseUnbalancedEmphasis from "@/lib/markdown/plugins/remark-close-unbalanced-emphasis";
import { runPlugin } from "./_harness";

describe("remark-close-unbalanced-emphasis", () => {
  it("closes ** opener orphaned across paragraph + list boundary", () => {
    const out = runPlugin(
      "The **USB cable\n\n- PowerPanel software** approach",
      remarkCloseUnbalancedEmphasis
    );
    expect(out).toContain("**USB cable**");
    expect(out).toContain("**PowerPanel software**");
  });

  it("leaves balanced emphasis alone", () => {
    const input = "Use **bold** and *italic* properly.";
    expect(runPlugin(input, remarkCloseUnbalancedEmphasis)).toBe(input);
  });

  it("is idempotent", () => {
    const once = runPlugin(
      "The **USB cable\n\n- PowerPanel software** approach",
      remarkCloseUnbalancedEmphasis
    );
    const twice = runPlugin(once, remarkCloseUnbalancedEmphasis);
    expect(twice).toBe(once);
  });
});
