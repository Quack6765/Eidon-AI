import { describe, it, expect } from "vitest";
import type { PhrasingContent } from "mdast";
import {
  countMarkerRuns,
  pipeDensity,
  endsWithSentenceTerminator,
  parseInline,
  parseFragment,
  flattenInline,
} from "@/lib/markdown/ast-helpers";

describe("ast-helpers", () => {
  describe("countMarkerRuns", () => {
    it("counts ** runs while ignoring escaped asterisks", () => {
      expect(countMarkerRuns("a **b** c \\**d\\** e **f", "**")).toBe(3);
    });
    it("counts ` runs", () => {
      expect(countMarkerRuns("a `b` c `d", "`")).toBe(3);
    });
  });

  describe("pipeDensity", () => {
    it("returns pipes per 80 chars", () => {
      expect(pipeDensity("| a | b | c | d | e |")).toBeGreaterThan(0.2);
      expect(pipeDensity("hello world there friend")).toBe(0);
    });
    it("returns 0 for an empty string", () => {
      expect(pipeDensity("")).toBe(0);
    });
  });

  describe("endsWithSentenceTerminator", () => {
    it("recognizes . ! ? as terminators", () => {
      expect(endsWithSentenceTerminator("Done.")).toBe(true);
      expect(endsWithSentenceTerminator("Why?")).toBe(true);
      expect(endsWithSentenceTerminator("Wow!")).toBe(true);
    });
    it("returns false otherwise", () => {
      expect(endsWithSentenceTerminator("Done")).toBe(false);
      expect(endsWithSentenceTerminator("And then")).toBe(false);
    });
    it("returns false for empty or whitespace-only text", () => {
      expect(endsWithSentenceTerminator("")).toBe(false);
      expect(endsWithSentenceTerminator("    ")).toBe(false);
    });
  });

  describe("parseInline", () => {
    it("returns an empty array for blank input", () => {
      expect(parseInline("")).toEqual([]);
      expect(parseInline("   ")).toEqual([]);
    });
    it("parses inline phrasing content", () => {
      const out = parseInline("hello **world**");
      expect(out.some((n) => n.type === "strong")).toBe(true);
    });
    it("falls back to a text node when there is no paragraph", () => {
      const out = parseInline("---");
      expect(out).toEqual([{ type: "text", value: "---" }]);
    });
  });

  describe("parseFragment", () => {
    it("returns an empty array for blank input", () => {
      expect(parseFragment("   ")).toEqual([]);
    });
    it("parses block content", () => {
      const out = parseFragment("# Title\n\nBody");
      expect(out.some((n) => n.type === "heading")).toBe(true);
      expect(out.some((n) => n.type === "paragraph")).toBe(true);
    });
  });

  describe("flattenInline", () => {
    it("flattens text, code, strong, emphasis and delete nodes", () => {
      const children: PhrasingContent[] = [
        { type: "text", value: "a " },
        { type: "inlineCode", value: "code" },
        { type: "text", value: " " },
        { type: "strong", children: [{ type: "text", value: "b" }] },
        { type: "text", value: " " },
        { type: "emphasis", children: [{ type: "text", value: "c" }] },
        { type: "text", value: " " },
        { type: "delete", children: [{ type: "text", value: "d" }] },
      ];
      expect(flattenInline(children)).toBe("a `code` **b** *c* ~~d~~");
    });
    it("uses the value of other value-bearing nodes (e.g. html)", () => {
      const children = [{ type: "html", value: "<br>" }] as unknown as PhrasingContent[];
      expect(flattenInline(children)).toBe("<br>");
    });
    it("recurses into the children of other container nodes (e.g. link)", () => {
      const children = [
        {
          type: "link",
          url: "https://example.com",
          children: [{ type: "text", value: "label" }],
        },
      ] as unknown as PhrasingContent[];
      expect(flattenInline(children)).toBe("label");
    });
  });
});
