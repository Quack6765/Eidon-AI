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

  it("(d) inline fence with non-empty before text", () => {
    const out = runPlugin(
      "intro text\n```js\ncode();\n```tail text",
      remarkFixInlineFences
    );
    expect(out).toContain("intro text");
    expect(out).toContain("```js");
    expect(out).toContain("code();");
    expect(out).toContain("tail text");
  });

  it("(d) inline fence with no before or tail — only code block", () => {
    const out = runPlugin("\n```js\ncode();\n```", remarkFixInlineFences);
    expect(out).toContain("```js");
    expect(out).toContain("code();");
  });

  it("does not touch mermaid blocks even if their content contains stray backticks", () => {
    const input = "```mermaid\ngraph TD\n  A[\"`tick`\"] --> B[end]\n```\n\nNext paragraph";
    const out = runPlugin(input, remarkFixInlineFences);
    expect(out).toContain("```mermaid");
    expect(out).toContain("graph TD");
    expect(out).toContain('A["`tick`"]');
    expect(out).toContain("--> B[end]");
    expect(out).toContain("Next paragraph");
  });
});
