# Clipboard Image Paste in Chat Input

## Summary

Allow users to paste images from their clipboard (Cmd/Ctrl+V) directly into the chat text input bar. Pasted images are treated identically to files uploaded via the attachment button — uploaded to the server, shown in the pending attachment preview bar, and sent with the message on submit.

## Scope

- Direct clipboard image files only (screenshots, copied image files)
- No HTML clipboard parsing (no extracting base64 images from rich content)

## Architecture

### Approach

Add an `onPaste` handler to the `<textarea>` in `ChatComposer`. No new components, props, state, or backend changes.

### Data Flow

```
User presses Cmd/Ctrl+V with image in clipboard
  → Browser fires paste event on <textarea>
  → onPaste handler checks e.clipboardData.files
  → Filters for image/* MIME types
  → Calls existing onUploadFiles(imageFiles) prop
  → Existing flow: uploadFiles() → POST /api/attachments → pendingAttachments state
  → Image appears in preview bar, sent with message on submit
```

### Component Change

**File:** `components/chat-composer.tsx`

Add `onPaste` handler to the `<textarea>` that:
1. Reads `e.clipboardData.files` from the `ClipboardEvent`
2. Filters to only image files (`file.type.startsWith("image/")`)
3. If no image files found, returns early (default text paste behavior)
4. Calls `onUploadFiles(filteredFiles)` — the existing prop already wired to `ChatView.uploadFiles()`

## Edge Cases

| Case | Behavior |
|------|----------|
| Text paste | No image files → default browser text insertion |
| Multiple images | All passed to `uploadFiles()`, same as multi-file picker |
| Mixed text + image | Only image files extracted; text paste proceeds normally |
| Non-image files | Filtered out by `image/*` MIME type check |
| Upload failure | Handled by existing error handling in `uploadFiles()` |

## Files Modified

- `components/chat-composer.tsx` — add `onPaste` handler to textarea
