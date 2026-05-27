import { describe, it, expect } from "vitest";
import remarkFixBlockSpacing from "@/lib/markdown/plugins/remark-fix-block-spacing";
import { runPlugin } from "./_harness";

describe("remark-fix-block-spacing", () => {
  it("(a) splits heading marker glued to preceding text", () => {
    const out = runPlugin("End of paragraph.## Next heading", remarkFixBlockSpacing);
    expect(out).toBe("End of paragraph.\n\n## Next heading");
  });

  it("(b) inserts space after hash run when missing", () => {
    const out = runPlugin("##Compact heading", remarkFixBlockSpacing);
    expect(out).toBe("## Compact heading");
  });

  it("(c) splits sandwiched heading into [para, heading, para]", () => {
    const out = runPlugin(
      "end paragraph 1.##Header1 Start of Paragraph 2",
      remarkFixBlockSpacing
    );
    expect(out).toBe(
      "end paragraph 1.\n\n## Header1\n\nStart of Paragraph 2"
    );
  });

  it("does not modify well-formed headings", () => {
    const input = "## Already correct\n\nbody text";
    expect(runPlugin(input, remarkFixBlockSpacing)).toBe(input);
  });

  it("is idempotent", () => {
    const input = "End.## Heading";
    const once = runPlugin(input, remarkFixBlockSpacing);
    const twice = runPlugin(once, remarkFixBlockSpacing);
    expect(twice).toBe(once);
  });
});
