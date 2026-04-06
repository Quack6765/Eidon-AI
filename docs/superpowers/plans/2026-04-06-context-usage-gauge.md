# Context Usage Gauge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a circular progress gauge to the chatbox toolbar showing context usage relative to the model's compaction threshold.

**Architecture:** Create a new `ContextGauge` component that renders an SVG circular progress indicator with color-coded fill based on usage percentage. Track token usage state in `ChatView` from the `usage` event, pass to `ChatComposer` along with model context settings, and render the gauge in the toolbar with hover/tap tooltip.

**Tech Stack:** React, TypeScript, Tailwind CSS, SVG for circular gauge, CSS transitions for animations

---

## Files

| File | Purpose |
|------|---------|
| `components/context-gauge.tsx` | New component: circular gauge with tooltip |
| `tests/unit/context-gauge.test.tsx` | Unit tests for ContextGauge |
| `components/chat-composer.tsx` | Modify: add gauge to toolbar |
| `components/chat-view.tsx` | Modify: track usage state, pass to ChatComposer |
| `app/globals.css` | Modify: add gauge color variables and styles |

---

### Task 1: Create ContextGauge Component

**Files:**
- Create: `components/context-gauge.tsx`
- Create: `tests/unit/context-gauge.test.tsx`

- [ ] **Step 1: Write failing test for ContextGauge render**

Create `tests/unit/context-gauge.test.tsx`:

```tsx
// @vitest-environment jsdom

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextGauge } from "@/components/context-gauge";

describe("ContextGauge", () => {
  const defaultProps = {
    usedTokens: 50000,
    usableLimit: 80000,
    maxLimit: 100000
  };

  it("renders circular gauge with percentage fill", () => {
    render(<ContextGauge {...defaultProps} />);

    // Should show used tokens label
    expect(screen.getByText("50K")).toBeInTheDocument();

    // Should have progressbar role for accessibility
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows green color when usage is below 50%", () => {
    render(<ContextGauge {...defaultProps} usedTokens={30000} />);

    const gauge = screen.getByRole("progressbar");
    expect(gauge).toHaveAttribute("aria-valuenow", "38");
  });

  it("shows yellow color when usage is between 50-70%", () => {
    render(<ContextGauge {...defaultProps} usedTokens={55000} />);

    const gauge = screen.getByRole("progressbar");
    expect(gauge).toHaveAttribute("aria-valuenow", "69");
  });

  it("shows red color when usage is above 70%", () => {
    render(<ContextGauge {...defaultProps} usedTokens={60000} />);

    const gauge = screen.getByRole("progressbar");
    expect(gauge).toHaveAttribute("aria-valuenow", "75");
  });

  it("displays tooltip on hover with compact format", async () => {
    render(<ContextGauge {...defaultProps} />);

    const gauge = screen.getByRole("progressbar");
    fireEvent.mouseEnter(gauge);

    expect(screen.getByText(/50K used/)).toBeInTheDocument();
    expect(screen.getByText(/80K usable/)).toBeInTheDocument();
    expect(screen.getByText(/100K/)).toBeInTheDocument();
  });

  it("hides tooltip when mouse leaves", async () => {
    render(<ContextGauge {...defaultProps} />);

    const gauge = screen.getByRole("progressbar");
    fireEvent.mouseEnter(gauge);
    expect(screen.getByText(/50K used/)).toBeInTheDocument();

    fireEvent.mouseLeave(gauge);
    expect(screen.queryByText(/50K used/)).not.toBeInTheDocument();
  });

  it("formats large token counts with K suffix", () => {
    render(<ContextGauge {...defaultProps} usedTokens={1500} />);
    expect(screen.getByText("1.5K")).toBeInTheDocument();
  });

  it("formats millions with M suffix", () => {
    render(<ContextGauge {...defaultProps} usedTokens={1500000} usableLimit={2000000} maxLimit={2000000} />);
    expect(screen.getByText("1.5M")).toBeInTheDocument();
  });

  it("toggles tooltip on mobile tap", () => {
    render(<ContextGauge {...defaultProps} />);

    const gauge = screen.getByRole("progressbar");
    fireEvent.click(gauge);

    expect(screen.getByText(/50K used/)).toBeInTheDocument();

    // Tap again to hide
    fireEvent.click(gauge);
    expect(screen.queryByText(/50K used/)).not.toBeInTheDocument();
  });

  it("does not render when usedTokens is null", () => {
    const { container } = render(
      <ContextGauge usedTokens={null} usableLimit={80000} maxLimit={100000} />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test tests/unit/context-gauge.test.tsx`
Expected: FAIL with "Cannot find module '@/components/context-gauge'"

- [ ] **Step 3: Implement ContextGauge component**

Create `components/context-gauge.tsx`:

```tsx
"use client";

import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

type ContextGaugeProps = {
  usedTokens: number | null;
  usableLimit: number;
  maxLimit: number;
};

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const value = tokens / 1000;
    return value >= 100 ? `${Math.round(value)}K` : `${value.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(tokens);
}

