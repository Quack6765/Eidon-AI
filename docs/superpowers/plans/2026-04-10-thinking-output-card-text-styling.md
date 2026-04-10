# Thinking Output Card Text Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the expanded thinking content render in a smaller, greyer markdown style closer to tool output logs while preserving markdown support and leaving normal assistant message styling unchanged.

**Architecture:** Keep the change isolated to the expanded thinking content path in `MessageBubble` and a dedicated global CSS ruleset for thinking markdown. Protect the behavior with a focused unit test update plus a browser validation pass so the styling change stays scoped to the thinking panel.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind utility classes, global CSS, Vitest, agent-browser

---

## File Structure

- `components/message-bubble.tsx`
  Responsibility: renders the assistant thinking shell and applies the wrapper class around expanded `ReactMarkdown` thinking content.
- `app/globals.css`
  Responsibility: defines the new compact thinking-markdown rules without changing the existing `.markdown-body` styles used by normal assistant messages.
- `tests/unit/message-bubble.test.ts`
  Responsibility: verifies the thinking shell still renders markdown content and that the thinking content uses the dedicated compact wrapper class.

### Task 1: Add the failing test coverage for the thinking markdown wrapper

**Files:**
- Modify: `tests/unit/message-bubble.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test after `it("reveals streamed thinking content after the user expands the panel", ...)` in `tests/unit/message-bubble.test.ts`:

```typescript
  it("renders expanded thinking content with the compact thinking markdown wrapper", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          thinkingContent: [
            "## Reasoning",
            "",
            "- First check",
            "- Second check",
            "",
            "Final detail"
          ].join("\n")
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Thought/i }));

    const thinkingMarkdown = container.querySelector(".thinking-markdown-body");
    const assistantMarkdown = container.querySelector('[data-testid="assistant-message-bubble"] .markdown-body');

    expect(thinkingMarkdown).not.toBeNull();
    expect(thinkingMarkdown?.textContent).toContain("Reasoning");
    expect(thinkingMarkdown?.textContent).toContain("First check");
    expect(thinkingMarkdown?.textContent).toContain("Second check");
    expect(thinkingMarkdown?.textContent).toContain("Final detail");
    expect(assistantMarkdown).toBeNull();
  });
```

Update the existing `it("renders double-escaped assistant and thinking line breaks as markdown paragraphs", ...)` assertions so they no longer expect both blocks to use `.markdown-body`:

```typescript
    const thinkingMarkdown = container.querySelector(".thinking-markdown-body");
    const answerMarkdown = container.querySelector('[data-testid="assistant-message-bubble"] .markdown-body');

    expect(thinkingMarkdown?.textContent).toContain("Thought one");
    expect(thinkingMarkdown?.textContent).toContain("Thought two");
    expect(thinkingMarkdown?.textContent).toContain("Thought three");
    expect(thinkingMarkdown?.textContent).toContain("Thought four");
    expect(thinkingMarkdown?.textContent).not.toContain("\\\\n");
    expect(answerMarkdown?.textContent).toContain("First line");
    expect(answerMarkdown?.textContent).toContain("Second line");
    expect(answerMarkdown?.textContent).toContain("Third paragraph");
    expect(answerMarkdown?.textContent).toContain("Fourth paragraph");
    expect(answerMarkdown?.textContent).not.toContain("\\\\n");
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts -t "renders expanded thinking content with the compact thinking markdown wrapper"
```

Expected: FAIL because `.thinking-markdown-body` does not exist yet.

- [ ] **Step 3: Run the line-break regression test to confirm the old selector assumption breaks**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts -t "renders double-escaped assistant and thinking line breaks as markdown paragraphs"
```

Expected: FAIL because the updated test now expects `.thinking-markdown-body`, which has not been implemented yet.

- [ ] **Step 4: Commit the test-only change**

Run:

```bash
git add tests/unit/message-bubble.test.ts
git commit -m "test: cover compact thinking markdown wrapper"
```

Expected: a commit containing only the new/updated thinking markdown tests.

### Task 2: Implement the scoped thinking markdown styling

**Files:**
- Modify: `components/message-bubble.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Update the thinking content wrapper**

In `components/message-bubble.tsx`, replace the expanded thinking wrapper:

```typescript
                {thinkingOpen && thinkingContent ? (
                  <div className="markdown-body mt-1.5 text-[12.5px] leading-6 text-white/48">
                    <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{thinkingContent}</ReactMarkdown>
                  </div>
                ) : null}
