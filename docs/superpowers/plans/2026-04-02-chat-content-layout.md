# Chat Content Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chat content layout with wider bubbles, collapsible tool/thinking cards, and eliminate the conversation flash after stream completes

**Architecture:** Three coordinated changes across `message-bubble.tsx` (layout widths), collapsible cards), `chat-view.tsx` (column container + seamless post-stream merge), and `home-view.tsx` (composer width). No test framework exists in the project — visual changes are verified manually via dev server.

**Tech Stack:** React 19, Next.js 15, Tailwind CSS v4, Framer Motion, Lucide React

---

## File Structure

| File | Purpose |
|---|---|
| `components/message-bubble.tsx` | Message rendering — bubble widths, collapsible tool/thinking cards |
| `components/chat-view.tsx` | Chat page layout, message column, seamless post-stream merge |
| `components/home-view.tsx` | Home page composer width |

---

### Task 1: Update layout constants and bubble widths

**Files:**
- Modify: `components/message-bubble.tsx:68` (ASSISTANT_MAX_WIDTH)
- Modify: `components/message-bubble.tsx:69` (ASSISTANT_BUBBLE)
- Modify: `components/message-bubble.tsx:370` (user bubble max-width)
- Modify: `components/message-bubble.tsx:458` (thinking shell className)

- [ ] **Step 1: Update ASSISTANT_MAX_WIDTH constant**

In `components/message-bubble.tsx`, line 68, change:
```
max-w-[84%] md:max-w-[82%]
```
to:
```
max-w-[96%] md:max-w-[95%]
```

- [ ] **Step 2: Update ASSISTANT_BUBBLE constant**

In `components/message-bubble.tsx`, line 69, change:
```
px-4 py-3
```
to:
```
px-2.5 py-2 md:px-4 md:py-3
```

This adds responsive padding: compact on mobile, comfortable on desktop.

- [ ] **Step 3: Update user bubble max-width**

In `components/message-bubble.tsx`, line 370, change:
```
max-w-[84%] flex-col items-end md:max-w-[82%]
```
to:
```
max-w-[96%] flex-col items-end md:max-w-[95%]
```

- [ ] **Step 4: Update thinking shell to fit-content width**

In `components/message-bubble.tsx`, line 458, the thinking shell outer div className, change:

```
w-full ${ASSISTANT_MAX_WIDTH} rounded-lg border border-white/5 bg-white/[0.015] px-2.5 py-1.5 transition-all duration-300
```
to:
```
w-fit rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1 transition-all duration-300
```

This makes the thinking card a compact pill (`w-fit`) when collapsed state instead of stretching to full width.

- [ ] **Step 5: Commit**

```bash
git add components/message-bubble.tsx
git commit -m "refactor: widen bubble widths and collapsed thinking card to fit-content"
```

---

### Task 2: Widen message column and composer to fluid layout

**Files:**
- Modify: `components/chat-view.tsx:772-773` (message column)
- Modify: `components/chat-view.tsx:813` (composer)
- Modify: `components/home-view.tsx:310` (home composer)

- [ ] **Step 1: Update message scroll area and column**

In `components/chat-view.tsx`, lines 772-773, change:

```tsx
// BEFORE
<div ref={queueRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 md:px-0 scroll-smooth">
  <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pt-4 pb-[160px] md:pb-[200px]">

// AFTER
<div ref={queueRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 md:px-8 scroll-smooth">
  <div className="flex w-full flex-col gap-2.5 md:gap-4 px-2 md:px-0 pt-4 pb-[140px] md:pb-[200px]">
```

Key changes:
- Outer scroll area: `px-4 md:px-0` → `px-2 md:px-8` (tight mobile, generous desktop)
- Inner column: Removed `mx-auto max-w-5xl` (no more fixed max-width, fluid layout)
- Gap: `gap-4` → `gap-2.5 md:gap-4` (tighter mobile)
 same desktop)
- Bottom padding: `pb-[160px]` → `pb-[140px]` (slightly tighter mobile)

 same desktop)

- [ ] **Step 2: Update chat composer width**

In `components/chat-view.tsx`, line 813, change:

```tsx
// BEFORE
<div className="mx-auto w-full max-w-[980px] px-4 pb-4 md:pb-6 -mt-10 pointer-events-auto">

// AFTER
<div className="mx-auto w-full px-4 pb-4 md:px-8 md:pb-6 -mt-10 pointer-events-auto">
```

Remove `max-w-[980px]`. The composer now scales with the message column.

- [ ] **Step 3: Update home page composer width**

In `components/home-view.tsx`, line 310, change:

```tsx
// BEFORE
<div className="w-full max-w-[980px] animate-slide-up">

// AFTER
<div className="w-full md:max-w-[980px] px-4 animate-slide-up">
```

Add `px-4` for mobile padding. Keep `max-w-[980px]` only on desktop with `md:` breakpoint.

- [ ] **Step 4: Commit**

```bash
git add components/chat-view.tsx components/home-view.tsx
git commit -m "refactor: widen message column and composer to fluid layout"
```

---

