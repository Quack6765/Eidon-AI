import type { Plugin } from "unified";
import type { Root, RootContent, Code, Paragraph, Text, InlineCode, Heading } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { flattenInline } from "../ast-helpers";

const FENCE_GLUED_AFTER = /^([\s\S]*?)```([A-Za-z0-9_+-]*)?\s*\n([\s\S]*?)\n```([^\n][\s\S]*)$/;
const INTERNAL_CLOSING_FENCE = /^([\s\S]*?)```([\s\S]*)$/;
const LANG_PROMPT = /^([a-z]{1,15})([$>#])\s*([\s\S]*)$/i;
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
  "mermaid", "plantuml", "dot", "graphviz",
]);

const SHELL_LANGS = new Set(["bash", "sh", "zsh", "fish", "shell"]);
const SHELL_ENV_VAR = /(?<=[a-z0-9"')\]])(?=[A-Z][A-Z_0-9]{2,}=["'])/g;
const SHELL_ECHO = /(?<=[a-zA-Z0-9"')\]])(?=echo\s+["'])/g;
const SHELL_SET_FLAGS = /(?<=[a-zA-Z])(?=set\s+-[a-zA-Z]+\s)/g;
const SHELL_EXPORT = /(?<=[a-z0-9"')\]])(?=export\s+[A-Z][A-Z_0-9]*=)/g;

function parseFragment(md: string): RootContent[] {
  if (!md.trim()) return [];
  const tree = unified().use(remarkParse).use(remarkGfm).parse(md) as Root;
  return tree.children;
}

const HEADING_TRAILING_FENCE = /^([\s\S]*?)```([A-Za-z0-9_+-]+)\s*$/;
const PARAGRAPH_OPENING_FENCE = /^([\s\S]*?)```([A-Za-z0-9_+-]+)\s*\n([\s\S]+)$/;

const remarkFixInlineFences: Plugin<[], Root> = () => {
  return (tree) => {
    const runPass = () => {
    visit(tree, "heading", (node: Heading, index, parent) => {
      if (index === undefined || !parent) return;
      const lastChild = node.children[node.children.length - 1];
      if (!lastChild || lastChild.type !== "text") return;
      const match = lastChild.value.match(HEADING_TRAILING_FENCE);
      if (!match) return;
      const [, beforeText, lang] = match;

      const nextIdx = index + 1;
      const next = parent.children[nextIdx];
      if (!next || next.type !== "paragraph") return;

      const bodyParts: string[] = [];
      let removeCount = 0;
      let trailingText = "";
      for (let i = nextIdx; i < parent.children.length; i++) {
        const sib = parent.children[i];
        if (sib.type === "paragraph") {
          const txt = flattenInline(sib.children);
          const closeIdx = txt.indexOf("```");
          if (closeIdx >= 0) {
            const before = txt.slice(0, closeIdx).replace(/\s+$/, "");
            if (before) bodyParts.push(before);
            trailingText = txt.slice(closeIdx + 3).replace(/^\s+/, "");
            removeCount = i - nextIdx + 1;
            break;
          }
          bodyParts.push(txt);
        } else if (sib.type === "code") {
          if (!sib.value || sib.value.trim() === "") {
            removeCount = i - nextIdx + 1;
            break;
          }
          const closeIdx = sib.value.indexOf("```");
          if (closeIdx >= 0) {
            const before = sib.value.slice(0, closeIdx).replace(/\s+$/, "");
            if (before) bodyParts.push(before);
            trailingText = sib.value.slice(closeIdx + 3).replace(/^\s+/, "");
            removeCount = i - nextIdx + 1;
            break;
          }
          bodyParts.push(sib.value);
        } else {
          break;
        }
      }

      if (removeCount === 0) {
        const codeBody = flattenInline(next.children).replace(/\s*`{3,}\s*$/, "");
        if (!codeBody) return;
        bodyParts.length = 0;
        bodyParts.push(codeBody);
        removeCount = 1;
      }

      const codeBody = bodyParts.join("\n").replace(/\s+$/, "");
      if (!codeBody) return;

      const trimmedBefore = beforeText.trim();
      if (trimmedBefore) {
        (lastChild as Text).value = trimmedBefore;
      } else if (node.children.length > 1) {
        node.children.pop();
      } else {
        return;
      }

      const codeNode: Code = { type: "code", lang, value: codeBody };
      const replacements: RootContent[] = [codeNode];
      if (trailingText.trim()) {
        const trailNodes = parseFragment(trailingText);
        replacements.push(...trailNodes);
      }
      parent.children.splice(nextIdx, removeCount, ...replacements);
      return [SKIP, nextIdx + replacements.length];
    });

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
      if (match) {
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
      }

      const openOnlyMatch = raw.match(PARAGRAPH_OPENING_FENCE);
      if (openOnlyMatch && node.children.length === 1) {
        const orphan = parent.children[index + 1];
        if (
          orphan &&
          orphan.type === "code" &&
          (!orphan.value || orphan.value.trim() === "")
        ) {
          const [, before, lang, body] = openOnlyMatch;
          const replacements: (Paragraph | Code)[] = [];
          if (before.trim()) {
            replacements.push({
              type: "paragraph",
              children: [{ type: "text", value: before.trim() } as Text],
            });
          }
          replacements.push({
            type: "code",
            lang,
            value: body.replace(/\s+$/, ""),
          });
          parent.children.splice(index, 2, ...replacements);
          return [SKIP, index + replacements.length];
        }
      }

      if (node.children.length === 1) {
        const orphan = parent.children[index + 1];
        if (
          orphan &&
          orphan.type === "code" &&
          (!orphan.value || orphan.value.trim() === "")
        ) {
          const langCandidates = [...KNOWN_LANGS].sort((a, b) => b.length - a.length);
          for (const candidate of langCandidates) {
            if (
              raw.length > candidate.length &&
              raw.toLowerCase().startsWith(candidate) &&
              /^[a-zA-Z]/.test(raw.slice(candidate.length))
            ) {
              const body = raw.slice(candidate.length).replace(/^\s+/, "");
              const codeNode: Code = {
                type: "code",
                lang: candidate,
                value: body,
              };
              parent.children.splice(index, 2, codeNode);
              return [SKIP, index + 1];
            }
          }
        }
      }
      return;
    });

    visit(tree, "code", (node: Code, index, parent) => {
      if (index === undefined || !parent) return;

      if (node.lang) {
        let detectedLang: string | null = null;
        let trailing = "";

        const langSplit = node.lang.match(/^([a-zA-Z][a-zA-Z0-9_+-]{0,15})([^a-zA-Z0-9_+-].*)$/);
        if (langSplit && KNOWN_LANGS.has(langSplit[1].toLowerCase())) {
          detectedLang = langSplit[1].toLowerCase();
          trailing = langSplit[2];
        } else if (
          !KNOWN_LANGS.has(node.lang.toLowerCase()) &&
          node.lang === node.lang.toLowerCase()
        ) {
          const lowercase = node.lang.toLowerCase();
          const candidates = [...KNOWN_LANGS].sort((a, b) => b.length - a.length);
          for (const candidate of candidates) {
            if (
              lowercase.startsWith(candidate) &&
              lowercase.length > candidate.length &&
              /^[a-zA-Z]/.test(lowercase.slice(candidate.length))
            ) {
              detectedLang = candidate;
              trailing = node.lang.slice(candidate.length);
              break;
            }
          }
        }

        if (detectedLang !== null) {
          const metaText = node.meta ? (trailing ? " " + node.meta : node.meta) : "";
          const prepended = trailing + metaText;
          node.lang = detectedLang;
          node.meta = null;
          node.value = node.value ? `${prepended}\n${node.value}` : prepended;
        }
      }

      if (node.lang === "mermaid") {
        const firstLine = node.value.split("\n", 1)[0].trim();
        if (firstLine.startsWith("sequenceDiagram")) {
          node.value = node.value
            .replace(/^(\s*sequenceDiagram)[ \t]+(?=\S)/, "$1\n    ")
            .replace(/(?<=\S)[ \t]+(?=(?:participant|actor|box)\s)/g, "\n    ")
            .replace(
              /(?<=\S)[ \t]+(?=(?:autonumber|activate|deactivate|destroy|create|title|link|links|properties|details|rect|opt|loop|par|critical|break)\s)/g,
              "\n    "
            )
            .replace(/(?<=\S)[ \t]+(?=note(?:\s+(?:left|right|over))?\s)/g, "\n    ")
            .replace(
              /(?<=\S)[ \t]+(?=\w+[ \t]*(?:--?>>?|--?[x)])[ \t]*\w+[ \t]*:)/g,
              "\n    "
            )
            .replace(/(?<=\S)[ \t]+(?=alt[ \t]+[A-Z])/g, "\n    ")
            .replace(/(?<=\S)[ \t]+(?=else(?:[ \t]+[A-Z]|[ \t]*$|\s*\n))/g, "\n    ")
            .replace(/(?<=\S)[ \t]+(?=end[ \t]*(?:$|\n))/gm, "\n")
            .replace(/(\w+[ \t]*(?:--?>>?|--?[x)])[ \t]*\w+):(?=\S)/g, "$1: ");
        } else {
          node.value = node.value
            .replace(/\b(TD|LR|BT|RL|TB)\b\s+(?=[A-Za-z]\w*\s*(?:\[|\(|\{))/g, "$1\n")
            .replace(/(?<=\]|\)|\})\s+(?=[A-Za-z]\w*\s*(?:\[|\(|\{|-{1,2}>|=+>|-\.->|--))/g, "\n")
            .replace(/(?<=\w)[ \t]{2,}(?=[A-Za-z]\w*\s*(?:-{1,2}>|=+>|-\.->|--))/g, "\n")
            .replace(/(?<=\S)[ \t]+(?=(style|class|classDef|click|subgraph|end)\s)/g, "\n");
        }
      }

      if (node.lang && SHELL_LANGS.has(node.lang.toLowerCase())) {
        node.value = node.value
          .replace(SHELL_ENV_VAR, "\n")
          .replace(SHELL_ECHO, "\n")
          .replace(SHELL_SET_FLAGS, "\n")
          .replace(SHELL_EXPORT, "\n");
      }

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
    runPass();
    runPass();
  };
};

export default remarkFixInlineFences;
