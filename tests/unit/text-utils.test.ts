import { describe, expect, it } from "vitest";
import { normalizeLineBreaks, normalizeRealLineBreaks } from "@/lib/text-utils";

describe("normalizeLineBreaks", () => {
  it("returns the same reference when no carriage returns or backslashes are present", () => {
    const text = "Plain streamed prose\nwith regular newlines.";
    expect(normalizeLineBreaks(text)).toBe(text);
  });

  it("normalizes carriage return line breaks", () => {
    expect(normalizeLineBreaks("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("normalizes escaped line break sequences", () => {
    expect(normalizeLineBreaks("a\\nb")).toBe("a\nb");
    expect(normalizeLineBreaks("a\\r\\nb")).toBe("a\nb");
    expect(normalizeLineBreaks("a\\rb")).toBe("a\nb");
  });

  it("normalizes double-escaped sequences", () => {
    expect(normalizeLineBreaks("a\\\\nb")).toBe("a\nb");
    expect(normalizeLineBreaks("a\\\\r\\\\nb")).toBe("a\nb");
  });
});

describe("normalizeRealLineBreaks", () => {
  it("returns the same reference when no carriage returns are present", () => {
    const text = "Stored content\nwith newlines and \\left(\\right) LaTeX.";
    expect(normalizeRealLineBreaks(text)).toBe(text);
  });

  it("normalizes real carriage returns without touching escape sequences", () => {
    expect(normalizeRealLineBreaks("a\r\nb\rc")).toBe("a\nb\nc");
    expect(normalizeRealLineBreaks("a\\nb")).toBe("a\\nb");
    expect(normalizeRealLineBreaks("a\\rb")).toBe("a\\rb");
  });

  it("keeps LaTeX commands starting with backslash-r or backslash-n intact", () => {
    expect(normalizeRealLineBreaks("\\rho \\ne \\nu \\right) \\not\\equiv")).toBe(
      "\\rho \\ne \\nu \\right) \\not\\equiv"
    );
  });
});
