// tests/unit/markdown/remark-tighten-lists.test.ts
import { describe, it, expect } from "vitest";
import remarkTightenLists from "@/lib/markdown/plugins/remark-tighten-lists";
import { runPlugin } from "./_harness";

describe("remark-tighten-lists", () => {
  it("removes blank lines between short single-paragraph items", () => {
    const input = "- A\n\n- B\n\n- C";
    const out = runPlugin(input, remarkTightenLists);
    expect(out).toBe("- A\n- B\n- C");
  });

  it("preserves loose lists when items are long or multi-paragraph", () => {
    const longItem = "Long item text ".repeat(20).trim();
    const input = `- ${longItem}\n\n- ${longItem}`;
    const out = runPlugin(input, remarkTightenLists);
    expect(out).toContain("\n\n");
  });

  it("preserves loose lists when an item has multiple paragraphs", () => {
    const input = "- A\n\n  second paragraph\n\n- B";
    const out = runPlugin(input, remarkTightenLists);
    expect(out).toContain("\n\n");
  });

  it("is idempotent", () => {
    const once = runPlugin("- A\n\n- B", remarkTightenLists);
    const twice = runPlugin(once, remarkTightenLists);
    expect(twice).toBe(once);
  });
});
