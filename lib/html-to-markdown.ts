import { isProbablyReaderable, Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const REMOVED_TAGS = new Set(["script", "style", "noscript", "template", "iframe", "svg", "canvas", "form", "button", "nav", "header", "footer", "aside"]);

function resolveUrl(value: string | null, baseUrl: string) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function createConverter(baseUrl: string) {
  const converter = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*"
  });
  converter.use(gfm);
  converter.remove((node) => REMOVED_TAGS.has(node.nodeName.toLowerCase()));
  converter.addRule("absoluteLink", {
    filter: (node) => node.nodeName === "A" && Boolean(node.getAttribute("href")),
    replacement: (content, node) => {
      const href = resolveUrl((node as HTMLElement).getAttribute("href"), baseUrl);
      const text = content.trim();
      return text ? `[${text}](${href})` : "";
    }
  });
  converter.addRule("imageAltText", {
    filter: "img",
    replacement: (_content, node) => {
      const alt = (node as HTMLElement).getAttribute("alt")?.trim();
      return alt ? `[Image: ${alt}]` : "";
    }
  });
  return converter;
}

export function htmlToMarkdown(html: string, baseUrl: string): { title: string; markdown: string } {
  if (!html.trim()) return { title: "", markdown: "" };

  const { document } = parseHTML(html);
  const documentTitle = document.querySelector("title")?.textContent?.trim() ?? "";
  const readable = isProbablyReaderable(document as unknown as Document, { minContentLength: 140, minScore: 20 })
    ? new Readability(document as unknown as Document).parse()
    : null;
  const content = readable?.content || document.body?.innerHTML || document.documentElement?.innerHTML || "";
  const markdown = createConverter(baseUrl)
    .turndown(content)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title: readable?.title?.trim() || documentTitle, markdown };
}
