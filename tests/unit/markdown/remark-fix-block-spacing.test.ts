import { describe, it, expect } from "vitest";
import remarkFixBlockSpacing from "@/lib/markdown/plugins/remark-fix-block-spacing";
import { runPlugin } from "./_harness";

describe("remark-fix-block-spacing", () => {
  it("(a) splits heading marker glued to preceding text", () => {
    const out = runPlugin("End of paragraph.## Next heading", remarkFixBlockSpacing);
    expect(out).toBe("End of paragraph.\n\n## Next heading");
  });

  it("(b) inserts space after hash run when missing", () => {
    const out = runPlugin("##Compact heading", remarkFixBlockSpacing);
    expect(out).toBe("## Compact heading");
  });

  it("(c) splits sandwiched heading into [para, heading, para]", () => {
    const out = runPlugin(
      "end paragraph 1.##Header1 Start of Paragraph 2",
      remarkFixBlockSpacing
    );
    expect(out).toBe(
      "end paragraph 1.\n\n## Header1\n\nStart of Paragraph 2"
    );
  });

  it("does not modify well-formed headings", () => {
    const input = "## Already correct\n\nbody text";
    expect(runPlugin(input, remarkFixBlockSpacing)).toBe(input);
  });

  it("is idempotent", () => {
    const input = "End.## Heading";
    const once = runPlugin(input, remarkFixBlockSpacing);
    const twice = runPlugin(once, remarkFixBlockSpacing);
    expect(twice).toBe(once);
  });

  it("(c) uses capital word boundary to split heading from following paragraph", () => {
    const out = runPlugin(
      "text.## Header Content More Content",
      remarkFixBlockSpacing
    );
    expect(out).toContain("## Header");
  });

  it("(c) handles paragraph with multiple children after glued heading split", () => {
    const out = runPlugin(
      "end.## Heading. Rest of text **bold** end",
      remarkFixBlockSpacing
    );
    expect(out).toContain("## Heading.");
    expect(out).toContain("**bold**");
  });

  it("splits a single-word heading glued to following prose via camelCase boundary", () => {
    const out = runPlugin(
      "## OverviewWelcome to the official documentation for our platform",
      remarkFixBlockSpacing
    );
    expect(out).toMatch(/^## Overview\s*$/m);
    expect(out).toMatch(/^Welcome to the official documentation for our platform/m);
  });

  it("does not split legitimate camelCase identifiers in short headings", () => {
    const out = runPlugin("## iPhone App Development", remarkFixBlockSpacing);
    expect(out).toBe("## iPhone App Development");
  });

  it("does not split when the heading already ends correctly with no glued prose", () => {
    const out = runPlugin("## My Section", remarkFixBlockSpacing);
    expect(out).toBe("## My Section");
  });

  it("(c) prefers camelCase boundary over SENTENCE_STARTER for multi-word title (Response Format)", () => {
    const out = runPlugin(
      "tail.#### Response FormatSuccessful responses return JSON in this structure:",
      remarkFixBlockSpacing
    );
    expect(out).toMatch(/^#### Response Format\s*$/m);
    expect(out).toMatch(/^Successful responses return JSON in this structure:/m);
  });

  it("splits multi-word capitalized title glued to following prose (Executive SummaryThis...)", () => {
    const out = runPlugin(
      "## Executive SummaryThis document outlines the specifications for Project Nebula.",
      remarkFixBlockSpacing
    );
    expect(out).toMatch(/^## Executive Summary\s*$/m);
    expect(out).toMatch(/^This document outlines the specifications for Project Nebula\./m);
  });

  it("does not split a legitimate multi-word title with no glued prose", () => {
    const input = "## Project Nebula Quantum Computing Dashboard";
    const out = runPlugin(input, remarkFixBlockSpacing);
    expect(out).toBe("## Project Nebula Quantum Computing Dashboard");
  });

  it("does not split a heading with a colon followed by more capitalized words", () => {
    const input = "## Project Nebula: Quantum Computing Dashboard";
    const out = runPlugin(input, remarkFixBlockSpacing);
    expect(out).toBe("## Project Nebula: Quantum Computing Dashboard");
  });

  it("does not treat hex colors (#e1f5fe) as heading markers in prose", () => {
    const input =
      "Some style A fill:#e1f5fe and style G fill:#c8e6c9 and style D fill:#ffcdd2 are colors.";
    const out = runPlugin(input, remarkFixBlockSpacing);
    expect(out).toBe(
      "Some style A fill:#e1f5fe and style G fill:#c8e6c9 and style D fill:#ffcdd2 are colors."
    );
  });

  it("does not treat hex colors with uppercase (#FF0000) as heading markers", () => {
    const input = "Color value: #FF0000 then more text";
    const out = runPlugin(input, remarkFixBlockSpacing);
    expect(out).toBe("Color value: #FF0000 then more text");
  });
});
