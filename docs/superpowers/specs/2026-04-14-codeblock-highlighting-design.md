# Assistant Code Block Highlighting

**Date:** 2026-04-14
**Status:** Draft

## Problem

Assistant answer bubbles currently render fenced code blocks through the same generic markdown styles as the surrounding prose. That means code blocks are readable, but they are not syntax-highlighted by language and there is no way to copy only a single block without copying the entire assistant message.

The goal is to improve code blocks inside assistant answer bubbles so they:

- render with real syntax highlighting when possible
- support many languages, not just the app stack
- expose a compact block-local copy action
- preserve the existing message-level copy behavior
- leave the expanded thinking panel unchanged

## Recommended Approach

Keep the existing `ReactMarkdown` rendering path in [components/message-bubble.tsx](/Users/charles/conductor/workspaces/Eidon-AI/atlanta/components/message-bubble.tsx), but add a custom fenced-code renderer for assistant answer bubbles only.

Use a dedicated `AssistantCodeBlock` component that owns:

- fence language parsing and normalization
- best-effort auto-detection when no language is declared
- syntax-highlighted rendering for supported languages
- graceful fallback to plain code for unsupported or ambiguous cases
- a compact per-block copy button with local copied/error feedback

Do not apply this renderer to the expanded thinking panel. Thinking content should continue using the existing compact markdown wrapper and generic markdown code treatment.

## Rendering Architecture

### Assistant answers

Assistant answer bubbles should continue rendering through `ReactMarkdown`, but with a custom `components.code` renderer:

- inline code spans continue using the existing markdown inline code styles
- fenced multi-line blocks route to `AssistantCodeBlock`
- prose, lists, tables, links, and all other markdown elements stay on the current rendering path

This keeps the change isolated to assistant answer code blocks without forking the broader markdown system.

### Thinking output

The expanded thinking shell must remain unchanged:

- no syntax highlighting
- no code-block-local copy button
- no new language label or code chrome

This preserves the current distinction between primary answer output and quieter thinking content.

## Code Block Behavior

Each fenced code block in an assistant answer bubble should render inside a compact block container with two parts:

1. A top bar
2. The highlighted code body

### Top bar

The top bar should include:

- a language label on the left when a declared or detected language is available
- a compact copy button on the right

The top bar should feel like part of the code block rather than a separate floating control. Keep spacing tight and visual treatment restrained so the block still fits the existing bubble design.

### Copy interaction

The copy button should:

- copy only the raw code content of that fenced block
- exclude the backticks, language fence label, and surrounding answer text
- follow the same feedback model as the existing message copy action
- briefly show copied or error state after interaction

Visibility rules should match the current message action behavior:

- desktop: reveal on hover and focus within the block group
- mobile and non-hover environments: keep the control visible

The existing message-level copy button must remain unchanged and continue copying the full assistant answer text.

## Language Resolution

### Declared language

If the markdown fence declares a language, use it first.

Normalize common aliases before passing them into the highlighter so the UI behaves consistently for frequent model outputs. This should include common mappings such as:

- `js` -> `javascript`
- `ts` -> `typescript`
- `py` -> `python`
- `sh` or `zsh` -> `bash` or shell-compatible highlighting
- `yml` -> `yaml`

The displayed label can remain compact and human-readable, such as `tsx`, `python`, or `sql`.

### Auto-detection

If no language is declared, attempt best-effort auto-detection across the supported language set.

Auto-detection should only affect the rendering choice for that block. It should not change the source markdown, store metadata, or mutate message content.

### Fallback behavior

If the declared language is unsupported, or auto-detection is weak or unavailable:

- render the code block as plain text code
- keep the same code block chrome and copy button
- do not throw or break rendering

Unknown languages must degrade gracefully instead of failing the message render path.

## Styling Direction

The code block should feel like a natural extension of the current dark assistant bubble styling:

- compact top bar with subtle separation from the code body
- dark background with readable contrast
- restrained border and radius values consistent with the rest of the chat UI
- token colors driven by the syntax theme rather than extra decorative UI

Do not:

- add large floating shells
- add oversized rounded corners
- add decorative badges or extra labels
- restyle the whole markdown surface around the code block

The change should improve scanability and utility, not create a new visual subsystem.

## Scope

In scope:

- custom fenced-code rendering for assistant answer bubbles
- syntax highlighting for supported languages
- best-effort auto-detection for untagged fenced blocks
- per-block copy button for fenced multi-line code blocks
- supporting styles and tests

Out of scope:

- changing inline code behavior
- changing the expanded thinking panel
- changing tool output log styling
- changing the existing message-level copy action
- rewriting the overall markdown system

## Testing

Follow TDD for the behavior change in [tests/unit/message-bubble.test.ts](/Users/charles/conductor/workspaces/Eidon-AI/atlanta/tests/unit/message-bubble.test.ts).

Coverage should include:

- fenced assistant code blocks rendering through the custom block renderer
- declared language labels rendering correctly
- untagged blocks taking the auto-detect path without breaking
- unsupported or unknown languages degrading to plain code rendering
- block copy writing only the code content for that block
- thinking markdown remaining unchanged
- message-level copy continuing to work

After implementation:

- run targeted unit tests first
- run the full test suite with coverage
- verify any required typecheck or lint commands
- validate the UI in the browser
- capture a screenshot of the updated assistant answer bubble with highlighted code
- verify the per-block copy interaction in the browser

## Risks And Mitigations

### Bundle growth

Real syntax highlighting and auto-detection can increase client bundle weight.

Mitigation:

- choose a highlighting path with broad language support but controlled footprint
- keep the custom renderer scoped to fenced assistant blocks only

### Detection ambiguity

Auto-detection can guess incorrectly for short or generic snippets.

Mitigation:

- prefer declared fence languages over detection
- fall back to plain text rendering when confidence or support is weak

### UI clutter

Adding another copy control risks visual noise inside already dense message bubbles.

Mitigation:

- keep the button small
- match existing hover/focus behavior
- avoid extra helper text or ornamental chrome
