# Assistant Local File Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let assistant-authored local Markdown image/link targets become normal assistant attachments when the source file is under the workspace or `/tmp`.

**Architecture:** Add a dedicated post-processing helper that scans finalized assistant content for local Markdown targets, imports allowed files through a new local-file attachment primitive, rewrites the assistant content to remove successful local-path Markdown, and appends concise failure notes. Integrate that helper into assistant turn finalization in both the HTTP chat route and the websocket/chat-turn runtime so persisted content and rendered attachments stay consistent.

**Tech Stack:** Next.js 15, TypeScript, Vitest, Playwright, better-sqlite3, existing attachment/message runtime helpers

---

## File Structure

- Create: `lib/assistant-local-attachments.ts`
  Own assistant Markdown target extraction, path allowlist checks, deduplication, import orchestration, content sanitization input/output, and failure note generation.

- Modify: `lib/attachments.ts`
  Add a local-file import primitive that reads from a validated source path, applies existing attachment kind/size rules, copies bytes into managed storage, and returns a normal `MessageAttachment`.

- Modify: `lib/assistant-image-markdown.ts`
  Broaden the sanitizer so it can strip successful local Markdown image embeds and successful local Markdown file links without touching external URLs.

- Modify: `lib/chat-turn.ts`
  Run assistant local attachment inference before persisting final assistant content during websocket/chat manager turns.

- Modify: `app/api/conversations/[conversationId]/chat/route.ts`
  Run the same inference before persisting final assistant content in the SSE route.

- Test: `tests/unit/assistant-image-markdown.test.ts`
  Extend sanitizer coverage for local file links and mixed content.

- Test: `tests/unit/attachments.test.ts`
  Cover importing a local file from disk, unsupported types, and non-regular file rejection.

- Create: `tests/unit/assistant-local-attachments.test.ts`
  Cover parsing, allowlist behavior, symlink/canonicalization logic, deduplication, and failure notes.

- Modify: `tests/unit/chat-turn.test.ts`
  Cover end-to-end assistant turn persistence with inferred assistant attachments.

- Modify: `tests/unit/assistant-runtime.test.ts`
  Add route/runtime-facing coverage if needed for shared inference integration.

- Modify: `tests/e2e/features.spec.ts`
  Validate the user-visible transcript behavior for assistant-created local attachments.

### Task 1: Broaden Markdown Sanitization With Tests

**Files:**
- Modify: `tests/unit/assistant-image-markdown.test.ts`
- Modify: `lib/assistant-image-markdown.ts`

- [ ] **Step 1: Write the failing sanitizer tests**

```ts
import { describe, expect, it } from "vitest";

import { stripAttachmentStyleImageMarkdown } from "@/lib/assistant-image-markdown";
import type { MessageAttachment } from "@/lib/types";

function createTextAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "att_text",
    conversationId: "conv_test",
    messageId: "msg_assistant",
    filename: "build.log",
    mimeType: "text/plain",
    byteSize: 42,
    sha256: "hash",
    relativePath: "conv_test/build.log",
    kind: "text",
    extractedText: "log body",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

it("removes local markdown file links when the assistant message already has text attachments", () => {
  const content = [
    "I attached the log.",
    "",
    "[build log](/tmp/build.log)",
    "",
    "Review the attachment below."
  ].join("\n");

  expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(
    ["I attached the log.", "", "Review the attachment below."].join("\n")
  );
});

it("preserves external markdown links", () => {
  const content = "[docs](https://example.com/docs)";

  expect(stripAttachmentStyleImageMarkdown(content, [createTextAttachment()])).toBe(content);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/assistant-image-markdown.test.ts`
Expected: FAIL because local file links are not removed yet.

- [ ] **Step 3: Write the minimal sanitizer update**

```ts
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isExternalTarget(target: string) {
  return /^(?:https?:\/\/|data:|blob:)/i.test(target);
}

export function stripAttachmentStyleImageMarkdown(
  content: string,
  attachments: MessageAttachment[] = []
) {
  if (!content || attachments.length === 0) {
    return content;
  }

  const sanitizedImages = content.replace(MARKDOWN_IMAGE_PATTERN, (match, rawTarget: string) => {
    const target = rawTarget.trim();
    return isExternalTarget(target) ? match : "";
  });

  const sanitizedLinks = sanitizedImages.replace(
    MARKDOWN_LINK_PATTERN,
    (match, _label: string, rawTarget: string) => {
      const target = rawTarget.trim();
      return isExternalTarget(target) ? match : "";
    }
  );

  return sanitizedLinks
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/assistant-image-markdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/assistant-image-markdown.test.ts lib/assistant-image-markdown.ts
git commit -m "test: broaden assistant markdown attachment sanitization"
```

