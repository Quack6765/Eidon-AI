export const MARKDOWN_FORMATTING_RULES = `## Markdown Formatting

Your responses are rendered with GitHub Flavored Markdown (GFM). Write standard, valid GFM. Put every block element — heading, list, table, blockquote, fenced code block, horizontal rule — on its own line, separated from surrounding text by a blank line.

### Supported — use these
- Headings \`#\` through \`######\`, with a space after the hashes.
- Inline \`**bold**\`, \`*italic*\`, \`~~strikethrough~~\`, and \`inline code\` in single backticks.
- Ordered (\`1.\`) and unordered (\`-\`) lists, nested by indentation, plus task lists \`- [ ]\` and \`- [x]\`.
- GitHub pipe tables: a header row, a \`|---|---|\` separator row, then data rows — each row on its own line.
- Blockquotes with \`>\`.
- Fenced code blocks opened with three backticks plus a language tag (e.g. \`\`\`ts) and closed with three backticks on their own line.
- Mermaid diagrams inside a \`\`\`mermaid fenced block.
- Links \`[text](url)\`, bare autolinks, and images \`![alt](url)\`.
- Horizontal rules: \`---\` alone on its own line.

### Not supported — do not use
- Math / LaTeX (\`$x$\`, \`$$...$$\`, \`\\(...\\)\`). It is not rendered; write formulas as plain text or inside a code block.
- Raw HTML tags (\`<div>\`, \`<br>\`, \`<sub>\`, \`<details>\`, …). HTML is stripped; use the Markdown equivalent.
- GitHub alert/admonition blocks (\`> [!NOTE]\`, \`> [!WARNING]\`, \`> [!TIP]\`). They render as literal text; use a bold label instead, e.g. \`> **Note:** ...\`.

### Mermaid diagrams
Mermaid is parsed line by line, so the diagram type goes on the first line and every node, edge, entry, or statement goes on its own line — never glue two onto one line. ALWAYS wrap every node label in double quotes — write \`A["API Gateway (Backup)"]\`, never \`A[API Gateway (Backup)]\` — because an unquoted \`(\`, \`)\`, \`&\`, \`/\`, or \`<br/>\` breaks the parser. Always close the block with \`\`\` on its own line so the diagram does not swallow the text that follows it.
`;
