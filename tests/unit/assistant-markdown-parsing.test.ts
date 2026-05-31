import { describe, it, expect } from "vitest";

import {
  decodeMarkdownTarget,
  isExternalMarkdownTarget,
  findMarkdownTargets,
  parseAssistantDataImageTarget,
  normalizeProtectedMarkdownContent,
  normalizeProtectedMarkdownContentOutsideCodeBlocks
} from "@/lib/assistant-markdown-parsing";

describe("normalizeProtectedMarkdownContent", () => {
  it("collapses runs of blank lines and strips trailing spaces", () => {
    expect(normalizeProtectedMarkdownContent("A\n\n\n\nB")).toBe("A\n\nB");
    expect(normalizeProtectedMarkdownContent("Line with trailing   \nNext")).toBe(
      "Line with trailing\nNext"
    );
  });

  it("strips leading and trailing blank lines but not leading indentation", () => {
    expect(normalizeProtectedMarkdownContent("\n\n  Body\n\n")).toBe("  Body");
  });
});

describe("normalizeProtectedMarkdownContentOutsideCodeBlocks", () => {
  it("preserves whitespace inside fenced code blocks verbatim", () => {
    const input = "```js\nconst a = 1;\n\n\nconst b = 2;\n```";
    expect(normalizeProtectedMarkdownContentOutsideCodeBlocks(input)).toContain(
      "const a = 1;\n\n\nconst b = 2;"
    );
  });

  it("normalizes prose around a fenced code block while keeping the block intact", () => {
    const input = "Heading\n\n\n\nText\n\n```js\nx\n```";
    const result = normalizeProtectedMarkdownContentOutsideCodeBlocks(input);

    expect(result).toContain("Heading\n\nText");
    expect(result).toContain("```js\nx\n```");
  });

  it("normalizes content with no code blocks", () => {
    expect(normalizeProtectedMarkdownContentOutsideCodeBlocks("A\n\n\n\nB")).toBe("A\n\nB");
  });
});

describe("decodeMarkdownTarget", () => {
  it("decodes valid percent-encoding", () => {
    expect(decodeMarkdownTarget("a%20b")).toBe("a b");
  });

  it("returns the raw target when percent-encoding is invalid", () => {
    expect(decodeMarkdownTarget("%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("isExternalMarkdownTarget", () => {
  it("treats scheme-prefixed targets as external", () => {
    expect(isExternalMarkdownTarget("https://example.com/x.png")).toBe(true);
    expect(isExternalMarkdownTarget("mailto:a@b.com")).toBe(true);
  });

  it("treats local paths as not external", () => {
    expect(isExternalMarkdownTarget("/tmp/shot.png")).toBe(false);
    expect(isExternalMarkdownTarget("relative/file.txt")).toBe(false);
  });
});

describe("parseAssistantDataImageTarget", () => {
  it("returns 'none' for a non-data target", () => {
    expect(parseAssistantDataImageTarget("/tmp/shot.png").type).toBe("none");
  });

  it("returns 'invalid' for a data image with malformed base64", () => {
    expect(parseAssistantDataImageTarget("data:image/png;base64,@@@@").type).toBe("invalid");
  });

  it("salvages a valid data image into managed-attachment metadata", () => {
    const base64 = Buffer.from("hi").toString("base64");
    const parsed = parseAssistantDataImageTarget(`data:image/png;base64,${base64}`);

    expect(parsed.type).toBe("valid");
    if (parsed.type === "valid") {
      expect(parsed.filename).toBe("generated.png");
      expect(parsed.mimeType).toBe("image/png");
    }
  });
});

describe("findMarkdownTargets", () => {
  it("returns nothing for plain prose", () => {
    expect(findMarkdownTargets("Just some text with no links.")).toEqual([]);
  });

  it("locates inline image and link targets", () => {
    const targets = findMarkdownTargets("See ![alt](/tmp/a.png) and [doc](/tmp/b.txt).");
    expect(targets.map((target) => target.target)).toEqual(["/tmp/a.png", "/tmp/b.txt"]);
    expect(targets.find((target) => target.target === "/tmp/a.png")?.isImage).toBe(true);
  });
});