### Task 3: Make tool call cards collapsible

**Files:**
- Modify: `components/message-bubble.tsx:39-66` (MessageActionRow → CollapsibleActionRow)
- Modify: `components/message-bubble.tsx:273` (add toolOpenItems state)
- Modify: `components/message-bubble.tsx:504-519` (timeline rendering)

- [ ] **Step 1: Replace MessageActionRow with CollapsibleActionRow**

In `components/message-bubble.tsx`, replace the entire `MessageActionRow` function (lines 39-66) with:

```tsx
function CollapsibleActionRow({
  action,
  isOpen,
  onToggle
}: {
  action: Extract<MessageTimelineItem, { timelineKind: "action" }>;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const statusIcon = action.status === "running"
    ? <LoaderCircle className="h-2.5 w-2.5 animate-spin text-white/55" />
    : action.status === "completed"
      ? <Check className="h-2.5 w-2.5 text-emerald-400" />
      : <X className="h-2.5 w-2.5 text-red-400" />;

  if (action.status === "running") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-xs">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          {statusIcon}
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
          {statusIcon}
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
      ) : null}
    </div>
  );
}
```

Key behaviors:
- **Running state**: Non-collapsible, shows inline pill with spinner
- **Completed/error state**: Collapsible — collapsed shows pill with chevron-right, expanded shows detail/result
- **Click header**: Toggles open/close
- **Expanded content**: Shows `action.detail` in monospace code block, `action.resultSummary` as text below

- [ ] **Step 2: Add toolOpenItems state**

In `components/message-bubble.tsx`, after line 273 (`const [thinkingOpen, setThinkingOpen] = useState(false);`), add:

```tsx
const [toolOpenItems, setToolOpenItems] = useState<Record<string, boolean>>({});

function toggleToolItem(id: string) {
  setToolOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));
}
```

- [ ] **Step 3: Update timeline rendering to use CollapsibleActionRow**

In `components/message-bubble.tsx`, lines 504-519, change the timeline `.map()` rendering from:

```tsx
// BEFORE
{timeline.map((item) =>
  item.timelineKind === "action" ? (
    <div key={item.id} data-testid="assistant-actions-shell">
      <MessageActionRow action={item} />
    </div>
  ) : (

// AFTER
{timeline.map((item) => {
  if (item.timelineKind === "action") {
    return (
      <div key={item.id} data-testid="assistant-actions-shell">
        <CollapsibleActionRow
          action={item}
          isOpen={toolOpenItems[item.id] ?? false}
          onToggle={() => toggleToolItem(item.id)}
        />
      </div>
    );
  }
```

Note: The `return` statement replaces the ternary pattern because we use curly braces for the block body.

 and `if`/`else if` structure.

 The rest of the timeline rendering stays text items continues as before.

- [ ] **Step 4: Commit**

```bash
git add components/message-bubble.tsx
git commit -m "feat: collapsible tool call cards with collapsed pills and expandable detail"
```

---

### Task 4: Seamless post-stream merge

**Files:**
- Modify: `components/chat-view.tsx:210-227` (syncConversationState)

- [ ] **Step 1: Add mergeMessages utility**

In `components/chat-view.tsx`, above `syncConversationState` (around line 210), add:

```tsx
function mergeMessages(local: Message[], server: Message[]): Message[] {
  if (local.length === 0) {
    return server;
  }

  const serverMap = new Map(server.map((m) => [m.id, m]));
  return local.map((localMsg) => {
    const serverMsg = serverMap.get(localMsg.id);
    if (!serverMsg) {
      return localMsg;
    }
    return { ...localMsg, ...serverMsg };
  });
}
```

What this does:
1. If local is empty (fresh page), return server messages
2. Build lookup map from server messages by ID
3. For each local message: if server has same ID, merge server fields onto local (preserves local streaming state). If no match, keep local message.
4. Return merged array

- [ ] **Step 2: Update syncConversationState to use merge**

In `components/chat-view.tsx`, line 223, replace:

```tsx
// BEFORE
setMessages(result.messages);

// AFTER
const merged = mergeMessages(messages, result.messages);
if (merged !== messages) {
  setMessages(merged);
}
```

This only calls `setMessages` if the merged result differs from current state, preventing unnecessary re-renders.

- [ ] **Step 3: Commit**

```bash
git add components/chat-view.tsx
git commit -m "fix: seamless post-stream merge to prevent conversation flash"
```

---

### Task 5: Visual validation

**Files:**
- All changed files

- [ ] **Step 1: Start dev server and verify in browser**

Start dev server:
```bash
lsof -i :3000
```
If a process found, kill it first, then start fresh: `npm run dev`
- Wait for ready, navigate to http://localhost:3000
- Verify:
  - Desktop: message bubbles fill ~90%+ of viewport
  - Tool calls: collapsed pills (fit-content, collapsed by default)
  - Click to expand tool calls: readable expanded state
  - Thinking cards: collapsed pills (fit-content, collapsed by default)
  - Mobile: full-width bubbles, tight padding
  - Send a message, observe smooth transition (no flash)
