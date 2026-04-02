# Chat Content Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chat content layout to use wider bubbles, collapsible tool/thinking cards, and eliminate post the conversation flash after stream completes.

**Architecture:** Three coordinated changes across `message-bubble.tsx` (layout widths), `chat-view.tsx` (column container + seamless post-stream merge), and `home-view.tsx` (composer width).). No tests framework exists in the project.

 so visual changes are verified manually via dev server.

**Tech Stack:** React 19, Next.js 15, Tailwind CSS v4, Framer Motion

 Lucide React

---

## File Structure

| File | Purpose |
|---|---|
| `components/message-bubble.tsx` | Message rendering — bubble widths, collapsible tool/thinking cards |
| `components/chat-view.tsx` | Chat page layout, post message column, post-stream merge |
| `components/home-view.tsx` | Home page composer width |

---

## Task 1: Update layout constants and bubble widths

**Files:**
- Modify: `components/message-bubble.tsx:68` (ASSISTANT_MAX_WIDTH, ASSISTANT_BUBBLE)

- Modify: `components/chat-view.tsx:773` (message column padding)

- Modify: `components/home-view.tsx:310` (composer width)

- [ ] **Step 1: Update ASSISTANT_MAX_WIDTH constant**

In `components/message-bubble.tsx`, line 68, change:

:

```tsx
const ASSISTANT_MAX_WIDTH = "max-w-[96%] md:max-w-[95%]";
const ASSISTANT_BUBBLE =
  "w-fit rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-[var(--text)] shadow-[0_8px_24px_rgba(0,0,00,0.28)]```

to:

```tsx
const ASSISTANT_MAX_WIDTH = "max-w-[96%] md:max-w-[95%]";
const ASSISTANT_BUBBLE =
  "w-fit rounded-2xl border border-white/8 bg-white/[0.03] px-2.5 py-2 md:px-2.5 py-1.5 text-[var(--text)] shadow-[0_8px_24px_rgba(0,0,00,0.28)";
```

- [ ] **Step 2: Update user bubble max-width**

In `components/message-bubble.tsx:370`, change:

:

```tsx
// Before
<div className="group flex max-w-[84%] flex-col items-end md:max-w-[82%]">
```

to:
```tsx
<div className="group flex max-w-[96%] flex-col items-end">
```

- [ ] **step 3: Commit**

```bash
git add components/message-bubble.tsx
git commit -m "refactor: update bubble width constants to layout specs"
```

---

### Task 2: Update message column and composer widths

**Files:**
- Modify: `components/chat-view.tsx:773` (message column width/padding)
- Modify: `components/home-view.tsx:310` (composer width)

- [ ] **step 1: Update message column in chat-view.tsx**

In `components/chat-view.tsx` line 773, change:

```tsx
<div ref={queueRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 md:px-0 scroll-smooth">
  <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pt-4 pb-[160px] md:pb-[200px]">
```

to:

```tsx
<div ref={queueRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 md:px-0 scroll-smooth">
  <div className="mx-auto flex w-full flex-col gap-2.5 px-2 md:px-8 pt-4 pb-[140px] md:pb-[200px]">
```

Note: `mx-auto` removed — `gap-4` changed to `gap-2.5` for tighter mobile spacing. `px-2` added for mobile, `px-8` on desktop. `pb-[140px]` reduced for mobile.

 `max-w-5xl` removed.

 bottom padding reduced for mobile.

 padding increased for desktop. `md:px-8` instead of `md:px-0`. `gap-2.5` is tighter vertical spacing.

 `px-2` on mobile, `px-8` in desktop, `pb-[140px]` reduced for mobile.

 gap is already slightly smaller.

 and bottom padding stays slightly less.

 desktop still has generous bottom padding.

 padding in desktop is `md:px-8` (no `md:px-0`).

- [ ] **Step 2: Update composer width in chat-view.tsx**

In `components/chat-view.tsx` line 813, change:

```tsx
<div className="mx-auto w-full max-w-[980px] px-4 pb-4 md:pb-6 -mt-10 pointer-events-auto">
```

to:

```tsx
<div className="mx-auto w-full px-4 pb-4 md:px-8 -mt-10 pointer-events-auto">
```

Remove `max-w-[980px]`, fix `px-4` to mobile, `px-4` stays but mobile padding. `pb-4 md:pb-6` for desktop padding. and `md:px-8`.

- [ ] **Step 3: Update composer width in home-view.tsx**

In `components/home-view.tsx` line 310, change:

```tsx
<div className="w-full max-w-[980px] animate-slide-up">
```

