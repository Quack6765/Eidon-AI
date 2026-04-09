# Loading Indicator Size Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pre-stream three-dot loading indicator visually match the compact thinking shell while keeping the dots-only appearance.

**Architecture:** Keep the change isolated to the assistant loading branch in `MessageBubble`. Add a dedicated compact loading shell plus a targeted unit test so the initial loading state no longer reuses the larger assistant message bubble styling.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind utility classes, Vitest, agent-browser

---

### Task 1: Add a failing test and implement the compact loading shell

**Files:**
- Modify: `tests/unit/message-bubble.test.ts`
- Modify: `components/message-bubble.tsx`

- [ ] **Step 1: Write the failing test**

Add this test near the other streaming placeholder tests in `tests/unit/message-bubble.test.ts`:

```typescript
  it("renders a compact loading shell while awaiting the first token", () => {
    const { container } = render(
      React.createElement(StreamingPlaceholder, {
        createdAt: new Date().toISOString(),
        thinking: "",
        answer: "",
        awaitingFirstToken: true,
        thinkingInProgress: false,
        timeline: []
      })
    );

    const loadingShell = screen.getByTestId("assistant-loading-shell");

    expect(loadingShell).toBeInTheDocument();
    expect(loadingShell.className).toContain("rounded-lg");
    expect(loadingShell.className).not.toContain("rounded-2xl");
    expect(screen.queryByTestId("assistant-message-bubble")).toBeNull();
    expect(container.querySelectorAll(".typing-dot")).toHaveLength(3);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts -t "renders a compact loading shell while awaiting the first token"
```

Expected: FAIL because `assistant-loading-shell` does not exist and the loading state is still rendered inside the larger assistant bubble.

- [ ] **Step 3: Write the minimal implementation**

In `components/message-bubble.tsx`, add a dedicated compact shell constant, give `TypingIndicator` a compact mode, and use that shell only in the `awaitingFirstToken && !compactionInProgress` path.

Use this implementation shape:

```typescript
function TypingIndicator({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "flex items-center gap-1" : "flex items-center gap-1.5 px-1 py-2"}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="typing-dot h-1.5 w-1.5 rounded-full bg-white/40"
          style={{
            animation: "typing-dot 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`
          }}
        />
      ))}
    </div>
  );
}

const ASSISTANT_LOADING_SHELL =
  "inline-flex items-center rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1";
```

Then replace the current loading branch:

```typescript
            {awaitingFirstToken ? (
              compactionInProgress ? (
                <CompactionIndicator />
              ) : (
                <div
                  className={ASSISTANT_LOADING_SHELL}
                  data-testid="assistant-loading-shell"
                >
                  <TypingIndicator compact />
                </div>
              )
            ) : assistantBlocks.length || content ? (
```

Do not change:
- `ASSISTANT_BUBBLE`
- the thinking shell classes
- the compaction indicator branch

- [ ] **Step 4: Run the targeted test to verify it passes**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts -t "renders a compact loading shell while awaiting the first token"
```

Expected: PASS.

- [ ] **Step 5: Run the message bubble test file to check for regressions**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts
```

Expected: PASS with the new loading-shell test plus the existing message bubble tests.

- [ ] **Step 6: Commit the focused code change**

Run:

```bash
git add tests/unit/message-bubble.test.ts components/message-bubble.tsx
git commit -m "fix: compact initial loading shell"
```

Expected: a commit containing only the loading shell test and implementation change.

### Task 2: Verify in the browser and capture evidence

**Files:**
- Review: `.dev-server`
- Review: `.context/`
- Review: `components/message-bubble.tsx`

- [ ] **Step 1: Reuse or start the dev server using the project convention**

If `.dev-server` exists, read the URL and test it first:

```bash
if [ -f .dev-server ]; then
  sed -n '1p' .dev-server
fi
```

If the printed URL does not load, remove the stale file and start a fresh server:

```bash
rm -f .dev-server
npm run dev > .context/loading-indicator-dev.log 2>&1 &
while [ ! -f .dev-server ]; do sleep 1; done
sed -n '1p' .dev-server
```

Expected: a localhost URL in the `3000-4000` range.

- [ ] **Step 2: Open the app with agent-browser and reach the chat surface**

Run:

```bash
agent-browser open "$(sed -n '1p' .dev-server)"
agent-browser wait --load networkidle
agent-browser snapshot -i
```

If the app redirects to `/login`, sign in with the local test account configured for this workspace before continuing. If no test credentials are available in the workspace, stop and ask the user for them before proceeding.

- [ ] **Step 3: Trigger the loading state and visually verify the smaller shell**

Use `agent-browser snapshot -i` to identify the chat composer input and send button, submit a short prompt, and confirm the first assistant placeholder appears as a compact dots-only shell before the thinking card or answer text arrives.

Capture a screenshot after submission:

```bash
agent-browser screenshot .context/loading-indicator-shell.png
```

Expected:
- the initial three-dot shell is visibly smaller than the old assistant bubble footprint
- the shell uses the same calm border/background treatment as the thinking card
- the state remains dots-only

- [ ] **Step 4: Re-run the critical local checks**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Record verification status**

If browser validation matches the spec and no additional code changes were needed, do not create another commit. Leave the screenshot in `.context/loading-indicator-shell.png` as evidence for review.
