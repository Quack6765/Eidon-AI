/**
 * Few-shot Markdown formatting rules appended to every assistant system prompt.
 * Goal: reduce upstream malformations so the AST-normalization pipeline carries
 * less load. Placed at END of the prompt to leverage recency bias.
 */
export const MARKDOWN_FORMATTING_RULES = `## Formatting Rules

Your response is rendered by a strict Markdown parser. Malformed Markdown renders incorrectly. Follow these rules:

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
The opening and closing \`\`\` fences must each be on their own line.

WRONG: some code\`\`\`Start other paragraph

RIGHT:
\`\`\`
some code
\`\`\`

Start other paragraph

### Ordered lists
Number sequentially from 1. Do not intersperse prose between items that belong to the same list.
`;
