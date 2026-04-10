# Thinking Output Card Text Styling

**Date:** 2026-04-10
**Status:** Draft

## Problem

The expanded thinking area in the assistant thinking shell currently uses the same general markdown presentation style as normal assistant answers. That makes the reasoning content feel too polished and prominent relative to the tool output logs, which already communicate a quieter, more utilitarian tone through smaller and greyer text.

The goal is to make only the expanded thinking text feel closer to the tool output log styling while preserving markdown rendering and leaving the rest of the thinking shell unchanged.

## Design

### Recommended Approach

Introduce a dedicated compact markdown style for the expanded thinking content only.

Keep the existing `ReactMarkdown` rendering path in `components/message-bubble.tsx`, but swap the wrapper class from the generic markdown styling to a thinking-specific compact markdown class. Define the supporting styles in `app/globals.css`.

### Behavior

- The thinking shell header row remains unchanged.
- The expanded thinking area continues to render markdown via `ReactMarkdown`.
- The expanded thinking text becomes smaller and lower contrast, visually closer to the tool output logs.
- The expanded thinking text remains proportionally spaced, not monospaced.
- Lists, headings, emphasis, inline code, and links continue to render as markdown.
- Standard assistant message bubble markdown styling remains unchanged.

### Styling Direction

- Use a dedicated class such as `.thinking-markdown-body` for the expanded thinking content.
- Reduce the base font size relative to `.markdown-body`.
- Lower text contrast to a muted grey that aligns with the tool log tone.
- Tighten paragraph and list spacing so the content reads as denser supporting detail rather than primary output.
- Keep headings and emphasis readable, but tone them down from the main assistant markdown treatment.
- Do not adopt the tool log `pre` block layout, background, padding, or monospaced font.

### Scope

- Update the expanded thinking wrapper in `components/message-bubble.tsx`.
- Add the compact thinking markdown style rules in `app/globals.css`.

## Testing

- Verify that expanding the thinking shell still renders markdown correctly.
- Verify that the expanded thinking text is visually smaller and greyer, closer to the tool output logs.
- Verify that normal assistant message bubble markdown styling is unchanged.
- Validate the updated thinking shell in the browser and capture a screenshot.

## Out of Scope

- Changing the collapsed thinking shell header
- Changing tool output log styling
- Making the thinking text monospaced
- Changing normal assistant message bubble typography
- Refactoring message timeline rendering beyond the thinking content wrapper
