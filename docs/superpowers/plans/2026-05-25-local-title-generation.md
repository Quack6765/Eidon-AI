# Local LLM Title Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace remote LLM API calls for conversation title generation with a local SmolLM2-135M-Instruct model running server-side on CPU.

**Architecture:** A new `lib/local-title-model.ts` module manages a singleton ONNX pipeline (via `@huggingface/transformers` + `onnxruntime-node`). `lib/conversation-title-generator.ts` calls this instead of `callProviderText()`. `lib/conversations.ts` is simplified to remove provider resolution. The model is pre-downloaded in Docker and auto-cached in local dev.

**Tech Stack:** `@huggingface/transformers`, `onnxruntime-node`, SmolLM2-135M-Instruct (q4 ONNX, ~118MB)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/local-title-model.ts` | **Create** | Singleton ONNX pipeline, model loading, inference |
| `lib/conversation-title-generator.ts` | **Modify** | Replace `callProviderText` with local model call |
| `lib/conversations.ts` | **Modify** | Remove provider resolution from title generation |
| `package.json` | **Modify** | Add `@huggingface/transformers` dependency |
| `next.config.ts` | **Modify** | Add `serverExternalPackages` for native modules |
| `Dockerfile` | **Modify** | Add model pre-download step |
| `.gitignore` | **Modify** | Add model cache directory |
| `tests/unit/conversation-title-generator.test.ts` | **Modify** | Update mocks and tests |
| `tests/unit/conversations.test.ts` | **Modify** | Remove provider setup from title tests |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @huggingface/transformers**

Run:
```bash
npm install @huggingface/transformers
```

`onnxruntime-node` is a dependency of `@huggingface/transformers` and will be auto-installed.

- [ ] **Step 2: Verify installation**

Run:
```bash
node -e "const ort = require('onnxruntime-node'); console.log('ONNX Runtime version:', ort.version)"
```
Expected: prints ONNX Runtime version string.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @huggingface/transformers for local title generation"
```

---

### Task 2: Update Next.js Config for Native Modules

**Files:**
- Modify: `next.config.ts`

`conversations.ts` is imported by many Next.js API routes. Since `conversations.ts` imports `conversation-title-generator.ts`, which will import `local-title-model.ts`, which uses `onnxruntime-node` (native C++ module), Next.js needs to know to externalize these packages instead of bundling them.

- [ ] **Step 1: Add serverExternalPackages to next.config.ts**

Replace the entire content of `next.config.ts` with:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["onnxruntime-node", "@huggingface/transformers"],
};

export default nextConfig;
```

- [ ] **Step 2: Verify config is valid**

Run:
```bash
npx next typegen && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "chore: externalize onnxruntime-node from Next.js bundle"
```

---

### Task 3: Create Local Title Model Module

**Files:**
- Create: `lib/local-title-model.ts`
- Modify: `.gitignore`

This module manages the ONNX pipeline singleton. It lazy-loads the model on first use and caches it for the process lifetime.

- [ ] **Step 1: Add model cache to .gitignore**

Add `.cache/` to `.gitignore` (after the existing `tmp/` line):

```
.cache/
```

- [ ] **Step 2: Create `lib/local-title-model.ts`**

```typescript
import { pipeline, env } from "@huggingface/transformers";
import path from "node:path";

const MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct";
const SYSTEM_PROMPT = [
  "Generate a short conversation title from the user's first message.",
  "Return only the title.",
  "Prefer 2 to 4 words.",
  "Keep it natural and specific.",
  "Do not use quotes, markdown, labels, or trailing punctuation.",
].join("\n");

let pipelineInstance: Awaited<ReturnType<typeof pipeline>> | null = null;
let loadingPromise: Promise<Awaited<ReturnType<typeof pipeline>>> | null = null;

function getCacheDir(): string {
  const dataDir = process.env.EIDON_DATA_DIR || path.join(process.cwd(), ".data");
  return path.join(dataDir, "model-cache");
}

