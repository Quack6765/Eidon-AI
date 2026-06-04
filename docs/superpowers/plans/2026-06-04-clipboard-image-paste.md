# Clipboard Image Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to paste images from clipboard into the chat input bar, treating them identically to file-upload attachments.

**Architecture:** Add an `onPaste` handler to the `<Textarea>` in `ChatComposer` that extracts image `File` objects from `clipboardData.files` and passes them to the existing `onUploadFiles` prop. No new state, props, components, or backend changes.

**Tech Stack:** React, TypeScript, Vitest, @testing-library/react

---

### Task 1: Add failing test for clipboard image paste

**Files:**
- Test: `tests/unit/chat-composer.test.tsx`

- [ ] **Step 1: Write the failing test**

Add the following test to `tests/unit/chat-composer.test.tsx` inside a new `describe` block, after the existing `describe("ChatComposer collapsible toolbar", ...)` block:

```tsx
describe("ChatComposer clipboard image paste", () => {
  it("calls onUploadFiles when an image is pasted from clipboard", () => {
    const onUploadFiles = vi.fn();
    renderComposer({ onUploadFiles });

    const textarea = screen.getByRole("textbox");

    const imageFile = new File(["fake-image-bytes"], "screenshot.png", { type: "image/png" });
    const clipboardEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    clipboardEvent.clipboardData!.items.add(imageFile);

    fireEvent(textarea, clipboardEvent);

    expect(onUploadFiles).toHaveBeenCalledOnce();
    expect(onUploadFiles).toHaveBeenCalledWith([imageFile]);
  });

  it("does not call onUploadFiles when text is pasted", () => {
    const onUploadFiles = vi.fn();
    renderComposer({ onUploadFiles });

    const textarea = screen.getByRole("textbox");

    const clipboardEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    clipboardEvent.clipboardData!.setData("text/plain", "hello");

    fireEvent(textarea, clipboardEvent);

    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it("does not call onUploadFiles when non-image files are pasted", () => {
    const onUploadFiles = vi.fn();
    renderComposer({ onUploadFiles });

    const textarea = screen.getByRole("textbox");

    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const clipboardEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    clipboardEvent.clipboardData!.items.add(textFile);

    fireEvent(textarea, clipboardEvent);

    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it("filters to only image files when mixed content is pasted", () => {
    const onUploadFiles = vi.fn();
    renderComposer({ onUploadFiles });

    const textarea = screen.getByRole("textbox");

    const imageFile = new File(["fake-image-bytes"], "photo.jpg", { type: "image/jpeg" });
    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const clipboardEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    clipboardEvent.clipboardData!.items.add(imageFile);
    clipboardEvent.clipboardData!.items.add(textFile);

    fireEvent(textarea, clipboardEvent);

    expect(onUploadFiles).toHaveBeenCalledOnce();
    expect(onUploadFiles).toHaveBeenCalledWith([imageFile]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/chat-composer.test.tsx`
Expected: The new "calls onUploadFiles when an image is pasted from clipboard" test FAILS because the textarea has no `onPaste` handler — `onUploadFiles` is never called.

---

### Task 2: Implement the onPaste handler

**Files:**
- Modify: `components/chat-composer.tsx:432-453` (the `<Textarea>` element)

- [ ] **Step 1: Add the onPaste handler to the Textarea**

In `components/chat-composer.tsx`, add an `onPaste` prop to the `<Textarea>` component (around line 432). The handler goes right after the existing `onKeyDown` prop. Add this to the `<Textarea>` element:

```tsx
onPaste={(event) => {
  const files = Array.from(event.clipboardData.files);
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));

  if (imageFiles.length > 0) {
    void onUploadFiles(imageFiles);
  }
}}
```

The full `<Textarea>` element should now look like:

```tsx
<Textarea
  ref={textareaRef}
  value={input}
  {...inputFocusProps}
  onChange={(event) => onInputChange(event.target.value)}
  placeholder=""
  rows={1}
  className={cn(
    "block max-h-[60vh] min-h-[40px] w-full resize-none border border-white/[0.06] rounded-2xl bg-white/[0.03] px-3 sm:px-4 py-2 text-[15px] text-[var(--text)] leading-relaxed focus-visible:ring-0 focus:outline-none focus:border-[var(--accent)]/30 focus:bg-white/[0.05] placeholder:text-white/20 caret-[var(--accent)]",
    isExpanded ? "overflow-y-auto scrollbar-thin" : "overflow-hidden"
  )}
  style={{ height: `${textareaHeight}px`, transition: "height 150ms ease" }}
  onKeyDown={(event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isSpeechActive) {
        return;
      }
      void onSubmit();
    }
  }}
  onPaste={(event) => {
    const files = Array.from(event.clipboardData.files);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length > 0) {
      void onUploadFiles(imageFiles);
    }
  }}
/>
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/chat-composer.test.tsx`
Expected: All tests PASS, including the 4 new clipboard paste tests.

---

### Task 3: Commit

- [ ] **Step 1: Commit the changes**

```bash
git add components/chat-composer.tsx tests/unit/chat-composer.test.tsx
git commit -m "feat(chat): support pasting images from clipboard into chat input"
```
