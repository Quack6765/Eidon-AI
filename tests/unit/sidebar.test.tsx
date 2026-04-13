// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { highlightMatch } from "@/components/sidebar";

describe("highlightMatch", () => {
  it("escapes raw html while preserving highlighted search text", () => {
    const result = highlightMatch('<img src=x onerror="alert(1)"> silver moon', "silver moon");

    expect(result).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(result).toContain('<mark class="bg-[var(--accent)]/30 text-white rounded px-0.5">silver moon</mark>');
    expect(result).not.toContain("<img");
    expect(result).not.toContain('onerror="alert(1)"');
  });
});
