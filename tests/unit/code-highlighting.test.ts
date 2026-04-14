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

    it("does not auto-detect plain label/value text as yaml", () => {
      expect(detectCodeLanguage("Name: John\nRole: admin\nStatus: active")).toBeNull();
    });

    it("does not auto-detect account-like text as sql", () => {
      expect(detectCodeLanguage("user: alice@example.com\nactive: true")).toBeNull();
    });

    it("does not auto-detect urls as bash", () => {
      expect(detectCodeLanguage("http://localhost:3000/api/users?id=1")).toBeNull();
    });

    it("does not auto-detect plain multiline text as css", () => {
      expect(detectCodeLanguage("line one\nline two\nline three")).toBeNull();
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

    it("falls back for the known plain-text false positives", () => {
      const samples = [
        "Name: John\nRole: admin\nStatus: active",
        "user: alice@example.com\nactive: true",
        "http://localhost:3000/api/users?id=1",
        "line one\nline two\nline three"
      ];

      for (const sample of samples) {
        const result = renderHighlightedCode(null, sample);

        expect(result.language).toBeNull();
        expect(result.displayLanguage).toBeNull();
        expect(result.html).toBe(sample);
        expect(result.usedFallback).toBe(true);
      }
    });
  });
});
