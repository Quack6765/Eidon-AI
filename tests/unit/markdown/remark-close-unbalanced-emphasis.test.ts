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

  it("appends ** to close orphaned opener at start of text (firstIdx === 0)", () => {
    const out = runPlugin("**just text", remarkCloseUnbalancedEmphasis);
    expect(out).toContain("**just text**");
  });

  it("appends ** to close orphaned opener fragment in middle of text", () => {
    const out = runPlugin("text **extra", remarkCloseUnbalancedEmphasis);
    expect(out).toContain("**extra**");
  });

  it("handles text with leading text before ** marker", () => {
    const out = runPlugin("intro **bold** end", remarkCloseUnbalancedEmphasis);
    expect(out).toContain("**bold**");
  });

  it("prepends ** to close orphaned closer fragment (non-space before **)", () => {
    const out = runPlugin("The **bold\n\ntext** approach", remarkCloseUnbalancedEmphasis);
    expect(out).toContain("**bold**");
    expect(out).toContain("**text**");
  });

  it("leaves text with only lone ** markers unchanged when they cannot form a pair", () => {
    const out = runPlugin("Just **** markers here", remarkCloseUnbalancedEmphasis);
    expect(out).toContain("markers here");
  });

  it("prepends ** when closer fragment has non-space before and space after", () => {
    const out = runPlugin("word** end", remarkCloseUnbalancedEmphasis);
    expect(out).toContain("**word**");
  });
});
