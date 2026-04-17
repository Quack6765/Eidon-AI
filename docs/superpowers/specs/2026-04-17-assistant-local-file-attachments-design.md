# Assistant Local File Attachments Design

## Goal

Allow the assistant to turn certain local filesystem references in its own response into normal conversation attachments, so outputs such as screenshots, logs, or generated files appear as first-class attachments in the transcript instead of raw local paths.

## Scope

Included:

- Infer assistant attachment intent from assistant-authored Markdown image and link targets
- Support local absolute file paths inside the workspace or `/tmp`
- Import eligible files into Eidon's managed attachment storage
- Bind imported files to the assistant message as normal `message_attachments`
- Remove successful local-path Markdown references from the visible assistant message body
- Append concise failure notes when requested files cannot be attached

Not included:

- Inferring attachments from bare plain-text file paths
- Inferring attachments from relative paths such as `./foo.png`
- Attaching files from app data directories
- Durable user approval state for out-of-bounds files
- New composer UI for assistant-created file uploads
- A new tool or explicit structured runtime attachment action in v1

## Product Rationale

ChatGPT and Gemini both treat files as first-class objects rather than as raw Markdown paths in normal message text. Their public product surfaces rely on explicit file add/upload/export actions, and generated artifacts are presented as files or downloadable outputs rather than inferred from ordinary text content.

Eidon should keep the same user-facing outcome, but can use a narrow inference pass internally to preserve a natural authoring experience for the assistant. The assistant may emit local-file Markdown such as:

- `![screenshot](/tmp/example.png)`
- `[build log](/tmp/build.log)`

The runtime then converts those references into normal attachments before the message is finalized. This keeps the transcript clean while avoiding a larger explicit attachment-action product surface in v1.

## Product Decisions

- Assistant-side attachment inference is post-processing on the finalized assistant response, not a renderer trick and not a client-side behavior.
- Only two source roots are allowed by default:
  - the current workspace root
  - `/tmp`
- App data directories are never allowed as inference sources.
- The policy is purely path-based in v1.
- If a referenced file is outside the allowed roots, Eidon must not attach it and must append a short note explaining that only workspace files and `/tmp` are allowed.
- The attachment store is a sink, not a source of privilege. Files are copied into managed storage only after the source path has passed validation.

## Trigger Rules

The inference pass scans only assistant-authored Markdown content and only for:

- image syntax: `![alt](target)`
- link syntax: `[label](target)`

Eligible targets must satisfy all of the following:

- the target is a local absolute path
- the target resolves to a regular file
- the resolved canonical path is inside the workspace root or `/tmp`
- the file type and size are valid under Eidon's existing attachment constraints

The runtime must ignore:

- `http:`, `https:`, `data:`, and `blob:` targets
- relative paths
- bare filesystem paths appearing in prose
- code blocks
- non-Markdown tool output or timeline content

## Message Presentation

Successful imports:

- If an image Markdown target is successfully imported, remove the original local-path image token from the assistant message body and render the image through the normal attachment gallery.
- If a Markdown file link is successfully imported, remove the original local-path link from the assistant message body and render the file through the normal attachment list.
- Normalize surrounding whitespace after stripping imported Markdown so the message still reads cleanly.

Failed imports:

- Do not fail the whole assistant turn.
- Append one concise note to the final assistant message summarizing any failures.
- Use compact user-facing text without raw stack traces or internal diagnostics.

Example note:

`Note: I couldn't attach /Users/.../secret.db because only workspace files and /tmp are allowed.`

## Architecture

This feature should be implemented as a focused post-processing step during assistant turn finalization.

### Runtime orchestration

`lib/assistant-runtime.ts` and `lib/chat-turn.ts` should remain responsible for turn orchestration, but they should delegate local-file attachment inference to a dedicated helper after the provider has produced the final answer text and before the assistant message is finalized.

That helper should return:

- sanitized assistant content
- imported attachment ids
- failure notes to append

The runtime then:

1. imports eligible files
2. binds attachment ids to the assistant message
3. persists sanitized content plus any appended failure note

### Feature helper

Add a dedicated helper module at `lib/assistant-local-attachments.ts` to own:

- Markdown target extraction
- local target classification
- path allowlist checks
- deduplication
- import orchestration
- content sanitization
- failure note generation

Keeping this logic isolated makes the feature unit-testable and prevents attachment-specific heuristics from leaking across the chat pipeline.

### Attachment storage

`lib/attachments.ts` should gain a dedicated local-file import primitive that:

- accepts a validated source path
- reads the file from disk
- enforces existing size and type rules
- copies bytes into managed attachment storage
- creates the attachment database row

The source-path allowlist should be enforced outside the low-level storage copy routine so storage remains reusable and does not own policy decisions.

### Markdown sanitization

`lib/assistant-image-markdown.ts` should evolve into a more general sanitization helper that can strip:

- local image Markdown successfully imported as attachments
- local file links successfully imported as attachments

Existing behavior for attachment-style images should remain intact.

## Security Model

Security must rely on canonical paths, not string prefixes.

Requirements:

- Canonicalize each source path before checking whether it is inside the workspace root or `/tmp`
- Reject symlink escapes
- Reject anything that is not a regular file
- Reject directories, FIFOs, sockets, device files, and other special filesystem entries
- Never special-case app data or managed attachment storage as trusted source roots
- Do not infer attachments from plain prose, only from explicit Markdown image/link targets

The design deliberately avoids permitting internal app storage because the app data directory may contain the SQLite database and other sensitive runtime state, especially in Docker deployments.

## Error Handling

The assistant turn should degrade gracefully.

Cases to handle:

- missing file
- unreadable file
- unsupported file type
- oversize file
- disallowed path
- duplicate references to the same file in one message

Rules:

- Partial success is allowed.
- Import each unique eligible file at most once per assistant message.
- Strip all matching successful references from the visible message body.
- Aggregate failures into one appended note where practical.
- If the inference helper itself fails unexpectedly, preserve the assistant response and append a generic attachment-processing note rather than failing the entire turn.

## Testing Plan

### Unit tests

Add focused unit tests for the local-attachment helper covering:

- workspace file imported from Markdown link
- `/tmp` file imported from Markdown image
- external URLs ignored
- relative paths ignored
- successful references stripped from content
- out-of-bounds path produces denial note
- symlink escape rejected after canonicalization
- duplicate references deduplicated

### Integration tests

Add turn-finalization coverage ensuring:

- assistant attachments are bound to the persisted assistant message
- assistant content is sanitized before final persistence
- failure notes are appended without aborting the turn
- existing attachment preview/download routes continue to work for assistant-imported files

### UI validation

Validate end-to-end that:

- an assistant-emitted local image path becomes a normal attachment tile/gallery item
- an assistant-emitted local file link becomes a normal file attachment tile
- no successful local filesystem path remains visible in rendered assistant Markdown
- failure notes render cleanly when a file is denied

## Non-Goals

- No change to user attachment uploads
- No change to attachment authorization for user-driven API routes
- No new assistant tool for attachment creation in v1
- No support for app-data-sourced attachments
- No persistent approval mechanism for arbitrary external file paths
