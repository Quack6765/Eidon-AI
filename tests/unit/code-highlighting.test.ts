import {
  detectCodeLanguage,
  normalizeCodeFenceLanguage,
  renderHighlightedCode
} from "@/lib/code-highlighting";

describe("code highlighting helpers", () => {
  describe("normalizeCodeFenceLanguage", () => {
    it("normalizes supported aliases to canonical highlight.js language names", () => {
      expect(normalizeCodeFenceLanguage("py")).toBe("python");
      expect(normalizeCodeFenceLanguage("ts")).toBe("typescript");
      expect(normalizeCodeFenceLanguage("yml")).toBe("yaml");
      expect(normalizeCodeFenceLanguage("zsh")).toBe("bash");
    });
  });

  describe("detectCodeLanguage", () => {
    it("detects sql from common query syntax", () => {
      expect(detectCodeLanguage("SELECT id, email FROM users WHERE active = 1;")).toBe("sql");
    });
  });

  describe("renderHighlightedCode", () => {
    it("falls back to escaped plain text for unsupported languages", () => {
      const result = renderHighlightedCode("customlang", "hello <world>");

      expect(result.language).toBeNull();
      expect(result.displayLanguage).toBe("customlang");
      expect(result.html).toContain("&lt;world&gt;");
      expect(result.usedFallback).toBe(true);
    });

    it("keeps ordinary plain text unhighlighted when auto-detection confidence is weak", () => {
      const result = renderHighlightedCode(null, "Step 1: click save");

      expect(result.language).toBeNull();
      expect(result.displayLanguage).toBeNull();
      expect(result.html).toBe("Step 1: click save");
      expect(result.usedFallback).toBe(true);
    });
  });
});
