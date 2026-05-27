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
});
