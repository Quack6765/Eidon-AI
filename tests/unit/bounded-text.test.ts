import { describe, expect, it } from "vitest";

import { truncateMiddle } from "@/lib/bounded-text";

describe("truncateMiddle", () => {
  it("returns text within the limit unchanged", () => {
    expect(truncateMiddle("short", 10)).toBe("short");
  });

  it("keeps the start and a longer end around a marker, within the limit", () => {
    const value = `${"a".repeat(100)}${"b".repeat(100)}`;

    const truncated = truncateMiddle(value, 60);

    expect(truncated).toHaveLength(60);
    expect(truncated).toContain("\n...[truncated]...\n");
    const [head, tail] = truncated.split("\n...[truncated]...\n");
    expect(head).toBe("a".repeat(head.length));
    expect(tail).toBe("b".repeat(tail.length));
    expect(tail.length).toBeGreaterThan(head.length);
  });

  it("falls back to a plain cut when the limit is smaller than the marker", () => {
    expect(truncateMiddle("x".repeat(50), 10)).toHaveLength(10);
  });
});
