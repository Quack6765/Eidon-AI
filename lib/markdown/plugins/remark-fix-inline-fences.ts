import type { Plugin } from "unified";
import type { Root, RootContent, Code, Paragraph, Text, InlineCode } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const FENCE_GLUED_AFTER = /^([\s\S]*?)```([A-Za-z0-9_+-]*)?\s*\n([\s\S]*?)\n```([^\n][\s\S]*)$/;
const INTERNAL_CLOSING_FENCE = /^([\s\S]*?)```([\s\S]*)$/;
const LANG_PROMPT = /^([a-z]{1,15})([$>])\s*([\s\S]*)$/i;
const KNOWN_LANGS = new Set([
  "bash", "sh", "zsh", "fish", "ps", "powershell", "cmd",
  "python", "py", "ruby", "rb", "perl", "lua", "php",
  "js", "javascript", "ts", "typescript", "jsx", "tsx",
  "json", "yaml", "yml", "toml", "xml", "html", "css", "scss", "sass",
  "sql", "graphql", "rust", "go", "java", "kotlin", "swift", "scala",
  "c", "cpp", "cxx", "cs", "csharp", "fsharp", "objective", "dart",
  "r", "matlab", "julia", "haskell", "ocaml", "elixir", "erlang",
  "clojure", "elm", "nim", "crystal", "vim", "tex", "latex",
  "diff", "dockerfile", "makefile", "ini", "conf", "log", "md", "markdown",
]);

function parseFragment(md: string): RootContent[] {
  if (!md.trim()) return [];
  const tree = unified().use(remarkParse).use(remarkGfm).parse(md) as Root;
  return tree.children;
}

const remarkFixInlineFences: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;

      const firstChild = node.children[0];

      if (
        firstChild &&
        firstChild.type === "inlineCode" &&
        node.children.length === 1
      ) {
        const ic = firstChild as InlineCode;
        const langMatch = ic.value.match(LANG_PROMPT);
        if (langMatch && KNOWN_LANGS.has(langMatch[1].toLowerCase())) {
          const lang = langMatch[1].toLowerCase();
          const body = `${langMatch[2]} ${langMatch[3]}`.trim();
          const codeNode: Code = { type: "code", lang, value: body };
          parent.children.splice(index, 1, codeNode);
          return [SKIP, index + 1];
        }
      }

      if (!firstChild || firstChild.type !== "text") return;
      const raw = firstChild.value;

      const match = raw.match(FENCE_GLUED_AFTER);
      if (!match) return;
      const [, before, lang, body, tail] = match;
      const replacements: (Paragraph | Code)[] = [];
      if (before.trim()) {
        replacements.push({
          type: "paragraph",
          children: [{ type: "text", value: before.trim() } as Text],
        });
      }
      replacements.push({
        type: "code",
        lang: lang || null,
        value: body,
      });
      if (tail.trim()) {
        replacements.push({
          type: "paragraph",
          children: [{ type: "text", value: tail.trim() } as Text],
        });
      }
      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index + replacements.length];
    });

    visit(tree, "code", (node: Code, index, parent) => {
      if (index === undefined || !parent) return;
      if (node.lang === "mermaid") return;
      const m = node.value.match(INTERNAL_CLOSING_FENCE);
      if (!m) return;
      const [, body, tail] = m;
      if (!tail.trim()) return;
      node.value = body.replace(/\s+$/, "");
      const tailNodes = parseFragment(tail);
      if (tailNodes.length === 0) return;
      parent.children.splice(index + 1, 0, ...tailNodes);
    });
  };
};

export default remarkFixInlineFences;
