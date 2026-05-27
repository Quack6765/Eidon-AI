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

  it("fixture: inline markdown preserved when split by ` * ` markers", () => {
    const input =
      "- A dragon warding system rated `Grade-A` or higher * Current count: `2` * **City** (50,000 residents)";
    const out = render(input);
    expect(out).toMatch(/`Grade-A`/);
    expect(out).toMatch(/`2`/);
    expect(out).toMatch(/\*\*City\*\*/);
    expect(out).not.toMatch(/`Grade-A\\`/);
  });

  it("fixture: inline markdown preserved when split by inline thematic break", () => {
    const input = "Some `code` ending---**Next** paragraph with `more code`";
    const out = render(input);
    expect(out).toMatch(/`code`/);
    expect(out).toMatch(/\*\*Next\*\*/);
    expect(out).toMatch(/`more code`/);
    expect(out).toContain("***");
  });

  it("fixture: leading --- glued to ## heading at line start", () => {
    const input = "---## Troubleshooting\n\n### Common Issues";
    const out = render(input);
    expect(out).toContain("***");
    expect(out).toContain("## Troubleshooting");
    expect(out).toContain("### Common Issues");
    expect(out).not.toMatch(/---##/);
  });

  it("fixture: single `* Capital` marker after glued asterisk", () => {
    const input =
      "- Contact support at <support@summitos.fake>* Network unreachable";
    const out = render(input);
    expect(out.split("\n").filter((l) => l.trim().startsWith("- ")).length).toBeGreaterThanOrEqual(2);
    expect(out).toContain("Network unreachable");
  });

  it("fixture: ### heading marker after inline code in paragraph", () => {
    const input = "Verify DNS settings in `/etc/summit/network.conf` ### Known Limitations";
    const out = render(input);
    expect(out).toContain("`/etc/summit/network.conf`");
    expect(out).toMatch(/^### Known Limitations/m);
  });

  it("fixture: multi-word title with capital words is not split by heading-from-text heuristic", () => {
    const input = 'Roadmap### Q3 2026 — "Horizon" Release\n\nNext paragraph';
    const out = render(input);
    expect(out).toMatch(/### Q3 2026.*Horizon.*Release/);
    expect(out).not.toMatch(/### Q3 2026 — "Horizon"\n\nRelease/);
  });

  it("fixture: nested ### inside an existing heading promotes a sub-heading", () => {
    const input = "## API Reference### Authentication Endpoint";
    const out = render(input);
    expect(out).toMatch(/^## API Reference/m);
    expect(out).toMatch(/^### Authentication Endpoint/m);
  });

  it("fixture: --- glued after a period at end of a blockquote paragraph", () => {
    const input = "> **Note:** This is a fictional project document. All data is made up.---\n\nNext block";
    const out = render(input);
    expect(out).toContain("made up.");
    expect(out).not.toMatch(/made up\.-{3}/);
    expect(out).toContain("***");
    expect(out).toContain("Next block");
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
