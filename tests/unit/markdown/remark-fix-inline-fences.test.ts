// tests/unit/markdown/remark-fix-inline-fences.test.ts
import { describe, it, expect } from "vitest";
import remarkFixInlineFences from "@/lib/markdown/plugins/remark-fix-inline-fences";
import { runPlugin } from "./_harness";

describe("remark-fix-inline-fences", () => {
  it("(c) splits closer glued to following text", () => {
    const out = runPlugin(
      "```js\nconsole.log(\"hi\");\n```Start of other paragraph",
      remarkFixInlineFences
    );
    expect(out).toMatch(/```js\nconsole\.log\("hi"\);\n```/);
    expect(out).toMatch(/Start of other paragraph$/);
  });

  it("(d) splits an all-on-one-line code-like phrase into paragraphs", () => {
    const out = runPlugin(
      "some code```Start other paragraph",
      remarkFixInlineFences
    );
    expect(out).toContain("some code");
    expect(out).toContain("Start other paragraph");
  });

  it("leaves well-formed fenced blocks alone", () => {
    const input = "```js\nconsole.log(\"hi\");\n```";
    expect(runPlugin(input, remarkFixInlineFences)).toBe(input);
  });

  it("is idempotent", () => {
    const input = "```js\nx = 1;\n```text after";
    const once = runPlugin(input, remarkFixInlineFences);
    const twice = runPlugin(once, remarkFixInlineFences);
    expect(twice).toBe(once);
  });
});
