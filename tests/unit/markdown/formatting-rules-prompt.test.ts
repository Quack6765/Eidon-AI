import { describe, it, expect } from "vitest";
import { MARKDOWN_FORMATTING_RULES } from "@/lib/markdown/formatting-rules-prompt";

describe("MARKDOWN_FORMATTING_RULES", () => {
  it("frames the supported Markdown as the Streamdown-specific subset", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Streamdown/);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Supported Markdown — use only these/);
  });

  it("lists the core supported constructs (task lists, tables, mermaid)", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/- \[x\]/);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/pipe tables/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Mermaid diagrams inside/i);
  });

  it("explicitly forbids math/LaTeX, raw HTML, and GitHub alerts", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Do NOT use/);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Math \/ LaTeX/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Raw HTML tags/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/\[!NOTE\]/);
  });

  it("includes a Mermaid diagrams section", () => {
    expect(MARKDOWN_FORMATTING_RULES).toContain("### Mermaid diagrams");
  });

  it("instructs one statement/entry per line for mermaid", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/ONE statement, edge, node, entry, or task per line/i);
  });

  it("applies the mermaid rules to every diagram type (pie and mindmap included)", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/EVERY diagram type/i);
    expect(MARKDOWN_FORMATTING_RULES).toContain("pie");
    expect(MARKDOWN_FORMATTING_RULES).toContain("mindmap");
  });

  it("instructs always closing the mermaid fence so it does not swallow following content", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/close the block with .* on its own line/i);
  });

  it("covers the mindmap single-root / indentation rule", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/exactly ONE root/i);
  });

  it("warns against space-padding/alignment that glues statements together", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/do NOT pad lines with runs of spaces/i);
  });

  it("covers gantt section/task-per-line guidance", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/For `gantt`/);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/Task name :tag, start, duration/);
  });

  it("instructs always quoting every mermaid node label (incl. parentheses)", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/ALWAYS wrap the text of every node in double quotes/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/API Gateway \(Backup\)/);
  });

  it("covers sequenceDiagram statement-per-line and colon spacing", () => {
    expect(MARKDOWN_FORMATTING_RULES).toContain("sequenceDiagram");
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/A->>B: text/);
  });

  it("includes a Code blocks section", () => {
    expect(MARKDOWN_FORMATTING_RULES).toContain("### Code blocks");
  });

  it("warns against gluing the language name to the first line of code", () => {
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/language name/i);
    expect(MARKDOWN_FORMATTING_RULES).toMatch(/pythonimport/);
  });
});
