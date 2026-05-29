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

  it("passes through blockquote with non-text first child unchanged", () => {
    const input = "> **bold item**\n> > nested";
    const out = runPlugin(input, remarkNormalizeBlockquoteNesting);
    expect(out).toContain("> **bold item**");
  });

  it("handles blockquote with non-paragraph child (code block inside quote)", () => {
    const input = "> ```\n> code\n> ```";
    const out = runPlugin(input, remarkNormalizeBlockquoteNesting);
    expect(out).toContain(">");
  });

  it("splits inline > markers inside a blockquote paragraph into sibling paragraphs", () => {
    const input =
      "> Warning text here.> Historical Note: legacy system info here.";
    const out = runPlugin(input, remarkNormalizeBlockquoteNesting);
    expect(out).toMatch(/^> Warning text here\.\s*$/m);
    expect(out).toMatch(/^> Historical Note: legacy system info here\.\s*$/m);
  });

  it("splits inline > > markers inside a blockquote into a nested sub-blockquote", () => {
    const input =
      "> Warning: deprecated soon.> > Additional Context: migrate now.";
    const out = runPlugin(input, remarkNormalizeBlockquoteNesting);
    expect(out).toMatch(/^> Warning: deprecated soon\./m);
    expect(out).toMatch(/^> > Additional Context: migrate now\./m);
  });

  it("preserves italic emphasis when splitting inline blockquote markers", () => {
    const input =
      "> *Warning: deprecated by Jan 15, 2026.*> > *Additional Context: migrate now.*> *Historical Note: from Q2 2023.*";
    const out = runPlugin(input, remarkNormalizeBlockquoteNesting);
    expect(out).toMatch(/\*Warning: deprecated by Jan 15, 2026\.\*/);
    expect(out).toMatch(/\*Additional Context: migrate now\.\*/);
    expect(out).toMatch(/\*Historical Note: from Q2 2023\.\*/);
    expect(out).toMatch(/^> > \*Additional Context/m);
  });

  it("does not split a paragraph with a single isolated > inside (comparison-like)", () => {
    const input = "> If x > 5 then proceed";
    const out = runPlugin(input, remarkNormalizeBlockquoteNesting);
    expect(out.split("\n").filter((l) => l.trim().startsWith(">")).length).toBe(1);
  });
});
