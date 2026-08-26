import { describe, expect, it } from "vitest";
import { normalizeLineBreaks } from "@/lib/text-utils";

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