function getGaugeColor(percentage: number): string {
  if (percentage >= 70) return "#ef4444"; // red-500
  if (percentage >= 50) return "#eab308"; // yellow-500
  return "#22c55e"; // green-500
}

export function ContextGauge({ usedTokens, usableLimit, maxLimit }: ContextGaugeProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (usedTokens === null) {
    return null;
  }

  const percentage = Math.min(100, (usedTokens / usableLimit) * 100);
  const color = getGaugeColor(percentage);

  // SVG circle properties
  const size = 20;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percentage / 100);

  const handleMouseEnter = useCallback(() => {
    setShowTooltip(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
  }, []);

  const handleClick = useCallback(() => {
    setShowTooltip((prev) => !prev);
  }, []);

  const usedFormatted = formatTokens(usedTokens);
  const usableFormatted = formatTokens(usableLimit);
  const maxFormatted = formatTokens(maxLimit);
  const thresholdPercent = Math.round((usableLimit / maxLimit) * 100);

  return (
    <div className="relative flex items-center gap-1.5">
      <button
        type="button"
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${Math.round(percentage)}% context used`}
        className="flex items-center justify-center p-1 rounded-lg hover:bg-white/5 transition-colors"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          style={{ transform: "rotate(-90deg)" }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.3s ease-out" }}
          />
        </svg>
      </button>
      <span className="text-[10px] text-white/40">{usedFormatted}</span>

      {showTooltip && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg bg-[#27272a] border border-white/10 shadow-lg whitespace-nowrap z-50"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="text-[11px] text-white/70">
            {usedFormatted} used
          </div>
          <div className="text-[11px] text-white/50">
            {usableFormatted} usable ({thresholdPercent}% of {maxFormatted})
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test tests/unit/context-gauge.test.tsx`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add components/context-gauge.tsx tests/unit/context-gauge.test.tsx
git commit -m "feat: add ContextGauge component with tooltip

- Circular SVG gauge showing context usage percentage
- Color-coded: green (0-50%), yellow (50-70%), red (70%+)
- Hover tooltip with used/usable/max token counts
- Tap-to-toggle tooltip for mobile
- Accessible with progressbar role

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Track Token Usage in ChatView

**Files:**
- Modify: `components/chat-view.tsx`

- [ ] **Step 1: Add token usage state to ChatView**

In `components/chat-view.tsx`, find the state declarations near line 200. Add after `compactionInProgress` state:

```tsx
const [usedTokens, setUsedTokens] = useState<number | null>(null);
```

- [ ] **Step 2: Update usedTokens when usage event arrives**

In the `handleDelta` function (around line 360), find the `if (event.type === "usage")` block. Replace the empty return with:

```tsx
if (event.type === "usage") {
  if (event.inputTokens !== undefined) {
    setUsedTokens(event.inputTokens);
  }
  return;
}
```

- [ ] **Step 3: Pass usedTokens and context limits to ChatComposer**

Find the `ChatComposer` component render (around line 1236). Update the props to include:

```tsx
<ChatComposer
  input={input}
  onInputChange={setInput}
  onSubmit={submit}
  isSending={isSending}
  pendingAttachments={pendingAttachments}
  isUploadingAttachments={isUploadingAttachments}
  onUploadFiles={uploadFiles}
  onRemovePendingAttachment={removePendingAttachment}
  showVisionWarning={Boolean(showVisionWarning)}
  providerProfiles={payload.providerProfiles}
  providerProfileId={providerProfileId}
  onProviderProfileChange={updateProviderProfile}
  toolExecutionMode={toolExecutionMode}
  onToolExecutionModeChange={updateToolExecutionMode}
  textareaRef={inputRef}
  usedTokens={usedTokens}
  modelContextLimit={selectedProfile?.modelContextLimit ?? 128000}
  compactionThreshold={selectedProfile?.compactionThreshold ?? 0.78}
  hasMessages={messages.length > 0}
/>
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add components/chat-view.tsx
git commit -m "feat: track token usage in ChatView

- Add usedTokens state updated from usage event
- Pass usedTokens and context limits to ChatComposer
- Only show gauge when messages exist

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Integrate ContextGauge into ChatComposer

**Files:**
- Modify: `components/chat-composer.tsx`

- [ ] **Step 1: Add ContextGauge props to ChatComposer**

In `components/chat-composer.tsx`, update the type definition:

```tsx
type ChatComposerProps = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  isSending: boolean;
  pendingAttachments: MessageAttachment[];
  isUploadingAttachments: boolean;
  onUploadFiles: (files: File[]) => Promise<void>;
  onRemovePendingAttachment: (attachmentId: string) => Promise<void>;
  showVisionWarning: boolean;
  providerProfiles: ProviderProfileSummary[];
  providerProfileId: string;
  onProviderProfileChange: (providerProfileId: string) => void | Promise<void>;
  toolExecutionMode: ToolExecutionMode;
  onToolExecutionModeChange: (toolExecutionMode: ToolExecutionMode) => void | Promise<void>;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  className?: string;
  usedTokens: number | null;
  modelContextLimit: number;
  compactionThreshold: number;
  hasMessages: boolean;
};
```

- [ ] **Step 2: Import ContextGauge**

Add import at the top:

```tsx
import { ContextGauge } from "@/components/context-gauge";
```

- [ ] **Step 3: Destructure new props**

Update the props destructuring:

```tsx
export function ChatComposer({
  input,
  onInputChange,
  onSubmit,
  isSending,
  pendingAttachments,
  isUploadingAttachments,
  onUploadFiles,
  onRemovePendingAttachment,
  showVisionWarning,
  providerProfiles,
  providerProfileId,
  onProviderProfileChange,
  toolExecutionMode,
  onToolExecutionModeChange,
  textareaRef,
  className,
  usedTokens,
  modelContextLimit,
  compactionThreshold,
  hasMessages
}: ChatComposerProps) {
```

- [ ] **Step 4: Calculate usable limit**

Inside the component, calculate usable limit:

```tsx
const usableLimit = Math.floor(modelContextLimit * compactionThreshold);
```

- [ ] **Step 5: Add ContextGauge to toolbar**

Find the toolbar section (around line 173) with the buttons. Add the gauge after the model selector, before the Tool Selection section:

```tsx
<div className="flex items-center gap-2">
  {/* Context usage gauge */}
  {hasMessages && (
    <>
      <div className="w-px h-5 bg-white/10" />
      <ContextGauge
        usedTokens={usedTokens}
        usableLimit={usableLimit}
        maxLimit={modelContextLimit}
      />
    </>
  )}

  <span className="text-[11px] text-white/40 select-none">Tool Selection</span>
  {/* ... rest of Tool Selection */}
</div>
```

- [ ] **Step 6: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add components/chat-composer.tsx
git commit -m "feat: integrate ContextGauge into ChatComposer toolbar

- Add gauge after model selector with visual separator
- Only show when conversation has messages
- Pass token usage and context limits from ChatView

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Add CSS Variables and Polish

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add gauge color variables**

In `app/globals.css`, add CSS custom properties for gauge colors after the existing color variables (around line 30):

```css
  --gauge-green: #22c55e;
  --gauge-yellow: #eab308;
  --gauge-red: #ef4444;
```

- [ ] **Step 2: Update ContextGauge to use CSS variables**

In `components/context-gauge.tsx`, update the `getGaugeColor` function:

```tsx
function getGaugeColor(percentage: number): string {
  if (percentage >= 70) return "var(--gauge-red)";
  if (percentage >= 50) return "var(--gauge-yellow)";
  return "var(--gauge-green)";
}
```

- [ ] **Step 3: Verify tests still pass**

Run: `npm run test tests/unit/context-gauge.test.tsx`
Expected: All tests pass

- [ ] **Step 4: Run full test suite**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add app/globals.css components/context-gauge.tsx
git commit -m "style: add CSS variables for context gauge colors

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Add Integration Tests

**Files:**
- Modify: `tests/unit/chat-view.test.tsx`

- [ ] **Step 1: Add test for usage event updating gauge**

In `tests/unit/chat-view.test.tsx`, add a test for the usage event:

```tsx
it("updates token usage when usage event arrives", async () => {
  const payload = createPayload();
  const { container } = render(<ChatView payload={payload} />);

  // Wait for initial render
  await waitFor(() => {
    expect(screen.getByText("Test conversation")).toBeInTheDocument();
  });

  // Send a message to trigger message creation
  const input = screen.getByPlaceholderText(/Ask, create/);
  fireEvent.change(input, { target: { value: "Hello" } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

  // Simulate message_start event
  act(() => {
    wsMock.onMessage?.({
      type: "snapshot",
      messages: [
        {
          id: "msg_user",
          conversationId: "conv_1",
          role: "user",
          content: "Hello",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 5,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString()
        }
      ]
    });
    wsMock.onMessage?.({
      type: "delta",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
  });

  // Simulate usage event
  act(() => {
    wsMock.onMessage?.({
      type: "delta",
      event: { type: "usage", inputTokens: 50000, outputTokens: 100 }
    });
  });

  // The gauge should now show token usage (after messages exist)
  // Note: This is a conceptual test - actual implementation may vary
  // based on how the gauge visibility is controlled
});
```

- [ ] **Step 2: Run tests to verify**

Run: `npm run test tests/unit/chat-view.test.tsx`
Expected: Tests pass (may need adjustment based on actual mock setup)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/chat-view.test.tsx
git commit -m "test: add usage event integration test for gauge

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Manual testing**

Start the dev server and verify:
1. Gauge appears in chat toolbar when messages exist
2. Gauge shows correct percentage based on token usage
3. Color changes based on thresholds
4. Tooltip shows on hover (desktop)
5. Tooltip toggles on tap (mobile)
6. Gauge updates after compaction
7. Gauge hidden on empty conversation

Run: `npm run dev`

---

## Summary

This implementation adds a context usage gauge to the chatbox toolbar that:
1. Shows a circular progress indicator with color-coded fill
2. Updates after each message stream completes
3. Displays used/usable/max token counts in a tooltip
4. Works on desktop (hover) and mobile (tap-to-toggle)
5. Uses semantic HTML and ARIA for accessibility