### Task 2: Add Local File Import Primitive In Attachment Storage

**Files:**
- Modify: `tests/unit/attachments.test.ts`
- Modify: `lib/attachments.ts`

- [ ] **Step 1: Write the failing attachment storage tests**

```ts
import fs from "node:fs";
import path from "node:path";

import { createConversation } from "@/lib/conversations";
import { createAttachmentFromLocalFile } from "@/lib/attachments";

it("imports a local text file into managed attachment storage", () => {
  const conversation = createConversation();
  const sourcePath = path.join(process.env.EIDON_DATA_DIR!, "tmp-import-notes.txt");
  fs.writeFileSync(sourcePath, "import me", "utf8");

  const attachment = createAttachmentFromLocalFile(conversation.id, sourcePath);

  expect(attachment.filename).toBe("tmp-import-notes.txt");
  expect(attachment.kind).toBe("text");
  expect(attachment.extractedText).toContain("import me");
});

it("rejects unsupported local file types", () => {
  const conversation = createConversation();
  const sourcePath = path.join(process.env.EIDON_DATA_DIR!, "tmp-import.zip");
  fs.writeFileSync(sourcePath, "zip", "utf8");

  expect(() => createAttachmentFromLocalFile(conversation.id, sourcePath)).toThrow(
    "Unsupported attachment type: tmp-import.zip"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/attachments.test.ts`
Expected: FAIL because `createAttachmentFromLocalFile` does not exist.

- [ ] **Step 3: Write the minimal local-file import implementation**

```ts
export function createAttachmentFromLocalFile(conversationId: string, sourcePath: string) {
  const stat = fs.statSync(sourcePath);

  if (!stat.isFile()) {
    throw new Error("Only regular files can be attached");
  }

  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds maximum size");
  }

  const bytes = fs.readFileSync(sourcePath);
  const filename = path.basename(sourcePath);

  const [attachment] = createAttachments(conversationId, [
    {
      filename,
      mimeType: normalizeAttachmentKind(filename, "").mimeType,
      bytes
    }
  ]);

  return attachment;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/attachments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/attachments.test.ts lib/attachments.ts
git commit -m "feat: add local file import for attachments"
```

### Task 3: Build Assistant Local Attachment Inference Helper

**Files:**
- Create: `tests/unit/assistant-local-attachments.test.ts`
- Create: `lib/assistant-local-attachments.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createConversation } from "@/lib/conversations";
import { inferAssistantLocalAttachments } from "@/lib/assistant-local-attachments";

it("imports workspace markdown links and strips them from the message body", () => {
  const conversation = createConversation();
  const workspaceFile = path.join(process.cwd(), "tmp-assistant-log.txt");
  fs.writeFileSync(workspaceFile, "hello from workspace", "utf8");

  const result = inferAssistantLocalAttachments({
    conversationId: conversation.id,
    content: ["Attached log:", "", `[log](${workspaceFile})`].join("\n"),
    workspaceRoot: process.cwd()
  });

  expect(result.attachments).toHaveLength(1);
  expect(result.content).toBe("Attached log:");
  expect(result.failureNote).toBe("");
});

it("rejects paths outside the workspace and /tmp with a user-facing note", () => {
  const conversation = createConversation();
  const outsidePath = path.join(os.homedir(), "secret.txt");

  const result = inferAssistantLocalAttachments({
    conversationId: conversation.id,
    content: `[secret](${outsidePath})`,
    workspaceRoot: process.cwd()
  });

  expect(result.attachments).toHaveLength(0);
  expect(result.failureNote).toContain("only workspace files and /tmp are allowed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/assistant-local-attachments.test.ts`
Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Write the minimal helper implementation**

