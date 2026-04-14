# Attachment Preview Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace transcript attachment links with a centered in-app preview modal that renders images inline, shows text-like files in a read-only viewer, and always provides an explicit close path across desktop, mobile, and PWA contexts.

**Architecture:** Keep the modal flow local to transcript attachments. Add a narrow text-preview response mode to the existing attachment route, extract the preview shell into a focused component, and wire `components/message-bubble.tsx` to open that modal instead of navigating away. Cover the route, the modal behavior, and the transcript flow with focused unit tests plus chat attachment e2e coverage.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, lucide-react, Vitest, Testing Library, Playwright, agent-browser

---

## File Map

- `lib/attachments.ts` — shared attachment preview helpers for inline text-preview eligibility and UTF-8 text reads
- `app/api/attachments/[attachmentId]/route.ts` — existing authenticated attachment GET route, extended with a `format=text` preview mode while preserving raw inline responses
- `tests/unit/attachment-preview-route.test.ts` — focused route coverage for text preview success, unsupported-preview rejection, and authentication
- `components/attachment-preview-modal.tsx` — new centered modal shell that renders image, text, loading, error, and unsupported states
- `components/message-bubble.tsx` — swap attachment tiles from direct navigation to modal-open behavior and keep raw-open/download access inside the modal
- `tests/unit/message-bubble.test.ts` — transcript attachment modal regression coverage
- `tests/e2e/features.spec.ts` — chat attachment transcript e2e coverage, including the modal open/close path and text preview rendering
- `.dev-server` — local dev server discovery for browser validation when Playwright is done

### Task 1: Add authenticated text-preview responses for supported attachments

**Files:**
- Modify: `lib/attachments.ts`
- Modify: `app/api/attachments/[attachmentId]/route.ts`
- Create: `tests/unit/attachment-preview-route.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `tests/unit/attachment-preview-route.test.ts` with this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAttachments } from "@/lib/attachments";
import { createConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

describe("attachment preview route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("returns text preview JSON for supported text attachments", async () => {
    const user = await createLocalUser({
      username: "attachment-preview-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Attachment preview", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "notes.md",
        mimeType: "text/markdown",
        bytes: Buffer.from("# Notes\nHello preview", "utf8")
      }
    ]);

    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}?format=text`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: attachment.id,
      filename: "notes.md",
      mimeType: "text/markdown",
      content: "# Notes\nHello preview"
    });
  });

  it("rejects inline text preview for image attachments", async () => {
    const user = await createLocalUser({
      username: "attachment-preview-image-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Image preview", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "photo.png",
        mimeType: "image/png",
        bytes: Buffer.from("png-binary", "utf8")
      }
    ]);

    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}?format=text`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(415);
    await expect(response.text()).resolves.toContain("Attachment cannot be previewed as text");
  });
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```bash
npx vitest run tests/unit/attachment-preview-route.test.ts
```

Expected: FAIL because the current route always returns raw bytes and does not support `?format=text`.

- [ ] **Step 3: Add shared preview helpers in `lib/attachments.ts`**

Append these helpers near the existing read helpers in `lib/attachments.ts`:

```ts
const INLINE_TEXT_PREVIEW_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json"
]);

export function isInlineTextPreviewableAttachment(
  attachment: Pick<MessageAttachment, "kind" | "mimeType" | "filename">
) {
  if (attachment.kind !== "text") {
    return false;
  }

  if (INLINE_TEXT_PREVIEW_MIME_TYPES.has(attachment.mimeType)) {
    return true;
  }

  return /\.(txt|md|markdown|json)$/i.test(attachment.filename);
}

