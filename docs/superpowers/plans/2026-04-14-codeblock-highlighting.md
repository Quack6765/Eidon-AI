# Assistant Code Block Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add syntax-highlighted fenced code blocks with per-block copy controls in assistant answer bubbles, while leaving thinking bubbles unchanged.

**Architecture:** Keep `ReactMarkdown` as the answer renderer in `components/message-bubble.tsx`, but route fenced multi-line code blocks through a dedicated `AssistantCodeBlock` component. Put language alias normalization, auto-detection, and safe highlighting into a focused helper so the renderer stays readable and unsupported languages degrade cleanly to plain code. Style the new block chrome in `app/globals.css` and keep the existing message-level copy button untouched.

**Tech Stack:** React 19, Next.js 15, `react-markdown`, `remark-gfm`, `remark-breaks`, Vitest, Testing Library, `highlight.js`

---

## File Structure

**Create:**

- `lib/code-highlighting.ts`
  Responsibility: normalize fence language aliases, auto-detect untagged snippets, and safely produce highlighted HTML or plain-text fallback metadata.
- `components/assistant-code-block.tsx`
  Responsibility: render one fenced assistant code block with compact header chrome, local copy state, and highlighted markup.
- `tests/unit/code-highlighting.test.ts`
  Responsibility: lock helper behavior for alias normalization, auto-detection, and unsupported-language fallback.

**Modify:**

- `components/message-bubble.tsx:3-25, 776-792, 983-1015`
  Responsibility: keep existing message copy behavior, add custom markdown `code` renderer for assistant answer bubbles only, and leave thinking markdown unchanged.
- `tests/unit/message-bubble.test.ts:3-8, 745-827`
  Responsibility: add rendering and copy assertions for the new fenced-code path without regressing existing markdown behavior.
- `app/globals.css:147-364`
  Responsibility: add compact code-block chrome, hover/focus reveal rules, and scoped syntax token styling for the new assistant code block surface.
- `package.json:18-44`
  Responsibility: add the highlighting dependency used by the helper.

## Task 1: Add A Testable Highlighting Helper

**Files:**

- Create: `tests/unit/code-highlighting.test.ts`
- Create: `lib/code-highlighting.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing helper tests**

```ts
// tests/unit/code-highlighting.test.ts
import { describe, expect, it } from "vitest";

import {
  detectCodeLanguage,
  normalizeCodeFenceLanguage,
  renderHighlightedCode
} from "@/lib/code-highlighting";