```ts
type InferAssistantLocalAttachmentsInput = {
  conversationId: string;
  content: string;
  workspaceRoot: string;
};

export function inferAssistantLocalAttachments(input: InferAssistantLocalAttachmentsInput) {
  const seen = new Map<string, MessageAttachment>();
  const failures: string[] = [];

  const rewritten = input.content.replace(MARKDOWN_LOCAL_TARGET_PATTERN, (match, _prefix, rawTarget) => {
    const target = decodeURIComponent(rawTarget.trim());

    if (!path.isAbsolute(target) || isExternalTarget(target)) {
      return match;
    }

    let canonicalPath: string;
    try {
      canonicalPath = fs.realpathSync(target);
    } catch {
      failures.push(target);
      return "";
    }

    if (!isAllowedLocalAttachmentPath(canonicalPath, input.workspaceRoot)) {
      failures.push(target);
      return "";
    }

    if (!seen.has(canonicalPath)) {
      seen.set(
        canonicalPath,
        createAttachmentFromLocalFile(input.conversationId, canonicalPath)
      );
    }

    return "";
  });

  return {
    content: collapseAssistantAttachmentWhitespace(rewritten),
    attachments: [...seen.values()],
    failureNote: failures.length
      ? `Note: I couldn't attach ${failures.join(", ")} because only workspace files and /tmp are allowed.`
      : ""
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/assistant-local-attachments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/assistant-local-attachments.test.ts lib/assistant-local-attachments.ts
git commit -m "feat: infer assistant local file attachments"
```

### Task 4: Integrate Inference Into Assistant Turn Finalization

**Files:**
- Modify: `tests/unit/chat-turn.test.ts`
- Modify: `tests/unit/assistant-runtime.test.ts`
- Modify: `lib/chat-turn.ts`
- Modify: `app/api/conversations/[conversationId]/chat/route.ts`

- [ ] **Step 1: Write the failing turn-finalization tests**

```ts
it("binds inferred assistant local attachments and strips raw file markdown", async () => {
  const resolveAssistantTurn = vi.fn().mockResolvedValue({
    answer: `Saved screenshot:\n\n![shot](/tmp/assistant-turn.png)`,
    thinking: "",
    usage: { outputTokens: 1 }
  });
  vi.doMock("@/lib/assistant-runtime", () => ({ resolveAssistantTurn }));

  fs.writeFileSync("/tmp/assistant-turn.png", "png-binary", "utf8");

  const { createConversationManager } = await import("@/lib/conversation-manager");
  const { startChatTurn } = await import("@/lib/chat-turn");
  const { listVisibleMessages } = await import("@/lib/conversations");

  const manager = createConversationManager();
  const conv = (await import("@/lib/conversations")).createConversation();

  await startChatTurn(manager, conv.id, "show me", []);

  const assistant = listVisibleMessages(conv.id).find((message) => message.role === "assistant");
  expect(assistant?.attachments).toHaveLength(1);
  expect(assistant?.content).toContain("Saved screenshot:");
  expect(assistant?.content).not.toContain("/tmp/assistant-turn.png");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/chat-turn.test.ts tests/unit/assistant-runtime.test.ts`
Expected: FAIL because final assistant content is persisted before local attachment inference.

- [ ] **Step 3: Write the minimal runtime integration**

```ts
const inferenceResult = inferAssistantLocalAttachments({
  conversationId: assistantMessage.id ? conversation.id : conversation.id,
  content: providerResult.answer,
  workspaceRoot: process.cwd()
});

if (inferenceResult.attachments.length > 0) {
  bindAttachmentsToMessage(
    conversation.id,
    assistantMessage.id,
    inferenceResult.attachments.map((attachment) => attachment.id)
  );
}

const finalContent = [
  inferenceResult.content,
  inferenceResult.failureNote
].filter(Boolean).join("\n\n");

updateMessage(assistantMessage.id, {
  content: stripAttachmentStyleImageMarkdown(
    finalContent,
    getMessage(assistantMessage.id)?.attachments ?? []
  ),
  thinkingContent: providerResult.thinking,
  status: "completed",
  estimatedTokens:
    (providerResult.usage.inputTokens ?? 0) +
    (providerResult.usage.outputTokens ?? 0) +
    (providerResult.usage.reasoningTokens ?? 0)
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/chat-turn.test.ts tests/unit/assistant-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/chat-turn.test.ts tests/unit/assistant-runtime.test.ts lib/chat-turn.ts app/api/conversations/[conversationId]/chat/route.ts
git commit -m "feat: attach assistant local files during turn finalization"
```

### Task 5: Validate Rendered Transcript Behavior

**Files:**
- Modify: `tests/unit/message-bubble.test.tsx`
- Modify: `tests/e2e/features.spec.ts`

- [ ] **Step 1: Write the failing UI tests**

```ts
it("renders assistant-imported file attachments without showing the raw local path", () => {
  const assistant = createAssistantMessage();
  assistant.content = "Attached the log.";
  assistant.attachments = [
    {
      id: "att_log",
      conversationId: "conv_test",
      messageId: "msg_assistant",
      filename: "build.log",
      mimeType: "text/plain",
      byteSize: 42,
      sha256: "hash",
      relativePath: "conv_test/build.log",
      kind: "text",
      extractedText: "content",
      createdAt: new Date().toISOString()
    }
  ];

  render(React.createElement(MessageBubble, { message: assistant }));

  expect(screen.getByRole("button", { name: "Preview build.log" })).toBeInTheDocument();
  expect(screen.queryByText("/tmp/build.log")).toBeNull();
});
```

```ts
test("assistant local screenshots show as attachment tiles in the transcript", async ({ page }) => {
  await signIn(page);
  await createNewChat(page);

  await page.route("**/api/conversations/*/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"type":"message_start","messageId":"msg_assistant"}',
        "",
        'data: {"type":"done","messageId":"msg_assistant","message":{"id":"msg_assistant","conversationId":"conv-1","role":"assistant","content":"Attached screenshot.","thinkingContent":"","status":"completed","estimatedTokens":1,"systemKind":null,"compactedAt":null,"createdAt":"2026-04-17T00:00:00.000Z","actions":[],"attachments":[{"id":"att_image","conversationId":"conv-1","messageId":"msg_assistant","filename":"shot.png","mimeType":"image/png","byteSize":10,"sha256":"hash","relativePath":"conv-1/shot.png","kind":"image","extractedText":"","createdAt":"2026-04-17T00:00:00.000Z"}]}}',
        ""
      ].join("\n")
    });
  });

  await page.getByPlaceholder("Message Eidon...").fill("show me");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("button", { name: "Preview shot.png" })).toBeVisible();
  await expect(page.getByText("/tmp/shot.png")).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/message-bubble.test.tsx && npm run test:e2e -- tests/e2e/features.spec.ts`
Expected: FAIL until transcript payloads and rendering assertions line up with the new attachment flow.

- [ ] **Step 3: Make the minimal UI/test fixture adjustments**

```ts
const assistantText = message.content;
const displayText = stripAttachmentStyleImageMarkdown(
  assistantText,
  message.attachments ?? []
);

return renderAssistantMarkdown(displayText, false);
```

```ts
expect(page.getByRole("button", { name: "Preview shot.png" })).toBeVisible();
await page.getByRole("button", { name: "Preview shot.png" }).click();
await expect(page.getByRole("dialog", { name: "Attachment preview" })).toBeVisible();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/message-bubble.test.tsx && npm run test:e2e -- tests/e2e/features.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/message-bubble.test.tsx tests/e2e/features.spec.ts
git commit -m "test: cover assistant local attachment transcript behavior"
```

### Task 6: Run Full Verification And Document Outcome

**Files:**
- Modify: `docs/superpowers/plans/2026-04-17-assistant-local-file-attachments.md`

- [ ] **Step 1: Run the focused unit test suite**

```bash
npm test -- --run \
  tests/unit/assistant-image-markdown.test.ts \
  tests/unit/attachments.test.ts \
  tests/unit/assistant-local-attachments.test.ts \
  tests/unit/chat-turn.test.ts \
  tests/unit/assistant-runtime.test.ts \
  tests/unit/message-bubble.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run the end-to-end coverage for the feature**

```bash
npm run test:e2e -- tests/e2e/features.spec.ts
```

Expected: PASS

- [ ] **Step 3: Run the broader safety checks**

```bash
npm run lint
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Update this plan with implementation notes if execution uncovered drift**

```md
## Execution Notes

- Record any deviations from the planned helper/module boundaries here.
- Record any additional follow-up work that was explicitly deferred.
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: finalize assistant local attachment support"
```

## Self-Review

Spec coverage check:

- Guardrails for workspace and `/tmp` are covered in Task 3.
- Managed storage import is covered in Task 2.
- Turn-finalization integration for SSE and websocket paths is covered in Task 4.
- Sanitized transcript rendering is covered in Tasks 1 and 5.
- Failure-note behavior is covered in Tasks 3 and 4.
- UI validation is covered in Task 5.

## Execution Notes

- The focused unit command from Task 6 failed under the repo-wide Vitest coverage gate because the narrowed file set cannot satisfy the global 85% thresholds on its own.
- Remaining Task 6 checks were not run after that failure.

Placeholder scan:

- No `TBD`, `TODO`, or “similar to” shortcuts remain.
- Each code-writing step includes concrete snippets.
- Each verification step includes an exact command and expected result.

Type consistency check:

- The plan consistently uses `createAttachmentFromLocalFile` for the storage primitive and `inferAssistantLocalAttachments` for the feature helper.
- The turn-finalization steps use `bindAttachmentsToMessage` and `stripAttachmentStyleImageMarkdown` consistently across runtime integration tasks.