async function loadPipeline(): Promise<ReturnType<typeof pipeline>> {
  if (pipelineInstance) {
    return pipelineInstance;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  env.cacheDir = getCacheDir();

  loadingPromise = pipeline("text-generation", MODEL_ID, {
    dtype: "q4",
    device: "cpu",
  }).then((p) => {
    pipelineInstance = p;
    return p;
  }).catch((err) => {
    loadingPromise = null;
    throw err;
  });

  return loadingPromise;
}

export async function runLocalTitleInference(userMessage: string): Promise<string> {
  const generator = await loadPipeline();

  const output = await generator(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    {
      max_new_tokens: 12,
      temperature: 0.3,
      do_sample: true,
      repetition_penalty: 1.2,
    }
  );

  const messages = output[0].generated_text;
  const lastMessage = messages[messages.length - 1];
  return lastMessage.content.trim();
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit lib/local-title-model.ts 2>&1 | head -20
```
Expected: no errors (may show unresolved imports — acceptable for isolated check).

- [ ] **Step 4: Commit**

```bash
git add lib/local-title-model.ts .gitignore
git commit -m "feat: add local title model module with SmolLM2-135M pipeline"
```

---

### Task 4: Rewrite Conversation Title Generator

**Files:**
- Modify: `lib/conversation-title-generator.ts`

Replace the remote provider call with the local model. Remove the `ProviderProfileWithApiKey` dependency and `buildConversationTitlePrompt()`.

- [ ] **Step 1: Rewrite `lib/conversation-title-generator.ts`**

Replace the entire file with:

```typescript
import { runLocalTitleInference } from "@/lib/local-title-model";

export const DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE = "Files";
export const DEFAULT_CONVERSATION_TITLE = "Conversation";
export const MAX_CONVERSATION_TITLE_LENGTH = 48;

function trimToWordBoundary(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength).trim();
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace >= 16) {
    return truncated.slice(0, lastSpace).trim();
  }

  return truncated;
}

