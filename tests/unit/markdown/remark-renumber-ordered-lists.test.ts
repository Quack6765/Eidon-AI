// tests/unit/markdown/remark-renumber-ordered-lists.test.ts
import { describe, it, expect } from "vitest";
import remarkRenumberOrderedLists from "@/lib/markdown/plugins/remark-renumber-ordered-lists";
import { runPlugin } from "./_harness";

describe("remark-renumber-ordered-lists", () => {
  it("resets ordered list start to 1", () => {
    // `start` is honored only on the first item; remark-stringify uses it.
    const input = "7. First\n8. Second";
    const out = runPlugin(input, remarkRenumberOrderedLists);
    expect(out).toBe("1. First\n2. Second");
  });

  it("merges two adjacent ordered lists separated by a single short paragraph", () => {
    const input = "1. First\n\nshort note\n\n2. Second";
    const out = runPlugin(input, remarkRenumberOrderedLists);
    expect(out).toContain("1. First");
    expect(out).toContain("2. Second");
    // Should result in 1 ordered list block with 2 items.
    const orderedLines = out.split("\n").filter((l) => /^\d+\./.test(l));
    expect(orderedLines.length).toBe(2);
  });

  it("does not modify unordered lists", () => {
    const input = "- A\n- B";
    expect(runPlugin(input, remarkRenumberOrderedLists)).toBe(input);
  });

  it("is idempotent", () => {
    const input = "7. A\n8. B";
    const once = runPlugin(input, remarkRenumberOrderedLists);
    const twice = runPlugin(once, remarkRenumberOrderedLists);
    expect(twice).toBe(once);
  });
});
