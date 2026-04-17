# Assistant Inline Image Attachments Design

## Goal

Prevent assistant responses from streaming large base64 image payloads into the transcript while still allowing assistant-produced images to appear inline in the chat bubble.

The assistant should be able to show images inline, but the bytes must travel through Eidon's attachment system rather than through model output tokens.

## Scope

Included:

- Render assistant image attachments inline in the message bubble
- Keep the existing attachment preview modal and download flow for inline-rendered images
- Suppress the separate image attachment tile when that image is already rendered inline
- Forbid assistant-visible `data:image/...;base64,...` payloads in persisted/rendered assistant text
- Add a runtime fallback that converts assistant-authored Markdown `data:` images into normal attachments without persisting the raw base64 text
- Strengthen assistant/runtime guidance so screenshots and similar image outputs are attached instead of shell-encoded into message text

Not included:

- Changing user attachment rendering
- Changing text/file attachment rendering
- A new explicit assistant tool for image attachment creation
- Replacing the attachment preview modal
- Changing provider-side image input encoding for model consumption in this iteration

## Problem

The current runtime allows a bad path:

1. The assistant creates a local screenshot file
2. The assistant shells out to base64-encode that file
3. The assistant emits Markdown like `![alt](data:image/png;base64,...)`
4. The model streams the entire base64 payload as ordinary assistant text

That is slow, token-expensive, and unnecessary. The image should be treated as a binary artifact owned by the runtime, not as text owned by the model stream.

## Product Decisions

- Assistant images should render inline from normal `message_attachments`, not from raw Markdown `data:` URLs.
- The existing attachment preview modal remains the single detailed image-view surface.
- Clicking an inline-rendered assistant image opens the same modal used by attachment tiles today.
- The modal continues to expose the same attachment download action.
- Assistant image attachments should not also render as duplicate image tiles underneath the bubble.
- Text/file attachments continue to render as file tiles.
- Assistant-authored `data:image/...;base64,...` content must never remain in persisted or rendered assistant transcript text.

## Rendering Model

Assistant message rendering should distinguish between image attachments and non-image attachments:

- image attachments:
  - render inline in the assistant bubble
  - open the attachment preview modal on click
  - do not render duplicate image tiles below the message
- text/file attachments:
  - continue rendering as attachment tiles
  - retain the current preview and download behavior

This means inline assistant images are an alternate presentation of the existing attachment record, not a new storage class.

## Runtime Fallback For `data:` Images

The runtime should add a narrow salvage path for assistant-authored Markdown images whose target is a `data:image/...;base64,...` URL.

Behavior:

1. Detect Markdown image tokens whose target is a supported image `data:` URL.
2. Decode the base64 payload server-side after the provider finishes the turn.
3. Materialize the image as a normal attachment in managed storage.
4. Bind the attachment to the assistant message.
5. Remove the original `data:` Markdown token from assistant text before persistence/rendering.

If salvage fails:

- do not persist the raw base64 content
- strip the `data:` image token from visible assistant text
- append a concise note that the inline image could not be attached

This fallback is a safety net, not the preferred path.

## Preferred Assistant Behavior

The preferred path remains:

- assistant creates or references a local image file
- runtime imports that file into managed attachment storage
- assistant message renders the resulting attachment inline

The assistant should be explicitly discouraged from:

- running `base64` on screenshot/image files
- embedding `data:` image URLs in normal response text
- describing a local screenshot as inline image markdown unless the runtime can convert it into an attachment

## Architecture

### Assistant local attachment inference

`lib/assistant-local-attachments.ts` should expand beyond local-path imports to also recognize supported image `data:` URLs in Markdown image syntax.

It should return:

- sanitized assistant content
- imported attachment records
- failure note text

### Attachment storage

`lib/attachments.ts` should gain a small helper to create an attachment from decoded in-memory bytes so the runtime can salvage `data:` images without first writing them back to disk.

That helper should:

- accept filename, mime type, and bytes
- enforce the same size/type constraints as normal attachments
- write into managed attachment storage
- create the normal `message_attachments` row

### Assistant message sanitization

`lib/assistant-image-markdown.ts` should be extended so assistant-rendered text strips:

- local-path Markdown images already imported as attachments
- local-path Markdown links already imported as attachments
- assistant-authored image `data:` URLs after salvage or denial

No raw `data:` image markdown should survive into the final rendered assistant text.

### Assistant rendering

`components/message-bubble.tsx` should change assistant attachment presentation:

- render image attachments inline in the assistant bubble
- reuse the existing preview controller and modal when clicked
- keep non-image attachments in the existing attachment list
- avoid showing duplicate image tiles

User messages should keep their current compact attachment tile presentation.

## Security And Safety

- Only image `data:` URLs are eligible for salvage.
- Only supported attachment image mime types are eligible.
- Base64 payloads must be size-checked after decode using normal attachment limits.
- Invalid or malformed base64 must be rejected without surfacing the payload.
- Raw base64 should not be persisted in `messages.content` or `message_text_segments`.

This prevents transcript bloat and avoids turning the message log into a binary transport.

## Error Handling

If inline image salvage fails:

- remove the `data:` token from visible assistant text
- do not create an attachment
- append a short note such as:

`Note: I couldn't attach one inline image because the image data could not be imported.`

If multiple inline images fail, aggregate them into one note.

## Testing Plan

### Unit tests

Add coverage for:

- assistant `data:` image markdown is converted into an attachment and stripped from content
- malformed `data:` image markdown is stripped and produces a failure note
- oversize `data:` image payload is rejected with a failure note
- local-path image attachments still sanitize correctly
- rendered assistant text excludes raw base64/data URLs once attachments exist

### UI tests

Add component coverage ensuring:

- assistant image attachments render inline
- clicking the inline image opens the existing preview modal
- image tiles are not duplicated below the assistant message
- file attachments still render as tiles

### End-to-end validation

Validate a real assistant turn where the final assistant response contains:

- a local image reference converted to attachment
- a `data:` image fallback converted to attachment

And confirm:

- no raw base64 appears in the rendered transcript
- the image is visible inline
- the preview modal opens
- the download action still works

## Non-Goals

- No change to how models receive attached images as input today
- No attempt to stop every possible binary-to-text misuse in arbitrary shell output
- No replacement of the existing modal/download UX
- No redesign of the attachment API surface
