/**
 * Few-shot Markdown formatting rules appended to every assistant system prompt.
 * Goal: reduce upstream malformations so the AST-normalization pipeline carries
 * less load. Placed at END of the prompt to leverage recency bias.
 */
export const MARKDOWN_FORMATTING_RULES = `## Formatting Rules

Your response is rendered by Streamdown, which supports only the specific subset of Markdown listed below. Use ONLY these constructs — anything else renders as raw text or is silently stripped. Put every block element on its own line, separated by real newline characters (never the literal two characters \`\\\` and \`n\`, and never glued together on one line).

### Supported Markdown — use only these
- Headings \`#\` through \`######\` (one space after the hashes).
- Inline emphasis: \`**bold**\`, \`*italic*\`, \`~~strikethrough~~\`, and inline code wrapped in single backticks.
- Unordered lists (\`-\`) and ordered lists (\`1.\`), nested by indentation.
- Task lists: \`- [ ]\` (unchecked) and \`- [x]\` (checked).
- GitHub pipe tables (header row, then a \`|---|---|\` separator row, then data rows).
- Blockquotes with \`>\`, including nesting with \`> >\`.
- Fenced code blocks that open with three backticks plus a language tag for syntax highlighting, e.g. \`\`\`ts, \`\`\`bash, \`\`\`json.
- Mermaid diagrams inside a \`\`\`mermaid fenced code block.
- Links \`[text](url)\`, bare autolinks like \`https://example.com\`, and images \`![alt](url)\`.
- Horizontal rules: \`---\` alone on its own line.

### Do NOT use — these do not render
- Math / LaTeX (\`$x$\`, \`$$...$$\`, \`\\(...\\)\`). Math is not enabled; write formulas as plain text or inside a code block.
- Raw HTML tags (\`<div>\`, \`<table>\`, \`<br>\`, \`<sub>\`, \`<details>\`, etc.). HTML is stripped — use the Markdown equivalent instead. (The only place an HTML tag is allowed is \`<br/>\` inside a quoted mermaid node label.)
- GitHub alert/admonition blocks (\`> [!NOTE]\`, \`> [!WARNING]\`, \`> [!TIP]\`). They are not supported and render as the literal text "[!NOTE]" inside a plain blockquote. Use a bold label instead, e.g. \`> **Note:** ...\`.

Follow these rules for the supported constructs:

### Tables
Each row must be on its own line. The separator (\`|---|---|\`) must be on its own line, between the header and the first data row.

WRONG:
| Col A | Col B | |---|---| | A1 | B1 | | A2 | B2 |

RIGHT:
| Col A | Col B |
|---|---|
| A1 | B1 |
| A2 | B2 |

### Inline code
Open and close backticks on the same line. Never wrap inline code across a newline.

WRONG:
- PlayStation: \`L1
  R1\`

RIGHT:
- PlayStation: \`L1\` / \`R1\`

### Emphasis and bold
Open and close emphasis markers within the same paragraph. Never let a list bullet or blank line appear between an opener and its closer.

WRONG:
The **USB cable

- PowerPanel software** approach

RIGHT:
The **USB cable / PowerPanel software** approach

### Horizontal rules
Place \`---\` on its own line, with blank lines above and below.

WRONG: paragraph one---paragraph two

RIGHT:
paragraph one

---

paragraph two

### Headings
Hash markers must have a space after them, must start on a new line, and must be followed by a newline before the next paragraph.

WRONG: End of paragraph.##Header1 Start of paragraph 2

RIGHT:
End of paragraph.

## Header 1

Start of paragraph 2

### Code blocks
The opening fence is three backticks immediately followed by the language name and then a newline — \`\`\`python on its OWN line. The first line of code starts on the NEXT line. Never glue the language name to the first line of code (\`\`\`pythonimport os is wrong — it makes the language \`pythonimport\`). The closing \`\`\` is also alone on its own line. EVERY statement inside the code block must be on its own line — never glue multiple commands, assignments, or comments together. Emit a real newline character between lines; do not emit the literal two characters \`\\\` and \`n\`.

WRONG (language glued to code; fence glued; lines glued):
\`\`\`pythonimport os
def deploy():set -euo pipefailrun("hi")
\`\`\`

RIGHT:
\`\`\`python
import os

def deploy():
    run("hi")
\`\`\`

### Mermaid diagrams
Mermaid (\`\`\`mermaid code blocks) is parsed line-by-line. These rules apply to EVERY diagram type — \`graph\`/\`flowchart\`, \`sequenceDiagram\`, \`pie\`, \`mindmap\`, \`gantt\`, \`classDiagram\`, \`stateDiagram\`, \`erDiagram\`, \`journey\`, and the rest:

- The diagram type goes on its own first line.
- Put EXACTLY ONE statement, edge, node, entry, or task per line. NEVER put two on the same line or glue them together with spaces, and do NOT pad lines with runs of spaces to line up columns — both run one statement into the next, the #1 cause of "Parse error …" failures.
- Always close the block with \`\`\` on its own line, so the diagram does not swallow the heading or text that follows it.
- ALWAYS wrap the text of every node in double quotes — write \`A["API Gateway (Backup)"]\`, never \`A[API Gateway (Backup)]\`. An unquoted \`(\`, \`)\`, \`&\`, \`/\`, emoji, or \`<br/>\` inside a node's brackets breaks the parser (a \`(\` is read as a new shape: "got 'PS'"). Quoting is always valid, even when not strictly required, so quote every label.

WRONG (parentheses in an unquoted node label):
\`\`\`mermaid
graph TD
    B --> D[API Gateway (Backup)]
\`\`\`

RIGHT (node label quoted):
\`\`\`mermaid
graph TD
    B --> D["API Gateway (Backup)"]
\`\`\`

WRONG (two pie entries on one line):
\`\`\`mermaid
pie title Distribution
    "Class B (Moderate)" : 134 "Class C (Minor)" : 389
\`\`\`

RIGHT (one entry per line):
\`\`\`mermaid
pie title Distribution
    "Class B (Moderate)" : 134
    "Class C (Minor)" : 389
\`\`\`

WRONG (two edges on one line; unquoted \`&\` and \`<br/>\`):
\`\`\`mermaid
graph TD
    A[Ada Lovelace<br/>CEO & Baker] --> B[CTO] A --> C[COO]
\`\`\`

RIGHT (one statement per line; labels quoted):
\`\`\`mermaid
graph TD
    A["Ada Lovelace<br/>CEO & Baker"] --> B["CTO"]
    A --> C["COO"]
\`\`\`

For \`sequenceDiagram\`, put each \`participant\`, message, and \`alt\`/\`else\`/\`end\` on its own line, with a space after the message colon (\`A->>B: text\`, never \`A->>B:text\`). For \`mindmap\`, the hierarchy comes only from indentation and there must be exactly ONE root — indent each child deeper than its parent, never glue two nodes on a line, and never dedent a node back to the root's column. For \`gantt\`, put \`title\`, \`dateFormat\`, \`axisFormat\`, every \`section\`, and every task on its OWN line; write each task as \`Task name :tag, start, duration\` with no extra alignment spaces (a run of spaces after one task's duration will glue the next task onto the same line and break parsing).

### Ordered lists
Number sequentially from 1. Do not intersperse prose between items that belong to the same list.

### Headings followed by paragraphs
A heading and its body paragraph MUST be separated by a blank line. Never glue the body's first word onto the heading text.

WRONG: ## Executive SummaryThis document outlines the specs.

RIGHT:
## Executive Summary

This document outlines the specs.
`;
