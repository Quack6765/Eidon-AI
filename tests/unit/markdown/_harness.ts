import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";

/**
 * Run a markdown string through remark-parse + remark-gfm + the plugin under
 * test + remark-stringify. Returns the resulting markdown string, normalized
 * for trailing whitespace.
 */
export function runPlugin(
  input: string,
  plugin: Plugin<[], Root>
): string {
  const out = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(plugin)
    .use(remarkStringify, { bullet: "-", listItemIndent: "one" })
    .processSync(input)
    .toString();
  return out.replace(/[ \t]+$/gm, "").trimEnd();
}
