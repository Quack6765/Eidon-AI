import { describe, it, expect } from "vitest";
import { MARKDOWN_FORMATTING_RULES } from "@/lib/markdown/formatting-rules-prompt";

describe("MARKDOWN_FORMATTING_RULES", () => {
  it("frames responses as GitHub Flavored Markdown", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/GitHub Flavored Markdown/);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/### Supported/);
  });

  it("lists the core supported constructs (task lists, tables, mermaid, code, rules)", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/- \[x\]/);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/pipe tables/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Mermaid diagrams inside/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Fenced code blocks/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Horizontal rules/i);
  });

  it("explicitly forbids math/LaTeX, raw HTML, and GitHub alerts", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Not supported/);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Math \/ LaTeX/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Raw HTML tags/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/\[!NOTE\]/);
  });

  it("keeps the essential Mermaid rules a strict parser needs", () => {
    expect(MARKDOWN_FORMATTING_RULES).toContain("### Mermaid diagrams");
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/on its own line/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/wrap every node label in double quotes/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/API Gateway \(Backup\)/);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/close the block with .* on its own line/i);
  });

  it("no longer claims Markdown support is limited to a custom subset", () => {
    expect(MARKDOWN_FORMATTING_RULES).not.toMatch(/use only these/i);
  });
});