export function sanitizeGeneratedConversationTitle(rawTitle: string) {
  const firstLine = rawTitle.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = firstLine
    .replace(/["'`""]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/g, "")
    .trim();

  return trimToWordBoundary(collapsed, MAX_CONVERSATION_TITLE_LENGTH);
}

export async function generateConversationTitle(input: {
  firstMessage: string;
}) {
  const rawTitle = await runLocalTitleInference(input.firstMessage);
  const title = sanitizeGeneratedConversationTitle(rawTitle);

  if (!title) {
    throw new Error("Local model returned an empty title");
  }

  return title;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx next typegen && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/conversation-title-generator.ts
git commit -m "feat: replace remote LLM with local model for title generation"
```

---

### Task 5: Simplify Conversations Title Generation Orchestration

**Files:**
- Modify: `lib/conversations.ts`

Remove provider resolution and API key checking from `generateConversationTitleFromFirstUserMessage()`. The function now calls `generateConversationTitle({ firstMessage })` directly without any provider settings.

- [ ] **Step 1: Update the import block at line 14**

The current import at line 14 is:
```typescript
} from "@/lib/conversation-title-generator";
```

This stays the same — `generateConversationTitle` is still imported. But we no longer need `getDefaultProviderProfileWithApiKey` or `getProviderProfileWithApiKey` for title generation. Check if those are used elsewhere in the file before removing from imports.

**Only modify the `generateConversationTitleFromFirstUserMessage` function** (lines 2449–2532). Do not change imports unless `getProviderProfileWithApiKey` and `getDefaultProviderProfileWithApiKey` are only used in this function (search the file first).

- [ ] **Step 2: Rewrite `generateConversationTitleFromFirstUserMessage`**

Replace lines 2449–2532 with:

```typescript
export async function generateConversationTitleFromFirstUserMessage(
  conversationId: string,
  userMessageId: string
) {
  if (!claimConversationTitleGeneration(conversationId, userMessageId)) {
    return false;
  }

  try {
    const firstUserMessage = getDb()
      .prepare(
        `SELECT content
         FROM messages
         WHERE id = ? AND conversation_id = ? AND role = 'user'`
      )
      .get(userMessageId, conversationId) as { content: string } | undefined;

    if (!firstUserMessage) {
      failConversationTitleGeneration(conversationId);
      return false;
    }

    const trimmedContent = firstUserMessage.content.trim();

    if (!trimmedContent) {
      completeConversationTitleGeneration(
        conversationId,
        DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE
      );

      const currentConversation = getConversation(conversationId);
      if (currentConversation) {
        try {
          const conversationOwnerId = getConversationOwnerId(conversationId);
          getConversationManager().broadcastAll({
            type: "conversation_title_updated",
            conversationId,
            title: DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE
          }, conversationOwnerId ?? undefined);
        } catch { /* WS server may not be running */ }
      }

      return true;
    }

    const title = await generateConversationTitle({
      firstMessage: trimmedContent
    });

    completeConversationTitleGeneration(conversationId, title);

    try {
      const conversationOwnerId = getConversationOwnerId(conversationId);
      getConversationManager().broadcastAll({
        type: "conversation_title_updated",
        conversationId,
        title
      }, conversationOwnerId ?? undefined);
    } catch { /* WS server may not be running */ }

    return true;
  } catch {
    failConversationTitleGeneration(conversationId);
    return false;
  }
}
```

Key changes:
- Removed `const conversation = getConversation(conversationId)` and the null check (lines 2494–2499) — no longer needed since we don't access `conversation.providerProfileId`.
- Removed provider resolution block (`getProviderProfileWithApiKey` / `getDefaultProviderProfileWithApiKey`, lines 2501–2504).
- Removed API key check (`if (!settings?.apiKey)`, lines 2506–2509).
- `generateConversationTitle({ firstMessage: trimmedContent })` now takes only `firstMessage`, no `settings`.

- [ ] **Step 3: Check for unused imports**

Search `conversations.ts` for all uses of `getProviderProfileWithApiKey` and `getDefaultProviderProfileWithApiKey`. If they are only used in the removed block, remove them from the import statement at the top of the file.

- [ ] **Step 4: Verify TypeScript compiles**

Run:
```bash
npx next typegen && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/conversations.ts
git commit -m "refactor: remove provider dependency from title generation"
```

---

### Task 6: Update Tests

**Files:**
- Modify: `tests/unit/conversation-title-generator.test.ts`
- Modify: `tests/unit/conversations.test.ts`

#### 6a: Update conversation-title-generator.test.ts

The test file currently mocks `@/lib/provider` → `callProviderText`. It needs to mock `@/lib/local-title-model` → `runLocalTitleInference` instead. The `buildConversationTitlePrompt` test is removed (that function no longer exists).

- [ ] **Step 1: Rewrite `tests/unit/conversation-title-generator.test.ts`**

Replace the entire file with:

```typescript
const runLocalTitleInference = vi.fn();

vi.mock("@/lib/local-title-model", () => ({
  runLocalTitleInference
}));

describe("conversation title generator", () => {
  beforeEach(() => {
    runLocalTitleInference.mockReset();
  });

  it("sanitizes quotes, line breaks, and excessive length", async () => {
    const { sanitizeGeneratedConversationTitle } = await import("@/lib/conversation-title-generator");

    expect(
      sanitizeGeneratedConversationTitle(
        "\"A very long generated title that keeps going far past the maximum length for the sidebar\"\nSecond line"
      )
    ).toBe("A very long generated title that keeps going");
  });

  it("truncates without word boundary when no space exists after position 16", async () => {
    const { sanitizeGeneratedConversationTitle } = await import("@/lib/conversation-title-generator");

    const result = sanitizeGeneratedConversationTitle(
      "Superlongwordthatexceedsthemaxlengthbyfar"
    );
    expect(result).toBe("Superlongwordthatexceedsthemaxlengthbyfar".slice(0, 48));
  });

  it("calls the local model and returns a sanitized title", async () => {
    runLocalTitleInference.mockResolvedValue('  "Deployment Checklist."\n');

    const { generateConversationTitle } = await import("@/lib/conversation-title-generator");
    const title = await generateConversationTitle({
      firstMessage: "Build a deployment checklist for me"
    });

    expect(title).toBe("Deployment Checklist");
    expect(runLocalTitleInference).toHaveBeenCalledWith("Build a deployment checklist for me");
  });

  it("treats empty sanitized output as a failure", async () => {
    runLocalTitleInference.mockResolvedValue('""');

    const { generateConversationTitle } = await import("@/lib/conversation-title-generator");

    await expect(
      generateConversationTitle({
        firstMessage: "Build a deployment checklist for me"
      })
    ).rejects.toThrow("Local model returned an empty title");
  });
});
```

- [ ] **Step 2: Run the title generator tests**

Run:
```bash
npx vitest run tests/unit/conversation-title-generator.test.ts
```
Expected: all 4 tests pass.

#### 6b: Update conversations.test.ts

The title generation tests in this file mock `generateConversationTitle` from `@/lib/conversation-title-generator` (line 40-42). This mock pattern stays the same. However, two tests need changes:

1. **"creates conversations with a pending placeholder title and generates it from the first user message"** (lines 88-114): Remove the assertion `expect(getConversation(conversation.id)?.providerProfileId).toBe(defaultProfileId)` — provider profile is no longer resolved during title generation.

2. **"fails title generation when provider profile has no API key"** (lines 406-442): **Delete this entire test.** There is no longer an API key check in the title generation path — the local model doesn't need one. The test setup (`updateSettings` with no-key profile) and all assertions are now invalid.

- [ ] **Step 3: Update the happy path test**

In the test `"creates conversations with a pending placeholder title and generates it from the first user message"`, find and remove this assertion:

```typescript
expect(getConversation(conversation.id)?.providerProfileId).toBe(defaultProfileId);
```

Also remove the `const defaultProfileId = getSettings().defaultProviderProfileId;` line if it was only used by that assertion.

- [ ] **Step 4: Delete the "fails title generation when provider profile has no API key" test**

Remove the entire test block at lines 406-442 (the test named `"fails title generation when provider profile has no API key"`).

- [ ] **Step 5: Run conversations tests**

Run:
```bash
npx vitest run tests/unit/conversations.test.ts
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/conversation-title-generator.test.ts tests/unit/conversations.test.ts
git commit -m "test: update title generation tests for local model"
```

---

### Task 7: Update Dockerfile

**Files:**
- Modify: `Dockerfile`

Add a step in the builder stage to pre-download the SmolLM2-135M-Instruct ONNX model (q4 quantized, ~118MB). Copy the model cache into the runner stage so it's available at runtime without network access.

- [ ] **Step 1: Add model download to builder stage**

After the existing `RUN npm run build` and `RUN npx esbuild ...` lines (line 19), add:

```dockerfile
RUN node -e "\
  const { pipeline, env } = require('@huggingface/transformers');\
  env.cacheDir = '/app/.cache/huggingface';\
  pipeline('text-generation', 'HuggingFaceTB/SmolLM2-135M-Instruct', { dtype: 'q4', device: 'cpu' })\
    .then(() => console.log('Model cached successfully'))\
    .catch((err) => { console.error('Model download failed:', err); process.exit(1); });\
"
```

- [ ] **Step 2: Copy model cache into runner stage**

After `COPY --from=builder /app/ws-handler-compiled.cjs ./ws-handler-compiled.cjs` (line 47), add:

```dockerfile
COPY --from=builder /app/.cache/huggingface /app/.cache/huggingface
```

- [ ] **Step 3: Verify Dockerfile syntax**

Run:
```bash
docker build --check . 2>&1 || echo "Docker build check not available, visual inspection OK"
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "docker: pre-download SmolLM2-135M title model during build"
```

---

### Task 8: Run Full Test Suite and Type Check

- [ ] **Step 1: Run type check**

Run:
```bash
npx next typegen && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2: Run linter**

Run:
```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Run full test suite**

Run:
```bash
npm run test
```
Expected: all tests pass, coverage meets 85% threshold.

- [ ] **Step 4: Commit any remaining fixes if needed**

---

### Task 9: Manual Smoke Test

- [ ] **Step 1: Start the dev server**

Run:
```bash
npm run dev
```

Wait for the `.dev-server` file to appear. On first run, the model will download (~118MB). Watch the console for download progress.

- [ ] **Step 2: Create a new conversation and send a message**

Open the browser at the dev server URL. Create a new conversation. Send a message like "How do I bake sourdough bread?". Verify that:
1. The assistant response streams normally (not blocked).
2. The conversation title updates from "Conversation" to something relevant (e.g., "Sourdough Bread Baking").
3. The title update happens within a few seconds.

- [ ] **Step 3: Send a paragraph-length first message**

Create another conversation. Send a paragraph like: "I'm planning a trip to Japan next spring and I want to visit Tokyo, Kyoto, and Osaka. Can you help me create a 2-week itinerary that includes both cultural experiences and modern attractions?". Verify the generated title is relevant.

- [ ] **Step 4: Verify the model is not visible in the UI**

Check that the local model does not appear in:
- Settings/provider configuration pages
- Sidebar model selector
- Any user-facing UI

- [ ] **Step 5: Stop the dev server and clean up**

Kill the dev server. Delete any temporary test data.
