# Context Usage Gauge Design

## Overview

Add a circular progress gauge to the chatbox toolbar that shows context usage relative to the model's compaction threshold. The gauge helps users understand how much of their available context window is being used and when compaction is imminent.

## Requirements

- Display a circular gauge showing percentage of usable context consumed
- Show used tokens, usable limit, and max context on hover/tap
- Update after each message completes streaming
- Update after compaction to reflect reduced context usage
- Color-coded thresholds to indicate urgency
- Work on both desktop (hover) and mobile (tap)

## Visual Design

### Gauge Style

A small circular progress indicator (20px diameter) with a fill that animates clockwise. The gauge shows the percentage of usable context consumed, where usable context = `modelContextLimit × compactionThreshold`.

### Color Thresholds

| Usage Percentage | Color | Meaning |
|------------------|-------|---------|
| 0-50% | Green (`#22c55e`) | Plenty of context available |
| 50-70% | Yellow (`#eab308`) | Context filling up, no action needed |
| 70-78%+ | Red (`#ef4444`) | Compaction imminent at 78% threshold |

Note: Red appears before the 78% compaction threshold to give users advance warning.

### Label

A small text label next to the gauge showing used tokens in thousands (e.g., "52K").

### Tooltip/Info Popup

Compact format displayed on hover (desktop) or tap (mobile):

```
52K used
80K usable (80% of 100K)
```

Where:
- **52K used** = current `inputTokens` from usage event
- **80K usable** = `modelContextLimit × compactionThreshold`
- **100K** = `modelContextLimit` (total model context)

### Placement

In `ChatComposer`, left side of the bottom toolbar:
- After the attachment, web search, and model selection buttons
- Separated by a vertical divider from the buttons
- Before the "Tool Selection" indicator on the right side

### Visibility

The gauge only appears when:
- There is at least one message in the conversation (not on empty chat)

## Interaction

### Desktop

- Hover over gauge to show tooltip
- Tooltip dismisses when mouse leaves the gauge area

### Mobile

- Tap gauge to toggle tooltip visibility
- Tap anywhere outside the tooltip to dismiss
- No hover state on mobile

## Data Flow

### Token Calculation

```
usedTokens = usage.inputTokens (from provider after stream completes)
usableLimit = modelContextLimit × compactionThreshold
maxLimit = modelContextLimit
percentage = (usedTokens / usableLimit) × 100
```

### Update Timing

1. **After message stream completes:** When the `usage` event arrives from the provider, update `usedTokens`
2. **After compaction:** The compaction process reduces context, so the next usage event will reflect lower tokens

### Data Sources

- `modelContextLimit`: From `ProviderProfile` settings for the conversation
- `compactionThreshold`: From `ProviderProfile` settings (default 0.78)
- `inputTokens`: From `ChatStreamEvent` type `usage` field

## Architecture

### State Management

Add state in `ChatView` to track:
- `usedTokens: number | null` — current token usage, null if no usage data yet

Pass to `ChatComposer`:
- `usedTokens`
- `modelContextLimit`
- `compactionThreshold`

### Components

**New component:** `ContextGauge` in `components/context-gauge.tsx`

Props:
- `usedTokens: number` — tokens used
- `usableLimit: number` — usable context limit
- `maxLimit: number` — total model context limit
- `visible: boolean` — whether to show the gauge

Renders:
- Circular SVG progress indicator
- Token label
- Tooltip/info popup on hover/tap

### Event Handling

In `ChatView.handleDelta()`:
- When `event.type === "usage"`, extract `inputTokens` and update state
- Pass state to `ChatComposer`

In `ChatComposer`:
- Pass props to `ContextGauge`
- Handle visibility based on message count

## Files to Change

| File | Change |
|------|--------|
| `components/context-gauge.tsx` | New component for circular gauge with tooltip |
| `components/chat-composer.tsx` | Add gauge to toolbar, handle visibility |
| `components/chat-view.tsx` | Track token usage, pass to ChatComposer |
| `lib/types.ts` | Ensure usage event type has `inputTokens` |
| `app/globals.css` | Gauge styling, color variables, animations |

## Implementation Notes

### CSS Approach

Use CSS custom properties for gauge colors:
- `--gauge-green: #22c55e`
- `--gauge-yellow: #eab308`
- `--gauge-red: #ef4444`

SVG circle stroke-dasharray for circular progress:
- Circumference = 2πr
- Stroke dash offset = circumference × (1 - percentage/100)

### Accessibility

- Add `aria-label` describing context usage
- `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- Tooltip content available to screen readers

### Edge Cases

- **No usage data yet:** Don't show gauge until first usage event
- **Very large token counts:** Format as "1.2M" for millions
- **Missing profile settings:** Use default values (128K context, 78% threshold)

## Testing

### Unit Tests

- `ContextGauge` renders with correct percentage
- Color changes based on threshold
- Tooltip shows correct format
- Handles missing/zero values gracefully

### Integration Tests

- Gauge updates after message stream completes
- Gauge updates after compaction
- Visibility based on conversation state

### Manual Testing

- Desktop hover behavior
- Mobile tap-to-toggle behavior
- Color transitions at threshold boundaries
- Compaction cycle: high usage → compaction → lower usage