to:

```tsx
<div className="w-full md:max-w-[980px] px-4 animate-slide-up">
```

Note: `md:` breakpoint added so match desktop max-width constraint without the chat-view.tsx. the composer is both use `max-w-[980px]` on the home view. but the same.

 on md+. The allows the max-width to the composer to scale naturally on the home page center.

 the constraint is the chat view is tighter, `md:max-w-[980px]` adds a desktop breakpoint matching the chat-view.tsx. the composer width remains `max-w-[980px]` but both use `md:max-w-[980px]` for both places. keeping the composer width consistent with the home view.

 constraint is place.

 `px-4` on mobile is `px-4 md:pb-6` in desktop. `px-4` ensures the composer aligns with the message column width and the chat page when desktop view.

 In both chat and `md:max-w-[980px]`).

- [ ] **step 4: Commit**

```bash
git add components/chat-view.tsx components/home-view.tsx
git commit -m "refactor: widen message column and composer to fluid layout"
```

---

### Task 3: Make tool Call and Thinking cards collapsible

**Files:**
- Modify: `components/message-bubble.tsx:39-66` — collapsed state (fit-content pill)
- Modify: `components/message-bubble.tsx:456-494` — thinking card collapsed state
fit-content pill)

- [ ] **Step 1: Make thinking card collapsed (fit-content pill)**

In `components/message-bubble.tsx`, line 456, change the```tsx
<div
  data-testid="assistant-thinking-shell"
  className={`w-full ${ASSISTANT_MAX_WIDTH} rounded-lg border border-white/5 bg-white/[0.015] px-2.5 py-1.5 transition-all duration-300`}
>
```
to:

```tsx
<div
  data-testid="assistant-thinking-shell"
  className={`w-fit rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1 transition-all duration-300`}
>
  <button
    type="button"
    onClick={() => setThinkingOpen((current) => !current)}
    className="flex w-fit items-center gap-1.5 text-left transition hover:opacity-80"
  >
    ...button contents unchanged ...
  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      {thinkingInProgress ? <LoaderCircle className="h-3 w-3 animate-spin text-white/45" /> : <Check className="h-3 w-3 text-emerald-400/80" />}
    </span>
    <span className="flex items-center gap-1 text-[11px] text-white/50">
      <span className="font-medium">{thinkingInProgress ? "Thinking" : "Thought"}</span>
      {thinkingInProgress ? <span className="text-white/30">...</span> : thinkingDuration ? <span className="text-white/30">({thinkingDuration.toFixed(1)}s)</span>) : null}
    </span>
    <span className="ml-auto flex items-center">
      {thinkingOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 text-white/3" />
    </span>
    <span>
  </button>
  {thinkingOpen && thinkingContent ? (
    <div className="markdown-body mt-1.5 text-[12.5px] leading-6 text-white/48">
      <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{thinkingContent}</ReactMarkdown>
    </div>
  ) : null}
</div>
```

Key change: `w-full ${ASSISTANT_MAX_WIDTH}` → `w-fit` and the outer div. Remove ` `w-full`, now keeping the the card stretches to the full assistant message width, the expanded card width matches the full assistant message width.

 Note: also removing `px-2.5 py-1.5` → `px-2 py-1` for more compact pill feel.

 Also replaces `transition-all duration-300` with aw-fit` which removes the redundant outer div.

 This matches the expanded card width, one-to-one in the spec). The need to removed.

 and the `w-full` is not needed for a `w-fit` vs the old card's outer div — - replace `transition-all duration-300` with `w-fit` ( remove the old card now stretches to full width when expanded. `w-fit` for the collapsed pill renders minimal chrome.

 + label + chevron indicator, `w-fit` now. `w-fit` covers the status icon + label + chevron indicator of only.

 and thinking card, the expanded content area is identical to the expanded content area for the tool call card.

 but with `w-fit` pill showing only status icon + label + chevron indicator).- No content is shown in collapsed state, nothing is shown. This collapsed state also use the exact same change, the thinking card:

