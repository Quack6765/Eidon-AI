// tests/unit/markdown/remark-normalize-list-indentation.test.ts
import { describe, it, expect } from "vitest";
import remarkNormalizeListIndentation from "@/lib/markdown/plugins/remark-normalize-list-indentation";
import { runPlugin } from "./_harness";

describe("remark-normalize-list-indentation", () => {
  it("nests an under-indented child under its sibling parent", () => {
    // Parser sees this as 3 siblings because indents are 0/2/3 (not 0/2/4).
    const input = "- Level 1\n  - Level 2\n   - Level 3";
    const out = runPlugin(input, remarkNormalizeListIndentation);
    expect(out).toBe("- Level 1\n  - Level 2\n    - Level 3");
  });

  it("preserves a correctly-nested 3-level list", () => {
    const input = "- A\n  - B\n    - C";
    expect(runPlugin(input, remarkNormalizeListIndentation)).toBe(input);
  });

  it("is idempotent", () => {
    const input = "- A\n  - B\n   - C";
    const once = runPlugin(input, remarkNormalizeListIndentation);
    const twice = runPlugin(once, remarkNormalizeListIndentation);
    expect(twice).toBe(once);
  });
});
