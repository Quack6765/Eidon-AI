// tests/unit/markdown/remark-normalize-blockquote-nesting.test.ts
import { describe, it, expect } from "vitest";
import remarkNormalizeBlockquoteNesting from "@/lib/markdown/plugins/remark-normalize-blockquote-nesting";
import { runPlugin } from "./_harness";

describe("remark-normalize-blockquote-nesting", () => {
  it("nests >> markers as 2-deep blockquotes", () => {
    // remark already handles "> > " but not ">>" with no spaces.
    const input = "> Level 1\n>> Level 2";
    const out = runPlugin(input, remarkNormalizeBlockquoteNesting);
    // Round-trip via remark-stringify normalizes nested quotes to "> > "
    expect(out).toContain("> Level 1");
    expect(out).toContain("> > Level 2");
  });

  it("nests >>> markers as 3-deep blockquotes", () => {
    const out = runPlugin(">>>Deep quote", remarkNormalizeBlockquoteNesting);
    expect(out).toContain("> > > Deep quote");
  });

  it("leaves well-formed blockquotes alone", () => {
    const input = "> A\n>\n> B";
    const out = runPlugin(input, remarkNormalizeBlockquoteNesting);
    expect(out).toContain("> A");
    expect(out).toContain("> B");
  });

  it("is idempotent", () => {
    const once = runPlugin(">>X", remarkNormalizeBlockquoteNesting);
    const twice = runPlugin(once, remarkNormalizeBlockquoteNesting);
    expect(twice).toBe(once);
  });
});