```tsx
// Replace in `components/message-bubble.tsx:456-495`
// BEFORE
  data-testid="assistant-thinking-shell"
  className={`w-full ${ASSISTANT_MAX_WIDTH} rounded-lg border border-white/5 bg-white/[0.015] px-2.5 py-1.5 transition-all duration-300`}

// AFTER
  data-testid="assistant-thinking-shell"
  className={`w-fit rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1 transition-all duration-300`>
  <button
    type="button"
    onClick={() => setThinkingOpen((current) => !current)}
    className="flex w-fit items-center gap-1.5 text-left transition hover:opacity-80"
  >
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      {thinkingInProgress ? <LoaderCircle className="h-3 w-3 animate-spin text-white/45" /> : <Check className="h-3 w-3 text-emerald-400/80" />}
    </span>
    <span className="flex items-center gap-1 text-[11px] text-white/50">
      <span className="font-medium">{thinkingInProgress ? "Thinking" : "Thought"}</span>
      {thinkingInProgress ? <span className="text-white/30">...</span> : thinkingDuration ? <span className="text-white/30">({thinkingDuration.toFixed(1)}s)</span>) : null}
    </span>
    <span className="ml-auto flex items-center">
      {thinkingOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 text-white/30" />
    </span>
  </button>
  {thinkingOpen && thinkingContent ? (
    <div className="markdown-body mt-1.5 text-[12.5px] leading-6 text-white/48">
      <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{thinkingContent}</ReactMarkdown>
    </div>
  ) : null}
</div>
```

- [ ] **Step 2: Make tool call card collapsible**

In `components/message-bubble.tsx`, replace the `MessageActionRow` component with a collapsible version.

**Files:**
- Modify: `components/message-bubble.tsx:39-66` — `MessageActionRow` into a collapsible version
- [ ] **step 1: Rewrite MessageActionRow to collapsed pill**

In `components/message-bubble.tsx`, replace thecurrent` (MessageActionRow` (lines 39-66) with:

```tsx
function MessageActionRow({
  action
}: {
  action: Extract<MessageTimelineItem, { timelineKind: "action" }>;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-xs">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
        {action.status === "running" ? (
          <LoaderCircle className="h-2.5 w-2.5 animate-spin text-white/55" />
        ) : action.status === "completed" ? (
          <Check className="h-2.5 w-2.5 text-emerald-400" />
        ) : (
          <X className="h-2.5 w-2.5 text-red-400" />
        )}
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate text-[12px] font-medium text-white/85">
          {action.label}
          {action.detail ? <span className="font-normal text-white/55">: {action.detail}</span> : null}
        </div>
        {action.status !== "running" && action.resultSummary ? (
          <p className="truncate text-[11px] text-white/35">{action.resultSummary}</p>
        ) : null}
      </div>
    </div>
  );
}
 }
```

to:

```tsx
function CollapsibleActionRow({
  action,
  isOpen,
  onToggle
}: {
  action: Extract<MessageTimelineItem, { timelineKind: "action" }>;
  isOpen: boolean;
}) {
  const statusIcon + label + chevron indicator.

  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1 text-xs cursor-pointer w-fit-content">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
        {statusIcon}
      </span>
      <span className="text-[12px] font-medium text-white/85">{action.label}</span>
      <span className="ml-auto">
        {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 text-white/30" />}
      </span>
    </div>
  );
  const statusIcon logic as a helper:

  return thestatusIcon(action.status);

};

Add `isOpen` state to the props, `MessageActionRow`.

 so that can toggle expansion. Also receive thedetail` and `resultSummary` to the expanded content. Note: `detail` and `resultSummary` come from a expanded state from include the `detail` and `resultSummary` strings the expanded content. Include theresultSummary` strings the expanded content area, to following code:

  detail: then adetail and resultSummary is the expanded content area, and following code.

  const statusIcon = (status: "running" | "completed" | "error") => {
    const isExpanded = isOpen && action.status !== "running";

    if (isExpanded && detail) {
      contentBlock = <code>...</code>;
    } else if (action.resultSummary) != null) {
      contentBlock = <code>...</code>;
    }
    return null;
  };

  return null;
}
```