```

with:

```typescript
                {thinkingOpen && thinkingContent ? (
                  <div className="thinking-markdown-body mt-1.5">
                    <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{thinkingContent}</ReactMarkdown>
                  </div>
                ) : null}
```

Do not change:
- the collapsed thinking shell header
- the `ReactMarkdown` usage
- the normal assistant message bubble wrapper class

- [ ] **Step 2: Add the compact thinking markdown styles**

In `app/globals.css`, add this ruleset after the existing `.markdown-body` block family:

```css
.thinking-markdown-body {
  color: rgba(255, 255, 255, 0.48);
  font-size: 12.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.thinking-markdown-body > :first-child {
  margin-top: 0;
}

.thinking-markdown-body > :last-child {
  margin-bottom: 0;
}

.thinking-markdown-body h1,
.thinking-markdown-body h2,
.thinking-markdown-body h3,
.thinking-markdown-body h4 {
  margin: 0.75rem 0 0.35rem;
  color: rgba(255, 255, 255, 0.62);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.thinking-markdown-body h1 {
  font-size: 1rem;
}

.thinking-markdown-body h2 {
  font-size: 0.95rem;
}

.thinking-markdown-body h3 {
  font-size: 0.9rem;
}

.thinking-markdown-body h4 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.5);
}

.thinking-markdown-body p {
  margin: 0.4rem 0;
}

.thinking-markdown-body ul,
.thinking-markdown-body ol {
  margin: 0.55rem 0;
  padding-left: 1.2rem;
}

.thinking-markdown-body li {
  margin: 0.2rem 0;
}

.thinking-markdown-body strong {
  color: rgba(255, 255, 255, 0.65);
}

.thinking-markdown-body code {
  color: rgba(255, 255, 255, 0.58);
}

.thinking-markdown-body a {
  color: rgba(255, 255, 255, 0.64);
}
```

Do not copy the tool-log `pre` block styles into this class, and do not modify `.markdown-body`.

- [ ] **Step 3: Run the targeted tests to verify the implementation**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts -t "renders expanded thinking content with the compact thinking markdown wrapper"
npx vitest run tests/unit/message-bubble.test.ts -t "renders double-escaped assistant and thinking line breaks as markdown paragraphs"
```

Expected: both tests PASS.

- [ ] **Step 4: Run the full message bubble test file**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts
```

Expected: PASS with the new thinking-wrapper assertions and no regressions in the other message bubble tests.

- [ ] **Step 5: Commit the implementation**

Run:

```bash
git add components/message-bubble.tsx app/globals.css tests/unit/message-bubble.test.ts
git commit -m "feat: compact thinking markdown styling"
```

Expected: a commit containing the wrapper-class change, CSS rules, and final test updates.

### Task 3: Validate the styling change in the browser

**Files:**
- Review: `.dev-server`
- Review: `components/message-bubble.tsx`
- Review: `app/globals.css`

- [ ] **Step 1: Reuse or start the dev server using the project convention**

If `.dev-server` exists, inspect the saved URL:

```bash
if [ -f .dev-server ]; then
  sed -n '1p' .dev-server
fi
```

If the URL is stale or unreachable, remove the file and start a fresh server:

```bash
rm -f .dev-server
npm run dev > .context/thinking-markdown-dev.log 2>&1 &
while [ ! -f .dev-server ]; do sleep 1; done
sed -n '1p' .dev-server
```

Expected: a localhost URL in the `3000-4000` range written by the app’s dev server.

- [ ] **Step 2: Open the app and reach a chat view with the agent-browser workflow**

Use the browser tooling to open the URL from `.dev-server`, wait for the UI to load, and navigate to a chat surface that can show the thinking shell.

Run:

```bash
agent-browser open "$(sed -n '1p' .dev-server)"
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Expected: the chat UI is visible. If the app redirects to `/login`, authenticate with the workspace’s local test credentials before proceeding.

- [ ] **Step 3: Expand a thinking shell and visually verify the text treatment**

Trigger or open a message with thinking content, expand the `Thought` panel, and verify:

- the thinking text is visibly smaller than normal assistant answer text
- the thinking text is greyer and quieter, closer in tone to tool output logs
- markdown elements still render correctly
- the thinking shell header and assistant answer bubble remain unchanged

Capture a screenshot:

```bash
agent-browser screenshot .context/thinking-markdown-shell.png
```

Expected: a screenshot showing the expanded thinking panel with the more muted markdown styling.

- [ ] **Step 4: Run the final local checks**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Record verification status**

If browser validation matches the spec and no follow-up code changes were needed, do not create another commit. Leave the screenshot in `.context/thinking-markdown-shell.png` as evidence for review.
