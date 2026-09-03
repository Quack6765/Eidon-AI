import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "@/lib/html-to-markdown";

const BASE_URL = "https://example.com/docs/guide/";

function articlePage(body: string, title = "Guide title") {
  const filler = "<p>" + "This paragraph carries enough prose for the readability heuristics to treat it as content. ".repeat(6) + "</p>";
  return `<!doctype html><html><head><title>${title}</title><style>body{color:red}</style></head><body>
    <nav><a href="/home">Home</a><a href="/about">About</a></nav>
    <header><h1>Site header</h1></header>
    <main><article>${body}${filler}${filler}${filler}</article></main>
    <aside>Related links</aside>
    <footer>Copyright</footer>
    <script>window.tracking = true;</script>
  </body></html>`;
}

describe("htmlToMarkdown", () => {
  it("returns empty output for empty input", () => {
    expect(htmlToMarkdown("", BASE_URL)).toEqual({ title: "", markdown: "" });
    expect(htmlToMarkdown("   \n", BASE_URL)).toEqual({ title: "", markdown: "" });
  });

  it("extracts the main article, keeps structure, and drops boilerplate", () => {
    const { title, markdown } = htmlToMarkdown(
      articlePage(`
        <h2>Installation</h2>
        <p>Run the <code>install</code> command, then read the <a href="../reference/cli">CLI reference</a>.</p>
        <ul><li>First step</li><li>Second step</li></ul>
        <pre><code>npm install eidon</code></pre>
        <img src="/diagram.png" alt="Architecture diagram">
        <img src="/spacer.gif">
      `),
      BASE_URL
    );

    expect(title).toBe("Guide title");
    expect(markdown).toContain("## Installation");
    expect(markdown).toContain("`install`");
    expect(markdown).toContain("[CLI reference](https://example.com/docs/reference/cli)");
    expect(markdown).toMatch(/^-\s+First step$/m);
    expect(markdown).toMatch(/^-\s+Second step$/m);
    expect(markdown).toContain("```\nnpm install eidon\n```");
    expect(markdown).toContain("[Image: Architecture diagram]");
    expect(markdown).not.toContain("spacer.gif");
    expect(markdown).not.toContain("window.tracking");
    expect(markdown).not.toContain("color:red");
    expect(markdown).not.toContain("Copyright");
    expect(markdown).not.toContain("Related links");
    expect(markdown).not.toMatch(/\n{3,}/);
  });

  it("converts tables to GFM and drops script links", () => {
    const { markdown } = htmlToMarkdown(
      articlePage(`
        <table><thead><tr><th>Plan</th><th>Price</th></tr></thead>
        <tbody><tr><td>Free</td><td>$0</td></tr><tr><td>Pro</td><td>$20</td></tr></tbody></table>
        <p><a href="javascript:void(0)">Open</a> <a href="">Blank</a></p>
      `),
      BASE_URL
    );

    expect(markdown).toContain("| Plan | Price |");
    expect(markdown).toContain("| Free | $0 |");
    expect(markdown).not.toContain("javascript:");
    expect(markdown).toContain("Open Blank");
  });

  it("falls back to the document body when the page is not readerable", () => {
    const { title, markdown } = htmlToMarkdown(
      `<html><head><title>Tiny</title></head><body><nav><a href="/x">Nav</a></nav><p>Short <strong>note</strong>.</p></body></html>`,
      BASE_URL
    );

    expect(title).toBe("Tiny");
    expect(markdown).toBe("Short **note**.");
  });

  it("handles fragments without head or body wrappers", () => {
    const { title, markdown } = htmlToMarkdown("<p>Loose <em>fragment</em></p>", BASE_URL);

    expect(title).toBe("");
    expect(markdown).toBe("Loose *fragment*");
  });
});
