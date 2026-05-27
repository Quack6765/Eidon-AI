// tests/unit/markdown/regression-fixtures.test.ts
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import { MARKDOWN_REMARK_PLUGINS } from "@/lib/markdown/plugins";

function render(input: string): string {
  const proc = unified().use(remarkParse).use(remarkGfm);
  for (const plugin of MARKDOWN_REMARK_PLUGINS) proc.use(plugin as never);
  return proc
    .use(remarkStringify, { bullet: "-", listItemIndent: "one" })
    .processSync(input)
    .toString()
    .trimEnd();
}

describe("regression fixtures from production screenshots", () => {
  it("fixture: PlayStation inline-code split across newline", () => {
    const input = "- PlayStation: `L1\n  - R1`";
    const out = render(input);
    expect(out).toContain("`L1/R1`");
    expect(out).not.toMatch(/-\s+R1`/);
  });

  it("fixture: bold spans paragraph + list boundary", () => {
    const input = "The **USB cable\n\n- PowerPanel software** approach";
    const out = render(input);
    expect(out).toMatch(/\*\*USB cable\*\*/);
    expect(out).toMatch(/\*\*PowerPanel software\*\*/);
  });

  it("fixture: collapsed transfer-time table", () => {
    const input =
      "| Transfer Time | Runtime | |---|---| | What it is | gap | | Duration | 4-8 ms |";
    const out = render(input);
    expect(out).toContain("| Transfer Time");
    expect(out).toContain("| 4-8 ms");
    expect(out.split("\n").filter((l) => l.startsWith("|")).length).toBeGreaterThanOrEqual(3);
  });

  it("fixture: SLA-replacement table with strikethrough cells", () => {
    const input =
      "5. **Cost-Benefit Doesn't Add Up**\n\n" +
      "| Lead-acid | LiFePO₄ | |---|---| | $40-60 | $80-120 |";
    const out = render(input);
    expect(out).toContain("|");
    expect(out).toContain("$40-60");
  });

  it("fixture: ordered list with broken numbering (1, 2, 7, 2)", () => {
    const input = "1. First\n\nprose\n\n7. Third\n\n2. Fourth";
    const out = render(input);
    // After renumber + merge, ideally one sequence 1, 2, 3, 4.
    const numbers = (out.match(/^\d+\./gm) || []).map((s) => s.replace(/\./, ""));
    expect(numbers[0]).toBe("1");
  });

  it("fixture: extra blank lines between bullet items (loose -> tight)", () => {
    const input =
      "- Level 1\n\n  - Level 2\n\n    - Level 3\n\n      - Level 4\n\n- Another Level 1";
    const out = render(input);
    // Most adjacent items at the same level should NOT have a blank line between them.
    expect(out.split("\n\n").length).toBeLessThan(6);
  });

  it("fixture: mixed emphasis markers leak literal **", () => {
    const input = "- **_Bold and Italic_** combined";
    const out = render(input);
    expect(out).toContain("Bold and Italic");
  });

  it("fixture: sentence split across two bullets ending in 'range.'", () => {
    const input =
      "- 8 more Gym Badges — challenge all 8 Kanto Gym Leaders with teams in the level 40-60\n- range.";
    const out = render(input);
    expect(out).toContain("40-60 range.");
    expect(out.split("\n").filter((l) => l.trim().startsWith("- ")).length).toBe(1);
  });

  it("fixture: API endpoints table with inline code in cells", () => {
    const input =
      "| Endpoint | Method | Description | Status | |---|---|---|---| | `/api/v1/vessels` | GET | Retrieve all active vessels | Active | | `/api/v1/vessels/{id}` | GET | Get vessel details | Active |";
    const out = render(input);
    expect(out).toContain("| Endpoint");
    expect(out).toContain("api/v1/vessels");
    expect(out).toContain("api/v1/vessels/{id}");
    expect(out.split("\n").filter((l) => l.startsWith("|")).length).toBeGreaterThanOrEqual(3);
  });

  it("fixture: inline ` * ` list markers across sub-bullet text", () => {
    const input =
      "- Active Vessels\n  - Cargo haulers * Class-A heavy freighters * Sub-type: Deep space variants * Capacity: 50,000";
    const out = render(input);
    expect(out).toContain("- Cargo haulers");
    expect(out).toContain("- Class-A heavy freighters");
    expect(out).toContain("- Sub-type: Deep space variants");
  });

  it("fixture: thematic break glued to end of heading", () => {
    const input = "# Annual Fantasy Realm Census Report 2026---\n## Executive Summary\nBody text";
    const out = render(input);
    expect(out).toContain("# Annual Fantasy Realm Census Report 2026");
    expect(out).not.toMatch(/2026-{3}/);
    expect(out).toContain("***");
    expect(out).toContain("## Executive Summary");
  });

  it("fixture: thematic break glued to end of paragraph", () => {
    const input = "Some paragraph ending in marker---\n\nNext paragraph";
    const out = render(input);
    expect(out).toContain("Some paragraph ending in marker");
    expect(out).toContain("***");
    expect(out).toContain("Next paragraph");
  });

  it("fixture: code block closer glued to last code line, swallowing rest of response", () => {
    const input =
      "```yaml\nserver:\n  port: 8443\n  - user:email```\n\n### API Endpoint Documentation\n\n| Parameter | Type |\n|---|---|\n| grant_type | string |";
    const out = render(input);
    expect(out).toContain("### API Endpoint Documentation");
    expect(out).toContain("| Parameter");
    expect(out).toMatch(/grant\\?_type/);
    expect(out).toMatch(/```yaml[\s\S]*?```/);
  });
});
