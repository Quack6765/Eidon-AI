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
    it("detects simple shell command chains as bash", () => {
      expect(detectCodeLanguage("curl https://example.com && echo ok")).toBe("bash");
      expect(detectCodeLanguage("git status && npm test")).toBe("bash");
      expect(detectCodeLanguage("git status")).toBe("bash");
      expect(detectCodeLanguage("npm install react")).toBe("bash");
    });

    it("detects sql from common query syntax", () => {
      expect(detectCodeLanguage("SELECT id, email FROM users WHERE active = 1;")).toBe("sql");
      expect(detectCodeLanguage("UPDATE users SET active = 1")).toBe("sql");
      expect(detectCodeLanguage("SELECT id FROM users")).toBe("sql");
    });

    it("does not auto-detect plain english verb phrases as sql", () => {
      expect(detectCodeLanguage("select the option from the menu")).toBeNull();
      expect(detectCodeLanguage("delete the file from your desktop")).toBeNull();
      expect(detectCodeLanguage("for each item, delete it from the list")).toBeNull();
    });

    it("detects yaml with comments or nesting", () => {
      expect(detectCodeLanguage("foo: bar\n# comment\nbaz: qux")).toBe("yaml");
      expect(detectCodeLanguage("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo")).toBe("yaml");
    });

    it("does not auto-detect plain label/value text as yaml", () => {
      expect(detectCodeLanguage("Name: John\nRole: admin\nStatus: active")).toBeNull();
      expect(detectCodeLanguage("name: John\nrole: admin\nstatus: active")).toBeNull();
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

    it("uses the detected sql path for undeclared sql snippets", () => {
      const result = renderHighlightedCode(null, "SELECT id FROM users");

      expect(result.language).toBe("sql");
      expect(result.displayLanguage).toBe("sql");
      expect(result.usedFallback).toBe(false);
    });
  });
});
