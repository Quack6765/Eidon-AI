// tests/unit/markdown/remark-extract-inline-thematic-breaks.test.ts
import { describe, it, expect } from "vitest";
import remarkExtractInlineThematicBreaks from "@/lib/markdown/plugins/remark-extract-inline-thematic-breaks";
import { runPlugin } from "./_harness";

describe("remark-extract-inline-thematic-breaks", () => {
  it("splits paragraph at inline ---", () => {
    const out = runPlugin(
      "paragraph 1 end---paragraph 2 start",
      remarkExtractInlineThematicBreaks
    );
    expect(out).toBe("paragraph 1 end\n\n***\n\nparagraph 2 start");
  });

  it("splits at inline *** sequence", () => {
    const out = runPlugin("aaa***bbb", remarkExtractInlineThematicBreaks);
    expect(out).toBe("aaa\n\n***\n\nbbb");
  });

  it("leaves valid thematic breaks alone", () => {
    const input = "paragraph 1\n\n---\n\nparagraph 2";
    expect(runPlugin(input, remarkExtractInlineThematicBreaks)).toBe(
      "paragraph 1\n\n***\n\nparagraph 2"
    );
  });

  it("does not split when --- is part of word-like context", () => {
    // hyphen + word boundary should NOT trigger
    const input = "use --flag-name and --other";
    expect(runPlugin(input, remarkExtractInlineThematicBreaks)).toBe(input);
  });

  it("is idempotent", () => {
    const once = runPlugin("a---b", remarkExtractInlineThematicBreaks);
    const twice = runPlugin(once, remarkExtractInlineThematicBreaks);
    expect(twice).toBe(once);
  });

  it("does not eat dashes from inside an inline table separator run", () => {
    const input =
      "| Header 1 | Header 2 | Header 3 | Header 4 ||---------|---------|---------|---------| | Cell 1A | Cell 2A | Cell 3A | Cell 4A |";
    const out = runPlugin(input, remarkExtractInlineThematicBreaks);
    expect(out).not.toContain("***");
    expect(out).toContain("|---------|");
  });

  it("still splits a real inline thematic break followed by emphasis text", () => {
    const out = runPlugin("done---*emphasized text*", remarkExtractInlineThematicBreaks);
    expect(out).toContain("***");
    expect(out).toContain("*emphasized text*");
  });
});
