# Attachment Modal Download Design

## Goal

Replace the attachment preview modal's `Open raw` action with a download action that prompts the browser to download the attachment instead of opening it inline. The behavior must work for image and text attachments on desktop and mobile.

## Current State

- The modal header action in `components/attachment-preview-modal.tsx` is an anchor labeled `Open raw`.
- The attachment route in `app/api/attachments/[attachmentId]/route.ts` serves attachment bytes with `Content-Disposition: inline`, which favors opening content in-browser instead of downloading it.
- Existing unit tests assert the presence of the raw-link action, and e2e coverage currently validates modal open/close behavior but not the header action semantics.

## Decision

Use the existing attachment `GET` route and add a download mode via the query string.

The modal action will link to `/api/attachments/<attachmentId>?download=1`. When `download=1` is present, the route will respond with `Content-Disposition: attachment; filename="..."`. Without that flag, the route will preserve its current inline behavior so image previews inside the modal continue to work.

This is the smallest change that preserves the preview path, keeps authentication behavior unchanged, avoids duplicating route logic, and gives mobile browsers the strongest signal to download rather than render inline.

## Route Changes

Update `app/api/attachments/[attachmentId]/route.ts` so the default binary response remains unchanged except for the addition of conditional content disposition logic:

- `format=text` continues to return JSON preview content exactly as it does today.
- Binary attachment responses inspect `download` from the request query string.
- If `download=1`, respond with `Content-Disposition: attachment; filename="<attachment.filename>"`, using the stored attachment filename.
- Otherwise, continue responding with `Content-Disposition: inline; filename="<attachment.filename>"`, again using the stored attachment filename.

No new route is needed. Authentication, ownership checks, and missing-file handling remain as-is.

## UI Changes

Update `components/attachment-preview-modal.tsx`:

- Replace the `Open raw` header action with a download action.
- The control text becomes `Download`.
- The accessible name becomes `Download attachment`.
- The control targets `/api/attachments/<attachmentId>?download=1`.
- Keep the control visible for all attachment types shown in the modal.

The modal layout stays otherwise unchanged. This is a behavior update, not a visual redesign.

## Mobile Behavior

Mobile support is achieved through the server response, not CSS or device-specific logic.

- Browsers that honor `Content-Disposition: attachment` will download directly.
- Browsers with stricter handling, especially mobile Safari, still receive the correct attachment response instead of an inline-only asset URL.
- No `target="_blank"` behavior should remain on the action, because the desired outcome is download, not opening a new tab.

## Testing Plan

Follow TDD for implementation:

1. Add or update a route-level test covering `download=1` and asserting the `Content-Disposition` header uses `attachment`.
2. Update the modal unit test in `tests/unit/message-bubble.test.ts` to assert the renamed action and new href.
3. Extend e2e coverage in `tests/e2e/features.spec.ts` so the modal action is asserted in at least one transcript attachment flow.
4. Run the targeted tests first, then the full required test suite to confirm no regressions and coverage compliance.

## Non-Goals

- No change to upload flows.
- No change to how inline image previews are loaded inside the modal.
- No new download manager UI, progress state, or toast.
- No change to attachment authorization rules.
