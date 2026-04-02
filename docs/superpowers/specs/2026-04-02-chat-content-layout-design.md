# Chat Content Layout Redesign

**Date:** 2026-04-02
**Status:** Draft

## Problem

The chat interface has five layout issues:

1. **Desktop horizontal space underused** — message column capped at `max-w-5xl` (1024px), bubbles further limited to 82% of that (~840px). On a 1920px screen, ~55% of width is empty.
2. **Tool call cards too wide and not collapsible** — tool calls stretch to full column width showing truncated content. No way to collapse them.
3. **Thinking cards also too wide** — same issue as tool calls when collapsed.
4. **Conversation flash on stream complete** — `syncConversationState()` replaces the entire message array after SSE stream ends, causing a visible re-render of all messages.
5. **Mobile layout not optimized** — only 2% width difference between mobile (84%) and desktop (82%). No density optimizations.

## Design

### 1. Fluid Content Column (Approach A)

Remove the fixed `max-w-5xl` column constraint. Content fills ~90% of available viewport width with small margins.

**Desktop (md+):**
- Message scroll area: `w-full px-8` (remove `max-w-5xl`, add comfortable side padding)
- User bubbles: `max-w-[95%]`, right-aligned
- Assistant bubbles: `max-w-[95%]`, left-aligned with avatar
- Composer: remove `max-w-[980px]`, let it match the message column width

**Mobile (below md):**
- Message scroll area: `px-2` (minimal side padding)
- Bubbles: `max-w-[96%]` (nearly edge-to-edge)
- Bubble padding: `px-2.5 py-2` (reduced from `px-4 py-3`)
- Expanded cards: full width of message column
- Vertical gaps: `gap-2.5` (reduced from `gap-4`)
- Bottom padding: `pb-[140px]` (reduced from `pb-[160px]`)

### 2. Collapsible Cards — Tool Calls & Thinking

Both tool call cards and thinking cards follow the same collapse/expand pattern.

**Collapsed state (default):**
- Width: `fit-content` — just enough for icon + label + chevron
- Content: status icon + label text only (e.g., "Web Search" or "Thought (2.3s)")
- Chevron: right-pointing (`ChevronRight`) indicating expandability
- Not clickable during running state (content not ready yet)

**Expanded state (on click):**
- Width: stretches to the assistant bubble max-width (matching the message content area)
- Header row: same as collapsed (icon + label + down chevron `ChevronDown`)
- Content area:
  - **Tool calls**: raw content (action.detail, action.resultSummary) rendered as-is in a monospace code block with line wrapping — not parsed or formatted
  - **Thinking**: markdown text (existing rendering behavior, smaller font, lower opacity)

**States:**
- Running: spinner icon, collapsed only (not expandable)
- Completed: green check icon, collapsed by default, click to expand
- Error: red X icon, same collapse/expand behavior

**Implementation:**
- Add `toolOpen` state to `MessageBubble` (parallel to existing `thinkingOpen`)
- `MessageActionRow` becomes collapsible: collapsed renders a pill, expanded renders a wider card
- Reuse the same toggle pattern as the thinking card
- Tool call detail/result content goes into the expanded content area

### 3. Seamless Post-Stream Merge

Replace the current `syncConversationState()` flash with a silent merge.

**Current flow:**
```
Stream ends → fetch all messages → setMessages(result.messages) → full re-render flash
```

**New flow:**
```
Stream ends → fetch all messages → mergeMessages(local, server) → only patch if diff → no visible change
```

**`mergeMessages(local, server)` utility:**
1. Compare server messages against current local state by `id`
2. For the streaming assistant message (the one that just completed): shallow-merge server metadata (timestamps, etc.) onto the existing local message object — preserve content, timeline, thinking state
3. For all other messages: keep the local version unchanged (they haven't changed during streaming)
4. Only call `setMessages()` if the merged result differs from current state
5. Update title and debug state separately (already separate state variables)

**`router.refresh()` calls** for sidebar updates remain unchanged — those only affect the server component tree.

## Files Changed

| File | Changes |
|------|---------|
| `components/chat-view.tsx` | Remove `max-w-5xl`, update padding, implement `mergeMessages()`, update `syncConversationState()` |
| `components/message-bubble.tsx` | Add `toolOpen` state, make `MessageActionRow` collapsible, update widths, reduce padding on mobile |
| `components/home-view.tsx` | Update composer width to match new fluid layout |

## Out of Scope

- Sidebar layout changes
- Composer redesign
- New animations or transitions on card expand/collapse
- Streaming performance optimization
