// tests/unit/markdown/pipeline.test.ts
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import { MARKDOWN_REMARK_PLUGINS } from "@/lib/markdown/plugins";

function runPipeline(input: string): string {
  const proc = unified()
    .use(remarkParse)
    .use(remarkGfm);
  for (const plugin of MARKDOWN_REMARK_PLUGINS) {
    proc.use(plugin as never);
  }
  return proc
    .use(remarkStringify, { bullet: "-", listItemIndent: "one" })
    .processSync(input)
    .toString()
    .replace(/[ \t]+$/gm, "")
    .trimEnd();
}

describe("MARKDOWN_REMARK_PLUGINS pipeline", () => {
  it("loads all 12 plugins in order", () => {
    expect(MARKDOWN_REMARK_PLUGINS.length).toBe(12);
  });

  it("handles a mix of failure cases in one input", () => {
    const input =
      "End.## Heading\n\n" +
      "| A | B | |---|---| | 1 | 2 |\n\n" +
      "para 1---para 2\n\n" +
      "The **bold\n\n- list** item";
    const out = runPipeline(input);
    expect(out).toContain("## Heading");
    expect(out).toContain("| A");
    expect(out).toContain("***");
    expect(out).toMatch(/\*\*bold\*\*/);
  });
});