export function readAttachmentText(
  attachment: Pick<MessageAttachment, "relativePath" | "kind" | "mimeType" | "filename">
) {
  if (!isInlineTextPreviewableAttachment(attachment)) {
    throw new Error("Attachment cannot be previewed as text");
  }

  return readAttachmentBuffer(attachment).toString("utf8");
}
```

- [ ] **Step 4: Extend the existing attachment GET route with `format=text`**

Update `app/api/attachments/[attachmentId]/route.ts` like this:

```ts
import {
  deleteAttachmentById,
  getAttachment,
  isInlineTextPreviewableAttachment,
  readAttachmentBuffer,
  readAttachmentText
} from "@/lib/attachments";
import { badRequest } from "@/lib/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> }
) {
  const user = await requireUser(false);
  // existing auth and param parsing stays the same

  const attachment = getAttachment(params.data.attachmentId, user.id);
  if (!attachment) {
    return badRequest("Attachment not found", 404);
  }

  const format = new URL(request.url).searchParams.get("format");

  try {
    if (format === "text") {
      if (!isInlineTextPreviewableAttachment(attachment)) {
        return badRequest("Attachment cannot be previewed as text", 415);
      }

      return Response.json({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        content: readAttachmentText(attachment)
      });
    }

    const buffer = readAttachmentBuffer(attachment);

    return new Response(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="${attachment.filename}"`
      }
    });
  } catch {
    return badRequest("Attachment file not found", 404);
  }
}
```

- [ ] **Step 5: Run the focused route test to verify it passes**

Run:

```bash
npx vitest run tests/unit/attachment-preview-route.test.ts tests/unit/attachments.test.ts
```

Expected: PASS with the new route test and the existing attachment helper tests both green.

- [ ] **Step 6: Commit the route-preview change**

Run:

```bash
git add lib/attachments.ts app/api/attachments/[attachmentId]/route.ts tests/unit/attachment-preview-route.test.ts
git commit -m "feat: add attachment text preview responses"
```

Expected: a single commit covering the preview helper and route behavior only.

### Task 2: Open transcript attachments in a centered preview modal

**Files:**
- Create: `components/attachment-preview-modal.tsx`
- Modify: `components/message-bubble.tsx`
- Modify: `tests/unit/message-bubble.test.ts`
- Modify: `tests/e2e/features.spec.ts`

- [ ] **Step 1: Write the failing transcript modal tests**

Add these tests to `tests/unit/message-bubble.test.ts` near the existing attachment coverage:

```tsx
  it("opens image attachments in a centered modal and closes with the X button", async () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
          attachments: [
            {
              id: "att_image",
              conversationId: "conv_test",
              messageId: "msg_user",
              filename: "photo.png",
              mimeType: "image/png",
              byteSize: 10,
              sha256: "hash",
              relativePath: "conv_test/att_image_photo.png",
              kind: "image",
              extractedText: "",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));

    expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "photo.png" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close attachment preview" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Attachment preview" })).toBeNull();
    });
  });

  it("loads text attachments into a read-only preview surface", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "att_text",
        filename: "notes.txt",
        mimeType: "text/plain",
        content: "hello from the preview route"
      })
    } as Response);

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
          attachments: [
            {
              id: "att_text",
              conversationId: "conv_test",
              messageId: "msg_user",
              filename: "notes.txt",
              mimeType: "text/plain",
              byteSize: 10,
              sha256: "hash2",
              relativePath: "conv_test/att_text_notes.txt",
              kind: "text",
              extractedText: "hello",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));

    await waitFor(() => {
      expect(screen.getByText("hello from the preview route")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/attachments/att_text?format=text");
    expect(screen.getByRole("link", { name: "Open raw attachment" })).toHaveAttribute(
      "href",
      "/api/attachments/att_text"
    );
  });

  it("closes the attachment modal when Escape is pressed", async () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
          attachments: [
            {
              id: "att_image",
              conversationId: "conv_test",
              messageId: "msg_user",
              filename: "photo.png",
              mimeType: "image/png",
              byteSize: 10,
              sha256: "hash",
              relativePath: "conv_test/att_image_photo.png",
              kind: "image",
              extractedText: "",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Attachment preview" })).toBeNull();
    });
  });
```

Add these e2e scenarios inside the `"Feature: Chat attachments"` block in `tests/e2e/features.spec.ts`:

```ts
  test("opens transcript image attachments in a modal and closes them", async ({ page }) => {
    await signIn(page);
    await mockChatResponse(page);
    await mockAttachmentUpload(page, [
      {
        id: "att_photo",
        filename: "photo.png",
        mimeType: "image/png",
        kind: "image"
      }
    ]);

    await createNewChat(page);
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    const chooserPromise = page.waitForEvent("filechooser");
    const uploadResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/attachments") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Attach files" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "photo.png", mimeType: "image/png", buffer: TINY_PNG });
    await uploadResponsePromise;

    await page.getByPlaceholder(/Ask, create, or start a task/i).fill("Keep this image");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("button", { name: "Preview photo.png" }).last()).toBeVisible({
      timeout: 10000
    });

    await page.getByRole("button", { name: "Preview photo.png" }).last().click();
    await expect(page.getByRole("dialog", { name: "Attachment preview" })).toBeVisible();
    await expect(page.getByRole("img", { name: "photo.png" })).toBeVisible();

    await page.getByRole("button", { name: "Close attachment preview" }).click();
    await expect(page.getByRole("dialog", { name: "Attachment preview" })).toBeHidden();
  });

  test("opens transcript text attachments in a modal and renders preview content", async ({ page }) => {
    await signIn(page);
    await mockChatResponse(page);
    await mockAttachmentUpload(page, [
      {
        id: "att_notes",
        filename: "notes.txt",
        mimeType: "text/plain",
        kind: "text"
      }
    ]);

    await createNewChat(page);
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    const chooserPromise = page.waitForEvent("filechooser");
    const uploadResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/attachments") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Attach files" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await uploadResponsePromise;

    await page.getByPlaceholder(/Ask, create, or start a task/i).fill("Keep these notes");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("button", { name: "Preview notes.txt" }).last()).toBeVisible({
      timeout: 10000
    });

    await page.getByRole("button", { name: "Preview notes.txt" }).last().click();
    await expect(page.getByRole("dialog", { name: "Attachment preview" })).toBeVisible();
    await expect(page.getByText("hello")).toBeVisible();
  });
```

- [ ] **Step 2: Run the modal-focused tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts
npm run test:e2e -- --grep "Feature: Chat attachments"
```

Expected:

- the unit suite fails because attachment tiles are still anchors, not preview buttons
- the e2e suite fails because the transcript does not render an in-app modal yet

- [ ] **Step 3: Create the centered modal component**

Create `components/attachment-preview-modal.tsx` with this implementation:

```tsx
"use client";

import React, { useEffect } from "react";
import { Download, FileText, X } from "lucide-react";

import type { MessageAttachment } from "@/lib/types";

type AttachmentPreviewState =
  | { kind: "loading" }
  | { kind: "image" }
  | { kind: "text"; content: string }
  | { kind: "error"; message: string }
  | { kind: "unsupported" };

type AttachmentPreviewModalProps = {
  attachment: MessageAttachment;
  state: AttachmentPreviewState;
  onClose: () => void;
  onRetry?: () => void;
};

export function AttachmentPreviewModal({
  attachment,
  state,
  onClose,
  onRetry
}: AttachmentPreviewModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Attachment preview"
        className="flex max-h-[min(80vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121317] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Close attachment preview"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/75"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{attachment.filename}</div>
              <div className="truncate text-xs text-white/50">{attachment.mimeType}</div>
            </div>
          </div>

          <a
            href={`/api/attachments/${attachment.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70"
            aria-label="Open raw attachment"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Open raw</span>
          </a>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {state.kind === "image" ? (
            <img
              src={`/api/attachments/${attachment.id}`}
              alt={attachment.filename}
              className="mx-auto max-h-[60vh] w-auto max-w-full rounded-xl"
            />
          ) : null}

          {state.kind === "loading" ? (
            <div className="flex h-full min-h-64 items-center justify-center text-sm text-white/55">
              Loading preview…
            </div>
          ) : null}

          {state.kind === "text" ? (
            <pre className="min-h-64 overflow-auto rounded-xl border border-white/8 bg-black/25 p-4 text-[13px] leading-6 text-white/85 whitespace-pre-wrap break-words font-mono">
              {state.content}
            </pre>
          ) : null}

          {state.kind === "unsupported" ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/12 bg-black/20 px-6 text-center">
              <FileText className="h-5 w-5 text-white/50" />
              <p className="text-sm text-white/70">Preview unavailable for this attachment type.</p>
            </div>
          ) : null}

          {state.kind === "error" ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border border-white/8 bg-black/20 px-6 text-center">
              <p className="text-sm text-white/70">{state.message}</p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/80"
              >
                Retry preview
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire transcript attachment tiles to open the modal**

Update `components/message-bubble.tsx` with these changes:

1. Add the new import near the top:

```tsx
import { AttachmentPreviewModal } from "@/components/attachment-preview-modal";
```

2. Replace `AttachmentTile` so it becomes a button instead of a direct link:

```tsx
function AttachmentTile({
  attachment,
  compact = false,
  onPreview
}: {
  attachment: MessageAttachment;
  compact?: boolean;
  onPreview: (attachment: MessageAttachment) => void;
}) {
  if (attachment.kind === "image") {
    return (
      <button
        type="button"
        aria-label={`Preview ${attachment.filename}`}
        onClick={() => onPreview(attachment)}
        className={`overflow-hidden rounded-xl border border-white/10 bg-black/20 ${compact ? "w-16" : "w-28"}`}
      >
        <img
          src={`/api/attachments/${attachment.id}`}
          alt={attachment.filename}
          className={`w-full object-cover ${compact ? "h-16" : "h-28"}`}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Preview ${attachment.filename}`}
      onClick={() => onPreview(attachment)}
      className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-left"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/75">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-white">{attachment.filename}</span>
        <span className="block truncate text-xs text-white/60">{attachment.mimeType}</span>
      </span>
    </button>
  );
}
```

3. Pass the preview callback through `MessageAttachments`:

```tsx
function MessageAttachments({
  attachments,
  compact = false,
  onPreview
}: {
  attachments: MessageAttachment[];
  compact?: boolean;
  onPreview: (attachment: MessageAttachment) => void;
}) {
  // existing image/file split remains the same
  return (
    <div className="space-y-2.5">
      {images.length ? (
        <div className="flex flex-wrap gap-2">
          {images.map((attachment) => (
            <AttachmentTile
              key={attachment.id}
              attachment={attachment}
              compact={compact}
              onPreview={onPreview}
            />
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="space-y-2">
          {files.map((attachment) => (
            <AttachmentTile
              key={attachment.id}
              attachment={attachment}
              compact={compact}
              onPreview={onPreview}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

4. Inside `MessageBubble`, add local preview state and lazy text loading:

```tsx
  const [previewAttachment, setPreviewAttachment] = useState<MessageAttachment | null>(null);
  const [previewState, setPreviewState] = useState<
    { kind: "loading" } | { kind: "image" } | { kind: "text"; content: string } | { kind: "error"; message: string } | { kind: "unsupported" }
  >({ kind: "unsupported" });
  const [textPreviewCache, setTextPreviewCache] = useState<Record<string, string>>({});

  async function openAttachmentPreview(attachment: MessageAttachment) {
    setPreviewAttachment(attachment);

    if (attachment.kind === "image") {
      setPreviewState({ kind: "image" });
      return;
    }

    setPreviewState({ kind: "loading" });

    const cached = textPreviewCache[attachment.id];
    if (cached) {
      setPreviewState({ kind: "text", content: cached });
      return;
    }

    try {
      const response = await fetch(`/api/attachments/${attachment.id}?format=text`);
      if (!response.ok) {
        if (response.status === 415) {
          setPreviewState({ kind: "unsupported" });
          return;
        }
        throw new Error("Unable to load attachment preview.");
      }

      const payload = await response.json();
      setTextPreviewCache((current) => ({ ...current, [attachment.id]: payload.content }));
      setPreviewState({ kind: "text", content: payload.content });
    } catch (error) {
      setPreviewState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to load attachment preview."
      });
    }
  }

  function closeAttachmentPreview() {
    setPreviewAttachment(null);
    setPreviewState({ kind: "unsupported" });
  }
```

5. Replace the existing attachment render call:

```tsx
                <MessageAttachments
                  attachments={message.attachments}
                  compact
                  onPreview={openAttachmentPreview}
                />
```

6. Render the modal near the bottom of `MessageBubble`:

```tsx
      {previewAttachment ? (
        <AttachmentPreviewModal
          attachment={previewAttachment}
          state={previewState}
          onClose={closeAttachmentPreview}
          onRetry={() => void openAttachmentPreview(previewAttachment)}
        />
      ) : null}
```

- [ ] **Step 5: Update the e2e attachment mocks for text preview**

Adjust `mockAttachmentUpload` in `tests/e2e/features.spec.ts` so preview requests can return text JSON:

```ts
  await page.route("**/api/attachments/*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    const url = new URL(route.request().url());
    const attachmentId = url.pathname.split("/").pop() ?? "";
    const attachment = attachments.find((item) => item.id === attachmentId);

    if (url.searchParams.get("format") === "text") {
      await route.fulfill({
        status: attachment?.kind === "text" ? 200 : 415,
        contentType: "application/json",
        body:
          attachment?.kind === "text"
            ? JSON.stringify({
                id: attachment.id,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                content: "hello"
              })
            : JSON.stringify({ error: "Attachment cannot be previewed as text" })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: attachment?.mimeType ?? "image/png",
      body: attachment?.kind === "image" ? TINY_PNG : Buffer.from("hello")
    });
  });
```

- [ ] **Step 6: Run the modal-focused suites to verify they pass**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts tests/unit/attachment-preview-route.test.ts
npm run test:e2e -- --grep "Feature: Chat attachments"
```

Expected:

- the focused unit suites pass
- the chat attachments e2e scenarios pass, including transcript open/close behavior

- [ ] **Step 7: Commit the modal-preview UI**

Run:

```bash
git add components/attachment-preview-modal.tsx components/message-bubble.tsx tests/unit/message-bubble.test.ts tests/e2e/features.spec.ts
git commit -m "feat: open attachments in preview modal"
```

Expected: a single commit covering the centered modal, transcript wiring, and matching tests.

### Task 3: Run full verification and browser validation

**Files:**
- Review: `.dev-server`
- Review: `playwright.config.ts`
- Review: `.context/attachment-preview-modal-desktop.png`
- Review: `.context/attachment-preview-modal-mobile.png`

- [ ] **Step 1: Run the broader automated verification**

Run:

```bash
npx vitest run
npm run test:e2e -- --grep "Feature: Chat attachments|Feature: Create and delete conversations"
```

Expected:

- `npx vitest run` passes without introducing regressions
- the selected e2e coverage passes, including the attachment modal and baseline chat flow

- [ ] **Step 2: Reuse or start the dev server using `.dev-server`**

Run:

```bash
if [ -f .dev-server ]; then
  URL="$(head -n 1 .dev-server)"
  curl -sf "$URL" >/dev/null || rm .dev-server
fi

if [ ! -f .dev-server ]; then
  npm run dev >/tmp/attachment-preview-dev.log 2>&1 &
  until [ -f .dev-server ]; do sleep 1; done
fi

head -n 1 .dev-server
```

Expected: a reachable localhost URL on the first line of `.dev-server`.

- [ ] **Step 3: Validate the desktop modal flow with agent-browser**

Use the browser tooling against the URL from `.dev-server`:

1. Open the app
2. Sign in
3. Create a chat with a text attachment
4. Send the message
5. Open the transcript attachment preview
6. Confirm the centered modal, header controls, preview content, and explicit close path

Save a screenshot to:

```bash
.context/attachment-preview-modal-desktop.png
```

Expected: a desktop screenshot showing the modal open over the transcript.

- [ ] **Step 4: Validate the mobile-sized modal flow with agent-browser**

In the same browser session:

1. Switch to a narrow mobile viewport
2. Re-open the same transcript attachment
3. Confirm the modal still opens in-app
4. Confirm the `X` close control remains visible and usable
5. Confirm closing returns directly to the conversation view without navigation side effects

Save a screenshot to:

```bash
.context/attachment-preview-modal-mobile.png
```

Expected: a mobile-sized screenshot showing the same centered modal pattern and visible close affordance.

- [ ] **Step 5: Review the final diff and commit the verification-ready branch**

Run:

```bash
git status --short
git log --oneline --decorate -3
```

Expected:

- no unexpected files beyond the planned source/test changes and `.context/` browser artifacts
- the last two commits are:
  - `feat: add attachment text preview responses`
  - `feat: open attachments in preview modal`