describe("code highlighting helper", () => {
  it("normalizes common fence aliases", () => {
    expect(normalizeCodeFenceLanguage("py")).toBe("python");
    expect(normalizeCodeFenceLanguage("ts")).toBe("typescript");
    expect(normalizeCodeFenceLanguage("yml")).toBe("yaml");
    expect(normalizeCodeFenceLanguage("zsh")).toBe("bash");
  });

  it("auto-detects an untagged SQL snippet", () => {
    const detected = detectCodeLanguage("SELECT id, email FROM users WHERE active = 1;");

    expect(detected).toBe("sql");
  });

  it("falls back to plain escaped code for unsupported declared languages", () => {
    const result = renderHighlightedCode("customlang", "hello <world>");

    expect(result.language).toBeNull();
    expect(result.highlightedHtml).toContain("&lt;world&gt;");
    expect(result.usedFallback).toBe(true);
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `npx vitest run tests/unit/code-highlighting.test.ts`

Expected: FAIL with a module resolution error for `@/lib/code-highlighting` because the helper does not exist yet.

- [ ] **Step 3: Add the highlighting dependency and implement the helper**

```json
// package.json
{
  "dependencies": {
    "highlight.js": "^11.11.1"
  }
}
```

```ts
// lib/code-highlighting.ts
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerAliases(["js"], { languageName: "javascript" });
hljs.registerAliases(["ts"], { languageName: "typescript" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["zsh", "sh", "shell"], { languageName: "bash" });
hljs.registerAliases(["html"], { languageName: "xml" });
hljs.registerAliases(["tsx", "jsx"], { languageName: "javascript" });

const LANGUAGE_ALIASES: Record<string, string> = {
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  shell: "bash",
  sh: "bash",
  ts: "typescript",
  tsx: "javascript",
  yml: "yaml",
  zsh: "bash"
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeCodeFenceLanguage(language: string | null | undefined) {
  const normalized = language?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function detectCodeLanguage(code: string) {
  const detected = hljs.highlightAuto(code);
  return detected.language ?? null;
}

export function renderHighlightedCode(language: string | null | undefined, code: string) {
  const normalizedLanguage = normalizeCodeFenceLanguage(language);

  if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
    return {
      displayLanguage: normalizedLanguage,
      highlightedHtml: hljs.highlight(code, { language: normalizedLanguage, ignoreIllegals: true }).value,
      language: normalizedLanguage,
      usedFallback: false
    };
  }

  if (!normalizedLanguage) {
    const detectedLanguage = detectCodeLanguage(code);

    if (detectedLanguage) {
      return {
        displayLanguage: detectedLanguage,
        highlightedHtml: hljs.highlight(code, { language: detectedLanguage, ignoreIllegals: true }).value,
        language: detectedLanguage,
        usedFallback: false
      };
    }
  }

  return {
    displayLanguage: normalizedLanguage,
    highlightedHtml: escapeHtml(code),
    language: null,
    usedFallback: true
  };
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `npx vitest run tests/unit/code-highlighting.test.ts`

Expected: PASS with 3 passing tests in `tests/unit/code-highlighting.test.ts`.

- [ ] **Step 5: Commit the helper slice**

```bash
git add package.json lib/code-highlighting.ts tests/unit/code-highlighting.test.ts
git commit -m "feat: add assistant code highlighting helper"
```

## Task 2: Route Assistant Fenced Blocks Through A Dedicated Component

**Files:**

- Create: `components/assistant-code-block.tsx`
- Modify: `components/message-bubble.tsx`
- Modify: `tests/unit/message-bubble.test.ts`

- [ ] **Step 1: Write the failing message-bubble tests for declared-language rendering and block copy**

```ts
// tests/unit/message-bubble.test.ts
it("renders fenced assistant code blocks with a language label and block-local copy action", () => {
  render(
    React.createElement(MessageBubble, {
      message: {
        ...createAssistantMessage(),
        content: ["```python", "print('hello')", "```"].join("\n")
      }
    })
  );

  expect(screen.getByTestId("assistant-code-block")).toBeInTheDocument();
  expect(screen.getByText("python")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy code block" })).toBeInTheDocument();
});

it("copies only the fenced code payload from the block action", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true
  });
  vi.stubGlobal("ClipboardItem", undefined);

  render(
    React.createElement(MessageBubble, {
      message: {
        ...createAssistantMessage(),
        content: [
          "Before",
          "",
          "```python",
          "print('hello')",
          "```",
          "",
          "After"
        ].join("\n")
      }
    })
  );

  fireEvent.click(screen.getByRole("button", { name: "Copy code block" }));

  await waitFor(() => {
    expect(writeText).toHaveBeenCalledWith("print('hello')");
  });
});
```

- [ ] **Step 2: Run the message bubble test to verify it fails**

Run: `npx vitest run tests/unit/message-bubble.test.ts -t "renders fenced assistant code blocks with a language label and block-local copy action|copies only the fenced code payload from the block action"`

Expected: FAIL because the assistant markdown path still renders fenced code as a generic `pre code` block and there is no `Copy code block` action.

- [ ] **Step 3: Create the dedicated code block component and wire it into assistant markdown only**

```tsx
// components/assistant-code-block.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";

import { renderHighlightedCode } from "@/lib/code-highlighting";

const COPY_RESET_DELAY_MS = 1600;

export function AssistantCodeBlock({
  code,
  language
}: {
  code: string;
  language?: string | null;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const resetHandle = useRef<number | null>(null);
  const result = renderHighlightedCode(language, code);

  useEffect(() => {
    return () => {
      if (resetHandle.current) {
        window.clearTimeout(resetHandle.current);
      }
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }

    if (resetHandle.current) {
      window.clearTimeout(resetHandle.current);
    }

    resetHandle.current = window.setTimeout(() => {
      setCopyState("idle");
      resetHandle.current = null;
    }, COPY_RESET_DELAY_MS);
  }

  return (
    <div className="assistant-code-block group" data-testid="assistant-code-block">
      <div className="assistant-code-block__header">
        {result.displayLanguage ? (
          <span className="assistant-code-block__language">{result.displayLanguage}</span>
        ) : <span />}
        <button
          type="button"
          aria-label={copyState === "copied" ? "Copied code block" : "Copy code block"}
          className="assistant-code-block__copy"
          onClick={() => void handleCopy()}
        >
          {copyState === "copied" ? <Check className="h-3.5 w-3.5" /> : copyState === "error" ? <X className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="assistant-code-block__body">
        <code
          className={`hljs${result.language ? ` language-${result.language}` : ""}`}
          dangerouslySetInnerHTML={{ __html: result.highlightedHtml }}
        />
      </pre>
    </div>
  );
}
```

```tsx
// components/message-bubble.tsx
import { AssistantCodeBlock } from "@/components/assistant-code-block";

function renderAssistantMarkdown(content: string) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_PLUGINS}
      components={{
        code({ className, children, ...props }) {
          const value = String(children).replace(/\n$/, "");
          const language = className?.match(/language-([\w-]+)/)?.[1] ?? null;
          const isBlock = Boolean(className) || value.includes("\n");

          if (!isBlock) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }

          return <AssistantCodeBlock code={value} language={language} />;
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

```tsx
// components/message-bubble.tsx, inside assistant answer bubble
<div className="markdown-body">
  {renderAssistantMarkdown(item.content)}
</div>
```

- [ ] **Step 4: Run the message bubble tests to verify they pass**

Run: `npx vitest run tests/unit/message-bubble.test.ts -t "renders fenced assistant code blocks with a language label and block-local copy action|copies only the fenced code payload from the block action"`

Expected: PASS with both new tests green.

- [ ] **Step 5: Commit the renderer slice**

```bash
git add components/assistant-code-block.tsx components/message-bubble.tsx tests/unit/message-bubble.test.ts
git commit -m "feat: add assistant code block renderer"
```

## Task 3: Add Fallback Coverage, Scoped Styling, And Regression Checks

**Files:**

- Modify: `tests/unit/message-bubble.test.ts`
- Modify: `app/globals.css`
- Modify: `components/message-bubble.tsx`

- [ ] **Step 1: Add the failing tests for untagged detection, unsupported fallback, and thinking isolation**

```ts
// tests/unit/message-bubble.test.ts
it("auto-detects untagged assistant code blocks without changing the thinking bubble", () => {
  const { container } = render(
    React.createElement(MessageBubble, {
      message: {
        ...createAssistantMessage(),
        content: ["```", "SELECT id,", "  email FROM users;", "```"].join("\n"),
        thinkingContent: ["```", "SELECT thought FROM steps;", "```"].join("\n")
      }
    })
  );

  fireEvent.click(screen.getByRole("button", { name: /Thought/i }));

  expect(screen.getByTestId("assistant-code-block")).toBeInTheDocument();
  expect(screen.getByText("sql")).toBeInTheDocument();
  expect(container.querySelector(".thinking-markdown-body .assistant-code-block")).toBeNull();
});

it("renders unsupported fenced languages as plain code without losing the block chrome", () => {
  render(
    React.createElement(MessageBubble, {
      message: {
        ...createAssistantMessage(),
        content: ["```mermadeidon", "opaque => still visible", "```"].join("\n")
      }
    })
  );

  expect(screen.getByTestId("assistant-code-block")).toBeInTheDocument();
  expect(screen.getByText("opaque => still visible")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test set to verify it fails**

Run: `npx vitest run tests/unit/message-bubble.test.ts -t "auto-detects untagged assistant code blocks without changing the thinking bubble|renders unsupported fenced languages as plain code without losing the block chrome"`

Expected: FAIL because the current implementation has no scoped block chrome classes or reliable untagged fallback assertions yet.

- [ ] **Step 3: Add scoped styles and finish fallback polish**

```css
/* app/globals.css */
.assistant-code-block {
  margin: 0.9rem 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.9rem;
  background: rgba(9, 11, 18, 0.92);
}

.assistant-code-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
}

.assistant-code-block__language {
  font-size: 11px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.56);
  text-transform: lowercase;
}

.assistant-code-block__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.75rem;
  width: 1.75rem;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.02);
  color: rgba(255, 255, 255, 0.4);
  transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease, opacity 120ms ease;
}

@media (hover: hover) and (pointer: fine) {
  .assistant-code-block__copy {
    opacity: 0;
    pointer-events: none;
  }

  .assistant-code-block:hover .assistant-code-block__copy,
  .assistant-code-block:focus-within .assistant-code-block__copy {
    opacity: 1;
    pointer-events: auto;
  }
}

.assistant-code-block__body {
  margin: 0;
  overflow-x: auto;
  padding: 0.85rem 1rem;
  background: transparent;
}

.assistant-code-block__body .hljs {
  display: block;
  overflow-x: auto;
  background: transparent;
  color: #e6edf3;
}

.assistant-code-block__body .hljs-keyword,
.assistant-code-block__body .hljs-selector-tag,
.assistant-code-block__body .hljs-built_in {
  color: #ff7b72;
}

.assistant-code-block__body .hljs-string,
.assistant-code-block__body .hljs-attr,
.assistant-code-block__body .hljs-template-variable {
  color: #a5d6ff;
}

.assistant-code-block__body .hljs-title,
.assistant-code-block__body .hljs-function,
.assistant-code-block__body .hljs-section {
  color: #d2a8ff;
}

.assistant-code-block__body .hljs-number,
.assistant-code-block__body .hljs-literal,
.assistant-code-block__body .hljs-variable {
  color: #79c0ff;
}

.assistant-code-block__body .hljs-comment,
.assistant-code-block__body .hljs-quote {
  color: #8b949e;
}
```

```tsx
// components/message-bubble.tsx, keep thinking untouched
{thinkingOpen && thinkingContent ? (
  <div className="markdown-body thinking-markdown-body mt-1.5">
    <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{thinkingContent}</ReactMarkdown>
  </div>
) : null}
```

- [ ] **Step 4: Run the targeted test files to verify they pass**

Run: `npx vitest run tests/unit/code-highlighting.test.ts tests/unit/message-bubble.test.ts`

Expected: PASS with the new helper and message-bubble assertions green.

- [ ] **Step 5: Commit the styled fallback slice**

```bash
git add app/globals.css components/message-bubble.tsx tests/unit/message-bubble.test.ts
git commit -m "feat: style assistant code blocks"
```

## Task 4: Run Full Verification And Browser Validation

**Files:**

- Reuse: `.dev-server` if present and healthy
- Validate: browser screenshots saved to the temp directory created by `agent-browser`

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Run the full test suite with coverage**

Run: `npm test`

Expected: exit code 0 and the repository coverage thresholds met.

- [ ] **Step 4: Start or reuse the dev server for UI validation**

Run:

```bash
if [ -f .dev-server ]; then
  url=$(head -n 1 .dev-server)
  curl -fsS "$url" >/dev/null || rm .dev-server
fi

if [ ! -f .dev-server ]; then
  npm run dev >/tmp/eidon-dev.log 2>&1 &
  while [ ! -f .dev-server ]; do sleep 1; done
fi

head -n 2 .dev-server
```

Expected: `.dev-server` contains a localhost URL and PID.

- [ ] **Step 5: Validate the assistant code block UI in the browser**

Run the required browser flow with `agent-browser`:

```bash
agent-browser open "$(head -n 1 .dev-server)" &&
agent-browser wait --load networkidle &&
agent-browser snapshot -i
```

Then:

- navigate to a conversation that contains an assistant fenced code block, or create one using the app flow
- confirm the assistant answer bubble shows syntax-highlighted code
- confirm the copy button appears on hover/focus for desktop-sized viewport
- confirm the thinking bubble still uses the old markdown rendering
- take a screenshot with `agent-browser screenshot --full`

- [ ] **Step 6: Commit any verification-driven fixups**

```bash
git add package.json app/globals.css components/message-bubble.tsx components/assistant-code-block.tsx lib/code-highlighting.ts tests/unit/code-highlighting.test.ts tests/unit/message-bubble.test.ts
git commit -m "fix: polish assistant code block highlighting"
```

Skip this commit if verification finds no additional issues.