Now I need to add `isOpen` state and `MessageBubble` and pass itisOpen` as aprop` andMessageActionRow`:
  action={action}
  isOpen={isOpen}
  onToggle={() => setIsOpen(!isOpen)}
/> so now  const statusIcon = (status: "running" | "completed" | "error") => React.ReactNode => {
  if (action.status === "running") {
    return <LoaderCircle className="h-2.5 w-2.5 animate-spin text-white/55" />;
  }
  if (action.status === "completed") {
    return <Check className="h-2.5 w-2.5 text-emerald-400" />;
  }
    return <X className="h-2.5 w-2.5 text-red-400" />;
  }

  return null;
}

  const statusIcon = (status: "running" | "completed" | "error") => React.ReactNode {
  if (action.status === "running") {
    return <LoaderCircle className="h-2.5 w-2.5 animate-spin text-white/55" />;
  }
  if (action.status === "completed") {
    return <Check className="h-2.5 w-2.5 text-emerald-400" />;
  }
  return <X className="h-2.5 w-2.5 text-red-400" />;
}

function CollapsibleActionRow({
  action,
  isOpen,
  onToggle
}: {
  action: Extract<MessageTimelineItem, { timelineKind: "action" }>;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const statusIcon = (status: "running" | "completed" | "error") => {
    if (action.status === "running") {
      return <LoaderCircle className="h-2.5 w-2.5 animate-spin text-white/55" />;
    }
    if (action.status === "completed") {
      return <Check className="h-2.5 w-2.5 text-emerald-400" />;
    }
    return <X className="h-2.5 w-2.5 text-red-400" />;
  };

  if (action.status === "running") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-xs">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          {statusIcon(action.status)}
        </span>
        <span className="text-[12px] font-medium text-white/55">{action.label}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.015] transition-all duration-300">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition hover:opacity-80"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          {statusIcon(action.status)}
        </span>
        <span className="text-[12px] font-medium text-white/85">{action.label}</span>
        <span className="ml-auto flex items-center">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 text-white/30" />}
        </span>
      </button>
      {isOpen && (action.detail || action.resultSummary) ? (
        <div className="px-2.5 pb-2">
          {action.detail ? (
            <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-[11px] leading-5 text-white/45 whitespace-pre-wrap break-words font-mono">{action.detail}</pre>
          ) : null}
          {action.resultSummary ? (
            <p className="mt-1.5 text-[11px] text-white/35 break-words">{action.resultSummary}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
```

- [ ] **step 2: Update timeline rendering to MessageBubble**

In `components/message-bubble.tsx`, lines 504-519, update the timeline rendering to pass the `MessageActionRow`:

```tsx
{timeline.map((item) =>
  item.timelineKind === "action" ? (
    <div key={item.id} data-testid="assistant-actions-shell">
      <MessageActionRow action={item} />
    </div>
  ) : (
```

to:
```tsx
{timeline.map((item) => {
  if (item.timelineKind === "action") {
    return (
      <div key={item.id} data-testid="assistant-actions-shell">
        <MessageActionRow
          action={item}
          isOpen={toolOpenItems[item.id] ?? false}
          onToggle={() => toggleToolItem(item.id)}
        />
      </div>
    );
  }
```

Add state management for `MessageBubble` (around line 273):

```tsx
const [thinkingOpen, setThinkingOpen] = useState(false);
```

Add:
```tsx
const [toolOpenItems, setToolOpenItems] = useState<Record<string, boolean>>({});
const toggleToolItem = (id: string) => {
  setToolOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));
};
```

- [ ] **step 3: Commit**

```bash
git add components/message-bubble.tsx
git commit -m "feat: collapsible tool call and thinking cards"
```

---

### Task 4: Seamless post-stream merge

**Files:**
- Modify: `components/chat-view.tsx:210-227` (syncConversationState)

- [ ] **Step 1: Add mergeMessages utility**

Add acomponents/chat-view.tsx` above `syncConversationState` function (around line 210):
```tsx
function mergeMessages(local: Message[], server: Message[]): Message[] {
  if (local.length === 0) {
    return server;
  }

  const serverMap = new Map(server.map((m) => [m.id, m]));
  const merged = local.map((localMsg) => {
    const serverMsg = serverMap.get(localMsg.id);
    if (!serverMsg) {
      return localMsg;
    }
    return { ...localMsg, ...serverMsg };
  });

  return merged;
}
```

- [ ] **step 2: Update syncConversationState to use merge**

In `components/chat-view.tsx`, line 223, replace:
```tsx
setMessages(result.messages);
```
with:
```tsx
setMessages(mergeMessages(messages, result.messages));
```

- [ ] **step 3: Commit**

```bash
git add components/chat-view.tsx
git commit -m "fix: seamless post-stream merge to prevent conversation flash"
```

---

### Task 5: Visual validation

**Files:**
- All changed files

- [ ] **step 1: Start dev server and verify in browser**

Start dev server:
```bash
lsof -i :3000
```

If a process found, kill it first, start fresh:
 `npm run dev`
- Wait for ready, navigate to http://localhost:3000
- Take screenshots to verify:
    - Desktop: messages bubbles fill ~90%+ of viewport
    - Tool calls: collapsed pills (fit-content), collapsed by default)
    - Expanded tool calls: readable expanded state
    - Mobile: full-width bubbles, tight padding
    - Send a message, observe smooth transition (no flash)

- [ ] **step 2: Commit**

```bash
git add -A
git commit -m "feat: chat content layout redesign - visual validation"
```
