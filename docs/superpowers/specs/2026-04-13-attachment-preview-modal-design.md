# Attachment Preview Modal Design

## Summary

Replace the current attachment link behavior in chat bubbles with a centered in-app preview modal for all attachment clicks across desktop, mobile, and the PWA. The modal should open images inline, render text-like files such as `txt`, `md`, and `json` in a large read-only viewer, and provide a clear close path without relying on browser history or the system back gesture.

This is a transcript attachment viewing change only. It does not introduce broader document management, pending-upload preview changes, or a new navigation pattern.

## Goals

- Eliminate the mobile/PWA dead-end caused by opening attachments inside the app without an obvious return path
- Use one consistent attachment interaction model everywhere instead of splitting desktop and mobile behavior
- Support inline preview for both image attachments and common text-like files
- Keep the preview experience modal and explicit, with a visible close affordance

## Non-Goals

- Add browser-history integration or system-back handling for the preview state
- Build a full document viewer platform for every file type
- Add preview support to pending composer attachments before a message is sent
- Redesign transcript attachment tiles beyond the click behavior needed to open the modal

## Product Decisions

### Interaction model

- Clicking any persisted attachment tile in a chat bubble opens a centered modal inside the app
- The modal uses the same interaction model on desktop, mobile browsers, and the installed PWA
- Closing is modal-style only:
  - `X` button
  - backdrop click
  - `Esc`
- Closing is not tied to browser history, navigation state, or system back gestures

### Content rendering

- Image attachments render inline in the modal body using the existing authenticated attachment route
- Text-like attachments render inline as plain read-only text in a large scrollable viewer
- Initial inline text-preview support should explicitly cover:
  - `text/plain`
  - `text/markdown`
  - `application/json`
  - equivalent trusted text extensions already stored as text attachments
- Unsupported file types still open the modal, but show a preview-unavailable fallback with raw-open/download actions

### Header actions

- The modal header includes:
  - an explicit close control on the left
  - filename and type metadata
  - an action to open or download the raw attachment
- The raw-open/download action remains available even when inline preview succeeds

## UX Design

### Modal shell

Use a centered modal rather than a side sheet or full-bleed gallery. The centered shell is the simplest way to preserve one mental model across image and text attachments while staying compact enough for the existing chat experience.

The body should prioritize the preview itself:

- images scale to fit within the modal body without forcing navigation away from the transcript
- text-like files render in a non-editable text surface with preserved whitespace, internal scrolling, and monospace styling suited for plain text, markdown, and JSON

### Fallback states

The preview surface must not trap the user when rendering fails or a file type is unsupported.

Required fallback states:

- **Loading:** visible while text content is being fetched
- **Preview unavailable:** shown for unsupported file types
- **Preview failed:** shown when inline fetching or rendering fails

Each fallback should preserve:

- the close control
- the raw-open/download action
- a retry affordance for fetch failures

## Implementation Shape

### Primary change surface

The primary UI implementation surface is:

- [components/message-bubble.tsx](/Users/charles/conductor/workspaces/Eidon-AI/buffalo/components/message-bubble.tsx)

That component already owns transcript attachment rendering through `AttachmentTile` and `MessageAttachments`, so the modal state and click handling should stay close to that code instead of introducing a new global preview system.

### State model

Introduce a small attachment-preview state local to the message-bubble attachment rendering flow:

- selected attachment metadata
- whether the modal is open
- text preview loading state
- text preview content or error state

This can stay local to the transcript attachment tree unless reuse becomes necessary later.

### Data loading

The app already has enough metadata to decide how to render the selected attachment. Only text-like previews need client-side body loading.

Implementation direction:

- images keep using `/api/attachments/[attachmentId]` directly as the preview source
- text-like files fetch attachment body on demand when the modal opens
- fetched text should be cached in-memory for the active client session so reopening the same file does not immediately refetch

If the existing attachment route proves awkward for text-body fetching in the client, the implementation may add a narrowly-scoped text-preview response path or companion endpoint. That should remain limited to the preview feature and not broaden into generalized attachment APIs.

### Attachment type handling

Do not infer previewability from arbitrary MIME strings alone. Use a conservative allowlist based on the app’s current attachment model:

- image attachments: inline image preview
- known text-like attachments: inline text preview
- everything else: preview-unavailable fallback

This keeps the first iteration predictable and avoids malformed binary data being treated as readable text.

## States And Edge Cases

- Opening an attachment should no longer navigate to a new tab or new in-app document view
- The modal must handle repeated open/close cycles cleanly
- Very large text attachments should remain scrollable within the viewer rather than expanding the modal indefinitely
- Failed preview fetches must not leave the modal blank or uncloseable
- Unsupported attachment types should still expose a useful action path through raw open/download
- The feature is scoped to persisted message attachments only, not pending composer uploads

## Testing

Add regression coverage for both rendering and interaction.

### Unit coverage

- Verify clicking an image attachment opens the modal
- Verify clicking a text attachment opens the modal
- Verify image attachments render an image preview body
- Verify text-like attachments render a read-only text viewer after loading
- Verify the modal closes via:
  - `X`
  - backdrop click
  - `Esc`
- Verify unsupported files render the preview-unavailable fallback
- Verify preview failures render an error state with retry support

### End-to-end coverage

Extend the chat attachments feature coverage in:

- [tests/e2e/features.spec.ts](/Users/charles/conductor/workspaces/Eidon-AI/buffalo/tests/e2e/features.spec.ts)

Scenarios to validate:

- send a chat with an image attachment, open it from the transcript, verify the modal appears, then close it
- send a chat with a text attachment, open it from the transcript, verify inline content appears, then close it

### Browser validation

Because the original bug is specific to mobile/PWA behavior, manual browser validation should explicitly include:

- desktop browser viewport
- narrow mobile viewport
- installed or standalone-oriented PWA flow if available in local testing

Confirm that the preview always opens in-app and always exposes a visible close path.

## Risks

- The main implementation risk is client-side text preview loading if the existing attachment response shape is not convenient for inline text reading
- A secondary risk is overextending support to too many file types too early; the first version should stay conservative
- Another risk is introducing a modal shell that visually diverges from the rest of the app; implementation should follow existing overlay conventions where possible without broad redesign
