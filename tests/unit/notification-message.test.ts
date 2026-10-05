import { describe, expect, it } from "vitest";

import { renderNotifyMessage } from "@/lib/notification-message";

const NBSP = "\u00a0";
const LIMIT = 1024;

function html(markdown: string, maxChars = LIMIT): string {
  return renderNotifyMessage(markdown, "html", maxChars);
}

describe("notification message rendering", () => {
  it("renders plain text for channels without markup support", () => {
    const text = renderNotifyMessage(
      ["## Status", "", "- **api** is up", "", "[details](https://eidon.example.com/runs/1)", "a < b & c"].join("\n"),
      "text"
    );

    expect(text).toBe(
      [
        "Status",
        "",
        "• api is up",
        "",
        "details",
        "a < b & c"
      ].join("\n")
    );
  });

  it("truncates plain text at the last line that fits", () => {
    const text = renderNotifyMessage(["alpha", "beta", "gamma", "delta"].join("\n"), "text", 12);

    expect(text).toBe("alpha\nbeta…");
  });

  it("renders headings, emphasis, and lists as Pushover HTML", () => {
    const rendered = html(
      [
        "## Daily digest",
        "",
        "All **three** checks *passed* today.",
        "",
        "- first item",
        "- second item",
        "  - nested item",
        "1. ordered item"
      ].join("\n")
    );

    expect(rendered).toBe(
      [
        "<b>Daily digest</b>",
        "<br><br>",
        "All <b>three</b> checks <i>passed</i> today.",
        "<br><br>",
        `• first item<br>• second item<br>${NBSP.repeat(2)}• nested item<br>1. ordered item`
      ].join("")
    );
  });

  it("renders task lists and blockquotes with Pushover-safe marks", () => {
    const rendered = html(["- [x] deployed", "- [ ] rollback pending", "> noted by ops"].join("\n"));

    expect(rendered).toBe(`☑ deployed<br>☐ rollback pending<br>› noted by ops`);
  });

  it("keeps fenced code content and its indentation", () => {
    const rendered = html(["Here is the fix:", "", "```ts", "if (a) {", "  return 1;", "}", "```"].join("\n"));

    expect(rendered).toBe(
      `Here is the fix:<br><br>if (a) {<br>${NBSP.repeat(2)}return 1;<br>}`
    );
  });

  it("turns links into anchors and images into their alt text", () => {
    const rendered = html(
      ["See [the run](https://eidon.example.com/runs/1?a=1&b=2).", "![a chart](https://eidon.example.com/c.png)"].join("\n")
    );

    expect(rendered).toBe(
      'See <a href="https://eidon.example.com/runs/1?a=1&amp;b=2">the run</a>.<br>a chart'
    );
  });

  it("keeps table pipes and bolds the header row, dropping the divider row", () => {
    const table = ["| Name | Status |", "| --- | --- |", "| site | **up** |"].join("\n");

    expect(html(table)).toBe("<b>| Name | Status |</b><br>| site | <b>up</b> |");
    expect(renderNotifyMessage(table, "text")).toBe("| Name | Status |\n| site | up |");
  });

  it("strips horizontal rules and collapses blank line runs", () => {
    const rendered = html(["one", "", "", "---", "", "two", "", ""].join("\n"));

    expect(rendered).toBe("one<br><br>two");
  });

  it("escapes raw HTML and unsafe link targets", () => {
    const rendered = html(
      ['<script>alert(1)</script>', "[click](javascript:alert(1))", "a < b & c > d"].join("\n")
    );

    expect(rendered).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;<br>click<br>a &lt; b &amp; c &gt; d"
    );
  });

  it("leaves inline code, strikethrough, and autolinks readable", () => {
    const rendered = html(["Run `npm test` — ~~flaky~~ now.", "<https://eidon.example.com>"].join("\n"));

    expect(rendered).toBe(
      'Run npm test — flaky now.<br><a href="https://eidon.example.com">https://eidon.example.com</a>'
    );
  });

  it("returns plain content unchanged when there is no markdown", () => {
    expect(html("Eidon: \"Daily digest\" completed")).toBe('Eidon: "Daily digest" completed');
  });

  it("truncates at the last line break that fits and keeps tags balanced", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `**line** ${index}`);
    const rendered = html(lines.join("\n"), 60);

    expect(rendered.length).toBeLessThanOrEqual(60);
    expect(rendered.endsWith("…")).toBe(true);
    expect(rendered).toBe("<b>line</b> 0<br><b>line</b> 1<br><b>line</b> 2…");
  });

  it("truncates a single oversized line as plain text", () => {
    const rendered = html(`**${"a".repeat(2000)}**`, 50);

    expect(rendered).toBe(`${"a".repeat(49)}…`);
  });

  it("returns nothing when the limit cannot fit the ellipsis", () => {
    expect(html("hello", 1)).toBe("");
  });
});
