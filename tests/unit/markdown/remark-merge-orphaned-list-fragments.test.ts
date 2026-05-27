// tests/unit/markdown/remark-merge-orphaned-list-fragments.test.ts
import { describe, it, expect } from "vitest";
import remarkMergeOrphanedListFragments from "@/lib/markdown/plugins/remark-merge-orphaned-list-fragments";
import { runPlugin } from "./_harness";

describe("remark-merge-orphaned-list-fragments", () => {
  it("merges a single-word terminal fragment into the previous item", () => {
    const input =
      "- 8 more Gym Badges — challenge all 8 Kanto Gym Leaders in the level 40-60\n- range.";
    const out = runPlugin(input, remarkMergeOrphanedListFragments);
    expect(out).toContain("40-60 range.");
    expect(out.split("\n").filter((l) => l.startsWith("- ")).length).toBe(1);
  });

  it("does not merge when previous item ends with sentence terminator", () => {
    const input = "- First item.\n- Second.";
    expect(runPlugin(input, remarkMergeOrphanedListFragments)).toBe(input);
  });

  it("does not merge a long terminal item", () => {
    const input =
      "- One ends without period\n- Two has multiple words and is definitely an intentional item.";
    expect(runPlugin(input, remarkMergeOrphanedListFragments)).toBe(input);
  });

  it("is idempotent", () => {
    const once = runPlugin(
      "- without terminator\n- range.",
      remarkMergeOrphanedListFragments
    );
    const twice = runPlugin(once, remarkMergeOrphanedListFragments);
    expect(twice).toBe(once);
  });
});
