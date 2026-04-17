# Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global text-to-image generation to Eidon with a composer toggle, Google Nano Banana and remote ComfyUI backends, and local persistence through the existing attachment system.

**Architecture:** Store image backend configuration in `app_settings` as admin-managed global settings, not in per-user `user_settings`. Carry a new per-send `mode` flag (`chat | image`) through the existing websocket/SSE transport, queued-message pipeline, and bootstrap payloads. Resolve image turns through a new orchestration layer that compiles recent conversation context into a structured image request using the active chat provider, then dispatches to the configured image backend and stores the returned bytes as normal assistant attachments.

**Tech Stack:** Next.js 15 route handlers, React 19, TypeScript, SQLite via `better-sqlite3`, Vitest, Playwright, `@google/genai`, native `fetch`, native WebSocket.

---

## File Structure

- Modify: `lib/types.ts:9-121,182-192,430-447`
  Add global image-generation settings types, per-send mode types, queued message mode, and enrich `done` events with the finalized message payload.
- Modify: `lib/db.ts:213-224,354-372,500-544`
  Add `queued_messages.mode` and global image-generation columns on `app_settings`.
- Modify: `lib/settings.ts:112-205,280-338,539-710`
  Parse, read, sanitize, and update global image-generation settings while continuing to merge per-user and global settings cleanly.
- Create: `app/api/settings/image-generation/route.ts`
  Admin-only route for saving global image backend settings.
- Create: `app/api/settings/image-generation/test/route.ts`
  Admin-only ComfyUI workflow smoke-test route.
- Modify: `components/settings/sections/general-section.tsx:11-339`
  Add the new image-generation card with its own save/test actions and admin/read-only behavior.
- Modify: `app/settings/general/page.tsx:1-9`
  Pass the current user role into `GeneralSection`.
- Modify: `app/page.tsx:24-31`
  Pass image-generation availability to `HomeView`.
- Modify: `app/chat/[conversationId]/page.tsx:63-75`
  Pass image-generation availability to `ChatView`.
- Modify: `components/chat-composer.tsx:29-60,186-520`
  Add the image-mode icon toggle and disabled states.
- Modify: `components/home-view.tsx:18-118,236-269,333-360`
  Persist image mode into the bootstrap payload for new conversations.
- Modify: `components/chat-view.tsx:500-505,629-810,937-956,1508-1600,1803-1835`
  Send `mode` through live and queued websocket traffic and reconcile finalized assistant messages with attachments.
- Modify: `lib/chat-bootstrap.ts:1-28`
  Persist image mode through the home-to-chat bootstrap handoff.
- Modify: `lib/ws-protocol.ts:1-41`
  Add `mode` to `message` and `queue_message` payloads.
- Modify: `lib/ws-handler.ts:146-257`
  Persist queued message mode and pass live mode into `startChatTurn`.
- Modify: `lib/conversations.ts:937-1289`
  Store and read queued-message mode from SQLite.
- Modify: `lib/queued-chat-dispatcher.ts:22-80`
  Preserve queued mode when dispatching deferred sends.
- Modify: `lib/provider.ts:343-405`
  Extend `callProviderText` so it can be used for image-instruction compilation.
- Create: `lib/image-generation/types.ts`
  Shared request/result/configuration types for image backends and orchestration.
- Create: `lib/image-generation/compile-image-instruction.ts`
  Convert recent conversation context into a structured text-to-image request.
- Create: `lib/image-generation/google-nano-banana.ts`
  Google image backend adapter using `@google/genai`.
- Create: `lib/image-generation/comfyui.ts`
  Remote ComfyUI adapter with API-format workflow injection and output retrieval.
- Create: `lib/image-generation/run-image-turn.ts`
  Top-level orchestration that compiles, dispatches, stores images, and returns the finalized assistant message.
- Modify: `lib/chat-turn.ts:1-248`
  Branch `startChatTurn` between normal chat turns and image turns.
- Modify: `app/api/conversations/[conversationId]/chat/route.ts:29-170`
  Keep HTTP/SSE parity with websocket chat by accepting `mode`.
- Modify: `package.json` and `package-lock.json`
  Add `@google/genai`.
- Test: `tests/unit/settings.test.ts`
- Test: `tests/unit/general-section.test.tsx`
- Test: `tests/unit/ws-protocol.test.ts`
- Test: `tests/unit/ws-handler.test.ts`
- Test: `tests/unit/conversations.test.ts`
- Test: `tests/unit/queued-chat-dispatcher.test.ts`
- Test: `tests/unit/home-view.test.tsx`
- Test: `tests/unit/chat-view.test.ts`
- Create: `tests/unit/image-generation/compile-image-instruction.test.ts`
- Create: `tests/unit/image-generation/google-nano-banana.test.ts`
- Create: `tests/unit/image-generation/comfyui.test.ts`
- Test: `tests/unit/chat-turn.test.ts`
- Test: `tests/e2e/features.spec.ts`

## Task 1: Add Global Image-Generation Settings Persistence

**Files:**
- Modify: `lib/types.ts:9-121`
- Modify: `lib/db.ts:354-372,500-523`
- Modify: `lib/settings.ts:112-205,280-338,539-710`
- Test: `tests/unit/settings.test.ts:433-783`

- [ ] **Step 1: Write the failing persistence tests**

```ts
it("stores global image generation settings in app_settings and sanitizes secrets", async () => {
  const admin = await createLocalUser({
    username: "image-admin",
    password: "changeme123",
    role: "admin"
  });

  updateImageGenerationSettings({
    imageGenerationBackend: "google_nano_banana",
    googleNanoBananaModel: "gemini-3.1-flash-image-preview",
    googleNanoBananaApiKey: "google-secret",
    comfyuiBaseUrl: "https://comfy.example.com",
    comfyuiAuthType: "bearer",
    comfyuiBearerToken: "comfy-secret",
    comfyuiWorkflowJson: "{\"3\":{\"inputs\":{\"text\":\"prompt\"}}}",
    comfyuiPromptPath: "3.inputs.text",
    comfyuiNegativePromptPath: "",
    comfyuiWidthPath: "",
    comfyuiHeightPath: "",
    comfyuiSeedPath: ""
  });

  expect(getSettings()).toMatchObject({
    imageGenerationBackend: "google_nano_banana",
    googleNanoBananaModel: "gemini-3.1-flash-image-preview",
    googleNanoBananaApiKey: "google-secret",
    comfyuiAuthType: "bearer",
    comfyuiBearerToken: "comfy-secret"
  });

  expect(getSanitizedSettings(admin.id)).toMatchObject({
    imageGenerationBackend: "google_nano_banana",
    googleNanoBananaModel: "gemini-3.1-flash-image-preview",
    googleNanoBananaApiKey: "",
    hasGoogleNanoBananaApiKey: true,
    comfyuiBearerToken: "",
    hasComfyuiBearerToken: true
  });
});

it("applies global image generation settings to every user", async () => {
  const user = await createLocalUser({
    username: "image-user",
    password: "changeme123",
    role: "user"
  });

  updateImageGenerationSettings({
    imageGenerationBackend: "comfyui",
    googleNanoBananaModel: "gemini-3.1-flash-image-preview",
    googleNanoBananaApiKey: "",
    comfyuiBaseUrl: "https://comfy.example.com",
    comfyuiAuthType: "none",
    comfyuiBearerToken: "",
    comfyuiWorkflowJson: "{\"3\":{\"inputs\":{\"text\":\"prompt\"}}}",
    comfyuiPromptPath: "3.inputs.text",
    comfyuiNegativePromptPath: "",
    comfyuiWidthPath: "",
    comfyuiHeightPath: "",
    comfyuiSeedPath: ""
  });

  expect(getSettingsForUser(user.id)).toMatchObject({
    imageGenerationBackend: "comfyui",
    comfyuiBaseUrl: "https://comfy.example.com",
    comfyuiWorkflowJson: "{\"3\":{\"inputs\":{\"text\":\"prompt\"}}}"
  });
});
```

- [ ] **Step 2: Run the settings test file to verify the new cases fail**

```bash
npx vitest run tests/unit/settings.test.ts
```

Expected: FAIL with TypeScript or runtime errors referencing missing `updateImageGenerationSettings`, missing `AppSettings` fields, or missing `app_settings` columns.

- [ ] **Step 3: Implement the global settings types, schema, and storage**

```ts
// lib/types.ts
export type ImageGenerationBackend = "disabled" | "google_nano_banana" | "comfyui";
export type GoogleNanoBananaModel =
  | "gemini-2.5-flash-image"
  | "gemini-3.1-flash-image-preview"
  | "gemini-3-pro-image-preview";
export type ChatInputMode = "chat" | "image";

export type AppSettings = {
  defaultProviderProfileId: string | null;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  mcpTimeout: number;
  sttEngine: SttEngine;
  sttLanguage: SttLanguage;
  webSearchEngine: WebSearchEngine;
  exaApiKey: string;
  tavilyApiKey: string;
  searxngBaseUrl: string;
  imageGenerationBackend: ImageGenerationBackend;
  googleNanoBananaModel: GoogleNanoBananaModel;
  googleNanoBananaApiKey: string;
  comfyuiBaseUrl: string;
  comfyuiAuthType: "none" | "bearer";
  comfyuiBearerToken: string;
  comfyuiWorkflowJson: string;
  comfyuiPromptPath: string;
  comfyuiNegativePromptPath: string;
  comfyuiWidthPath: string;
  comfyuiHeightPath: string;
  comfyuiSeedPath: string;
  updatedAt: string;
};
```

```ts
// lib/db.ts
if (!settingsColNames.includes("image_generation_backend")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN image_generation_backend TEXT NOT NULL DEFAULT 'disabled'");
}
if (!settingsColNames.includes("google_nano_banana_model")) {
  db.exec(
    "ALTER TABLE app_settings ADD COLUMN google_nano_banana_model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-image-preview'"
  );
}
if (!settingsColNames.includes("google_nano_banana_api_key_encrypted")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN google_nano_banana_api_key_encrypted TEXT NOT NULL DEFAULT ''");
}
if (!settingsColNames.includes("comfyui_base_url")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_base_url TEXT NOT NULL DEFAULT ''");
}
if (!settingsColNames.includes("comfyui_auth_type")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_auth_type TEXT NOT NULL DEFAULT 'none'");
}
if (!settingsColNames.includes("comfyui_bearer_token_encrypted")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_bearer_token_encrypted TEXT NOT NULL DEFAULT ''");
}
if (!settingsColNames.includes("comfyui_workflow_json")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_workflow_json TEXT NOT NULL DEFAULT ''");
}
if (!settingsColNames.includes("comfyui_prompt_path")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_prompt_path TEXT NOT NULL DEFAULT ''");
}
if (!settingsColNames.includes("comfyui_negative_prompt_path")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_negative_prompt_path TEXT NOT NULL DEFAULT ''");
}
if (!settingsColNames.includes("comfyui_width_path")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_width_path TEXT NOT NULL DEFAULT ''");
}
if (!settingsColNames.includes("comfyui_height_path")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_height_path TEXT NOT NULL DEFAULT ''");
}
if (!settingsColNames.includes("comfyui_seed_path")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN comfyui_seed_path TEXT NOT NULL DEFAULT ''");
}
```

```ts
// lib/settings.ts
const imageGenerationSettingsInputSchema = z.object({
  imageGenerationBackend: z.enum(["disabled", "google_nano_banana", "comfyui"]).optional(),
  googleNanoBananaModel: z
    .enum([
      "gemini-2.5-flash-image",
      "gemini-3.1-flash-image-preview",
      "gemini-3-pro-image-preview"
    ])
    .optional(),
  googleNanoBananaApiKey: z.string().optional(),
  comfyuiBaseUrl: z.string().optional(),
  comfyuiAuthType: z.enum(["none", "bearer"]).optional(),
  comfyuiBearerToken: z.string().optional(),
  comfyuiWorkflowJson: z.string().optional(),
  comfyuiPromptPath: z.string().optional(),
  comfyuiNegativePromptPath: z.string().optional(),
  comfyuiWidthPath: z.string().optional(),
  comfyuiHeightPath: z.string().optional(),
  comfyuiSeedPath: z.string().optional()
});

export function updateImageGenerationSettings(input: ImageGenerationSettingsInput) {
  const current = getSettings();
  const next = validateImageGenerationSettings({
    imageGenerationBackend: input.imageGenerationBackend ?? current.imageGenerationBackend,
    googleNanoBananaModel: input.googleNanoBananaModel ?? current.googleNanoBananaModel,
    googleNanoBananaApiKey: input.googleNanoBananaApiKey ?? current.googleNanoBananaApiKey,
    comfyuiBaseUrl: normalizeComfyUiBaseUrl(input.comfyuiBaseUrl ?? current.comfyuiBaseUrl),
    comfyuiAuthType: input.comfyuiAuthType ?? current.comfyuiAuthType,
    comfyuiBearerToken: input.comfyuiBearerToken ?? current.comfyuiBearerToken,
    comfyuiWorkflowJson: input.comfyuiWorkflowJson ?? current.comfyuiWorkflowJson,
    comfyuiPromptPath: input.comfyuiPromptPath ?? current.comfyuiPromptPath,
    comfyuiNegativePromptPath: input.comfyuiNegativePromptPath ?? current.comfyuiNegativePromptPath,
    comfyuiWidthPath: input.comfyuiWidthPath ?? current.comfyuiWidthPath,
    comfyuiHeightPath: input.comfyuiHeightPath ?? current.comfyuiHeightPath,
    comfyuiSeedPath: input.comfyuiSeedPath ?? current.comfyuiSeedPath
  });

  getDb()
    .prepare(
      `UPDATE app_settings
       SET image_generation_backend = ?,
           google_nano_banana_model = ?,
           google_nano_banana_api_key_encrypted = ?,
           comfyui_base_url = ?,
           comfyui_auth_type = ?,
           comfyui_bearer_token_encrypted = ?,
           comfyui_workflow_json = ?,
           comfyui_prompt_path = ?,
           comfyui_negative_prompt_path = ?,
           comfyui_width_path = ?,
           comfyui_height_path = ?,
           comfyui_seed_path = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.imageGenerationBackend,
      next.googleNanoBananaModel,
      next.googleNanoBananaApiKey ? encryptValue(next.googleNanoBananaApiKey) : "",
      next.comfyuiBaseUrl,
      next.comfyuiAuthType,
      next.comfyuiBearerToken ? encryptValue(next.comfyuiBearerToken) : "",
      next.comfyuiWorkflowJson,
      next.comfyuiPromptPath,
      next.comfyuiNegativePromptPath,
      next.comfyuiWidthPath,
      next.comfyuiHeightPath,
      next.comfyuiSeedPath,
      new Date().toISOString(),
      SETTINGS_ROW_ID
    );
}
```

- [ ] **Step 4: Re-run the settings tests**

```bash
npx vitest run tests/unit/settings.test.ts
```

Expected: PASS for the new image-generation persistence tests and existing settings tests.

- [ ] **Step 5: Commit the persistence layer**

```bash
git add lib/types.ts lib/db.ts lib/settings.ts tests/unit/settings.test.ts
git commit -m "feat: add global image generation settings"
```

## Task 2: Add The Admin-Managed Image Generation Settings Card

**Files:**
- Create: `app/api/settings/image-generation/route.ts`
- Modify: `app/settings/general/page.tsx:1-9`
- Modify: `components/settings/sections/general-section.tsx:11-339`
- Test: `tests/unit/general-section.test.tsx:1-335`
- Test: `tests/unit/settings.test.ts:510-718`

- [ ] **Step 1: Write the failing UI and route tests**

```ts
// tests/unit/general-section.test.tsx
it("renders an image generation card under web search and saves through the image settings route", async () => {
  const settings = makeSettings({
    imageGenerationBackend: "google_nano_banana",
    googleNanoBananaModel: "gemini-3.1-flash-image-preview",
    hasGoogleNanoBananaApiKey: true
  });

  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ settings })
  } as Response);

  render(
    React.createElement(GeneralSection, {
      settings,
      canManageImageGeneration: true
    })
  );

  expect(screen.getByRole("heading", { name: "Image Generation" })).toBeInTheDocument();
  expect(screen.getByLabelText("Image generation backend")).toHaveValue("google_nano_banana");

  fireEvent.click(screen.getByRole("button", { name: "Save image settings" }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/settings/image-generation",
      expect.objectContaining({ method: "PUT" })
    );
  });
});

it("renders the image generation card as read-only for non-admin users", () => {
  render(
    React.createElement(GeneralSection, {
      settings: makeSettings(),
      canManageImageGeneration: false
    })
  );

  expect(screen.getByText("Only admins can change image generation settings.")).toBeInTheDocument();
  expect(screen.getByLabelText("Image generation backend")).toBeDisabled();
});
```

```ts
// tests/unit/settings.test.ts
it("rejects image generation updates from non-admin users", async () => {
  vi.resetModules();
  const { createLocalUser } = await import("@/lib/users");
  const { PUT } = await import("@/app/api/settings/image-generation/route");

  const user = await createLocalUser({
    username: "image-route-user",
    password: "changeme123",
    role: "user"
  });

  requireUserMock.mockResolvedValue(user);

  const response = await PUT(
    new Request("http://localhost/api/settings/image-generation", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageGenerationBackend: "google_nano_banana" })
    })
  );

  expect(response.status).toBe(403);
});
```

- [ ] **Step 2: Run the targeted general/settings tests**

```bash
npx vitest run tests/unit/general-section.test.tsx tests/unit/settings.test.ts
```

Expected: FAIL with missing `canManageImageGeneration`, missing route module, and missing image card fields.

- [ ] **Step 3: Implement the admin-only route and card**

```ts
// app/api/settings/image-generation/route.ts
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import {
  getSanitizedSettings,
  parseImageGenerationSettingsInput,
  updateImageGenerationSettings
} from "@/lib/settings";

export async function PUT(request: Request) {
  const user = await requireUser();

  if (user.role !== "admin") {
    return badRequest("Only admins can update image generation settings", 403);
  }

  const body = await request.json().catch(() => ({}));
  let payload;
  try {
    payload = parseImageGenerationSettingsInput(body);
  } catch {
    return badRequest("Invalid image generation settings payload");
  }

  try {
    updateImageGenerationSettings(payload);
    return ok({ settings: getSanitizedSettings(user.id) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest("Invalid image generation settings payload");
    }

    throw error;
  }
}
```

```tsx
// app/settings/general/page.tsx
export default async function GeneralPage() {
  const user = await requireUser();
  const settings = getSanitizedSettings(user.id);

  return (
    <GeneralSection
      settings={settings}
      canManageImageGeneration={user.role === "admin"}
    />
  );
}
```

```tsx
// components/settings/sections/general-section.tsx
type GeneralSectionSettings = AppSettings & {
  hasExaApiKey?: boolean;
  hasTavilyApiKey?: boolean;
  hasGoogleNanoBananaApiKey?: boolean;
  hasComfyuiBearerToken?: boolean;
};

export function GeneralSection({
  settings,
  canManageImageGeneration
}: {
  settings: GeneralSectionSettings;
  canManageImageGeneration: boolean;
}) {
  const [imageGenerationBackend, setImageGenerationBackend] = useState(settings.imageGenerationBackend);
  const [googleNanoBananaModel, setGoogleNanoBananaModel] = useState(settings.googleNanoBananaModel);
  const [googleNanoBananaApiKey, setGoogleNanoBananaApiKey] = useState(settings.googleNanoBananaApiKey);
  const [comfyuiBaseUrl, setComfyuiBaseUrl] = useState(settings.comfyuiBaseUrl);
  const [comfyuiAuthType, setComfyuiAuthType] = useState(settings.comfyuiAuthType);
  const [comfyuiBearerToken, setComfyuiBearerToken] = useState(settings.comfyuiBearerToken);
  const [comfyuiWorkflowJson, setComfyuiWorkflowJson] = useState(settings.comfyuiWorkflowJson);
  const [comfyuiPromptPath, setComfyuiPromptPath] = useState(settings.comfyuiPromptPath);
  const [comfyuiNegativePromptPath, setComfyuiNegativePromptPath] = useState(settings.comfyuiNegativePromptPath);
  const [comfyuiWidthPath, setComfyuiWidthPath] = useState(settings.comfyuiWidthPath);
  const [comfyuiHeightPath, setComfyuiHeightPath] = useState(settings.comfyuiHeightPath);
  const [comfyuiSeedPath, setComfyuiSeedPath] = useState(settings.comfyuiSeedPath);

  async function saveImageSettings() {
    resetMessages();
    const response = await fetch("/api/settings/image-generation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageGenerationBackend,
        googleNanoBananaModel,
        googleNanoBananaApiKey: googleNanoBananaApiKey.trim(),
        comfyuiBaseUrl: comfyuiBaseUrl.trim(),
        comfyuiAuthType,
        comfyuiBearerToken: comfyuiBearerToken.trim(),
        comfyuiWorkflowJson,
        comfyuiPromptPath: comfyuiPromptPath.trim(),
        comfyuiNegativePromptPath: comfyuiNegativePromptPath.trim(),
        comfyuiWidthPath: comfyuiWidthPath.trim(),
        comfyuiHeightPath: comfyuiHeightPath.trim(),
        comfyuiSeedPath: comfyuiSeedPath.trim()
      })
    });

    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Unable to save image settings");
      return;
    }

    setSuccess("Image settings saved.");
    router.refresh();
  }
}
```

- [ ] **Step 4: Re-run the UI and route tests**

```bash
npx vitest run tests/unit/general-section.test.tsx tests/unit/settings.test.ts
```

Expected: PASS for the new image settings card and admin route coverage.

- [ ] **Step 5: Commit the settings card**

```bash
git add app/api/settings/image-generation/route.ts app/settings/general/page.tsx components/settings/sections/general-section.tsx tests/unit/general-section.test.tsx tests/unit/settings.test.ts
git commit -m "feat: add admin image generation settings card"
```

## Task 3: Carry Image Mode Through WebSocket And Queued Message Persistence

**Files:**
- Modify: `lib/types.ts:182-192,430-447`
- Modify: `lib/db.ts:213-224`
- Modify: `lib/conversations.ts:937-1289`
- Modify: `lib/ws-protocol.ts:1-41`
- Modify: `lib/ws-handler.ts:146-257`
- Modify: `lib/queued-chat-dispatcher.ts:22-80`
- Test: `tests/unit/ws-protocol.test.ts`
- Test: `tests/unit/ws-handler.test.ts:150-238`
- Test: `tests/unit/conversations.test.ts:1646-1766`
- Test: `tests/unit/queued-chat-dispatcher.test.ts`

- [ ] **Step 1: Write the failing protocol and queue tests**

```ts
// tests/unit/ws-protocol.test.ts
it("round-trips message mode through the websocket protocol", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      type: "message",
      conversationId: "conv-1",
      content: "same idea but darker",
      mode: "image"
    })
  );

  expect(parsed).toEqual({
    type: "message",
    conversationId: "conv-1",
    content: "same idea but darker",
    mode: "image"
  });
});
```

```ts
// tests/unit/queued-chat-dispatcher.test.ts
it("dispatches queued image-mode messages with their original mode", async () => {
  const { createConversation, createQueuedMessage } = await import("@/lib/conversations");
  const conversation = createConversation({ userId: "user-1" });
  createQueuedMessage({
    conversationId: conversation.id,
    content: "make it noir",
    mode: "image"
  });

  const startChatTurn = vi.fn(async () => ({ status: "completed" as const }));

  await ensureQueuedDispatch({
    manager,
    conversationId: conversation.id,
    startChatTurn
  });

  expect(startChatTurn).toHaveBeenCalledWith(
    manager,
    conversation.id,
    "make it noir",
    [],
    undefined,
    expect.objectContaining({ mode: "image" })
  );
});
```

- [ ] **Step 2: Run the websocket and queue tests**

```bash
npx vitest run tests/unit/ws-protocol.test.ts tests/unit/ws-handler.test.ts tests/unit/conversations.test.ts tests/unit/queued-chat-dispatcher.test.ts
```

Expected: FAIL with missing `mode` fields on queued messages, websocket payloads, and dispatcher calls.

- [ ] **Step 3: Implement `mode` in the protocol, queue schema, and dispatcher**

```ts
// lib/types.ts
export type QueuedMessage = {
  id: string;
  conversationId: string;
  content: string;
  mode: ChatInputMode;
  status: QueuedMessageStatus;
  sortOrder: number;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  processingStartedAt: string | null;
};

export type ChatStreamEvent =
  | { type: "message_start"; messageId: string }
  | { type: "thinking_delta"; text: string }
  | { type: "answer_delta"; text: string }
  | { type: "action_start"; action: MessageAction }
  | { type: "action_complete"; action: MessageAction }
  | { type: "action_error"; action: MessageAction }
  | { type: "compaction_start" }
  | { type: "compaction_end" }
  | { type: "system_notice"; text: string; kind: SystemMessageKind }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; reasoningTokens?: number }
  | { type: "done"; messageId: string; message?: Message }
  | { type: "error"; message: string };
```

```ts
// lib/ws-protocol.ts
export type ClientMessage =
  | { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string; mode?: ChatInputMode }
  | { type: "queue_message"; conversationId: string; content: string; mode?: ChatInputMode }
  | { type: "update_queued_message"; conversationId: string; queuedMessageId: string; content: string }
  | { type: "delete_queued_message"; conversationId: string; queuedMessageId: string }
  | { type: "send_queued_message_now"; conversationId: string; queuedMessageId: string };
```

```ts
// lib/conversations.ts
export function createQueuedMessage({
  conversationId,
  content,
  mode = "chat"
}: {
  conversationId: string;
  content: string;
  mode?: ChatInputMode;
}) {
  // insert `mode` into SQLite and hydrate it back out
}
```

```ts
// lib/queued-chat-dispatcher.ts
const result = await startChatTurn(
  manager,
  conversationId,
  queued.content,
  [],
  undefined,
  {
    source: "queue",
    mode: queued.mode,
    onMessagesCreated() {
      messagesCreated = true;
      deleteQueuedMessage({ conversationId, queuedMessageId: queued.id });
      broadcastQueueUpdated(manager, conversationId);
    }
  }
);
```

- [ ] **Step 4: Re-run the queue/protocol tests**

```bash
npx vitest run tests/unit/ws-protocol.test.ts tests/unit/ws-handler.test.ts tests/unit/conversations.test.ts tests/unit/queued-chat-dispatcher.test.ts
```

Expected: PASS with queued image-mode sends preserved end-to-end.

- [ ] **Step 5: Commit the transport work**

```bash
git add lib/types.ts lib/db.ts lib/conversations.ts lib/ws-protocol.ts lib/ws-handler.ts lib/queued-chat-dispatcher.ts tests/unit/ws-protocol.test.ts tests/unit/ws-handler.test.ts tests/unit/conversations.test.ts tests/unit/queued-chat-dispatcher.test.ts
git commit -m "feat: persist image mode through queued chat"
```

## Task 4: Add The Composer Image Toggle And Bootstrap Wiring

**Files:**
- Modify: `components/chat-composer.tsx:29-60,186-520`
- Modify: `components/home-view.tsx:18-118,236-269,333-360`
- Modify: `components/chat-view.tsx:500-505,937-956,1508-1600,1803-1835`
- Modify: `lib/chat-bootstrap.ts:1-28`
- Modify: `app/page.tsx:24-31`
- Modify: `app/chat/[conversationId]/page.tsx:63-75`
- Test: `tests/unit/home-view.test.tsx:233-360`
- Test: `tests/unit/chat-view.test.ts:939-1010,1538-1600`

- [ ] **Step 1: Write the failing home/chat view tests**

```ts
// tests/unit/home-view.test.tsx
it("stores image mode in the bootstrap payload when starting a new conversation", async () => {
  vi.mocked(global.fetch)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ personas: [] })
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversation: { id: "conv_new" } })
    } as Response);

  render(
    React.createElement(HomeView, {
      providerProfiles: [createProviderProfile()],
      defaultProviderProfileId: "profile_default",
      settings: {
        sttEngine: "browser",
        sttLanguage: "en",
        imageGenerationBackend: "google_nano_banana"
      }
    })
  );

  fireEvent.click(screen.getByRole("button", { name: "Toggle image generation mode" }));
  fireEvent.change(screen.getByPlaceholderText("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."), {
    target: { value: "Generate a poster of Seoul at dusk" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  await waitFor(() => expect(push).toHaveBeenCalledWith("/chat/conv_new"));
  expect(sessionStorage.getItem("eidon:chat-bootstrap:conv_new")).toContain("\"mode\":\"image\"");
});
```

```ts
// tests/unit/chat-view.test.ts
it("forwards bootstrapped image mode once the websocket is connected", async () => {
  bootstrapMock.readChatBootstrap.mockReturnValue({
    message: "Generate a matte painting",
    attachments: [],
    mode: "image"
  });

  renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

  await waitFor(() => {
    expect(wsMock.send).toHaveBeenCalledWith({
      type: "message",
      conversationId: "conv_1",
      content: "Generate a matte painting",
      attachmentIds: [],
      mode: "image"
    });
  });
});
```

- [ ] **Step 2: Run the home/chat view tests**

```bash
npx vitest run tests/unit/home-view.test.tsx tests/unit/chat-view.test.ts
```

Expected: FAIL with missing image-mode toggle props and missing bootstrap `mode`.

- [ ] **Step 3: Implement the image-mode toggle and bootstrap fields**

```ts
// lib/chat-bootstrap.ts
export type ChatBootstrapPayload = {
  message: string;
  attachments: MessageAttachment[];
  personaId?: string;
  mode?: ChatInputMode;
};
```

```tsx
// components/chat-composer.tsx
type ChatComposerProps = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  isSending: boolean;
  pendingAttachments: MessageAttachment[];
  isUploadingAttachments: boolean;
  onUploadFiles: (files: File[]) => Promise<void>;
  onRemovePendingAttachment: (attachmentId: string) => Promise<void>;
  showVisionWarning: boolean;
  providerProfiles: ProviderProfileSummary[];
  providerProfileId: string;
  onProviderProfileChange: (providerProfileId: string) => void | Promise<void>;
  personas: Array<{ id: string; name: string }>;
  personaId: string | null;
  onPersonaChange: (personaId: string | null) => void | Promise<void>;
  imageMode: ChatInputMode;
  imageModeEnabled: boolean;
  onImageModeChange: (mode: ChatInputMode) => void;
  imageModeDisabledReason?: string | null;
  // existing props...
};
```

```tsx
// components/home-view.tsx + components/chat-view.tsx
const [submitMode, setSubmitMode] = useState<ChatInputMode>("chat");

storeChatBootstrap(conversationId, {
  message: value,
  attachments: pendingAttachments,
  personaId: personaId ?? undefined,
  mode: submitMode
});

wsSend({
  type: "message",
  conversationId: payload.conversation.id,
  content: value,
  attachmentIds: nextPendingAttachments.map((attachment) => attachment.id),
  personaId: effectivePersonaId ?? undefined,
  mode: submitMode
});
```

- [ ] **Step 4: Re-run the home/chat tests**

```bash
npx vitest run tests/unit/home-view.test.tsx tests/unit/chat-view.test.ts
```

Expected: PASS for the new image-mode toggle and bootstrap forwarding cases.

- [ ] **Step 5: Commit the composer toggle**

```bash
git add components/chat-composer.tsx components/home-view.tsx components/chat-view.tsx lib/chat-bootstrap.ts app/page.tsx app/chat/[conversationId]/page.tsx tests/unit/home-view.test.tsx tests/unit/chat-view.test.ts
git commit -m "feat: add composer image mode toggle"
```

## Task 5: Implement Image Instruction Compilation

**Files:**
- Create: `lib/image-generation/types.ts`
- Create: `lib/image-generation/compile-image-instruction.ts`
- Modify: `lib/provider.ts:343-405`
- Create: `tests/unit/image-generation/compile-image-instruction.test.ts`

- [ ] **Step 1: Write the failing compiler tests**

```ts
import { compileImageInstruction, extractJsonObject } from "@/lib/image-generation/compile-image-instruction";

it("extracts fenced JSON and defaults optional fields", async () => {
  const callProviderText = vi.fn().mockResolvedValue(`
\`\`\`json
{"imagePrompt":"cinematic Seoul skyline at dusk","assistantText":"Here is a first pass.","count":1}
\`\`\`
`);

  const instruction = await compileImageInstruction({
    settings: profile,
    promptMessages: [
      { role: "user", content: "Generate a cinematic Seoul skyline at dusk" }
    ],
    callProviderText
  });

  expect(instruction).toEqual({
    imagePrompt: "cinematic Seoul skyline at dusk",
    negativePrompt: "",
    assistantText: "Here is a first pass.",
    aspectRatio: "1:1",
    count: 1
  });
});

it("throws when the provider returns non-json output", async () => {
  const callProviderText = vi.fn().mockResolvedValue("just do something cool");

  await expect(
    compileImageInstruction({
      settings: profile,
      promptMessages: [{ role: "user", content: "make it noir" }],
      callProviderText
    })
  ).rejects.toThrow("Provider returned invalid image instruction JSON");
});
```

- [ ] **Step 2: Run the compiler test file**

```bash
npx vitest run tests/unit/image-generation/compile-image-instruction.test.ts
```

Expected: FAIL because the compiler module does not exist yet.

- [ ] **Step 3: Implement the compiler and extend `callProviderText` purpose**

```ts
// lib/provider.ts
export async function callProviderText(input: {
  settings: ProviderProfileWithApiKey;
  prompt: string;
  purpose: "compaction" | "test" | "title" | "image_instruction";
  conversationId?: string;
}) {
  // existing implementation remains the same
}
```

```ts
// lib/image-generation/compile-image-instruction.ts
const compiledInstructionSchema = z.object({
  imagePrompt: z.string().min(1),
  negativePrompt: z.string().default(""),
  assistantText: z.string().default(""),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  seed: z.number().int().nonnegative().optional(),
  count: z.number().int().min(1).max(4).default(1)
});

export function extractJsonObject(raw: string) {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? raw).trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Provider returned invalid image instruction JSON");
  }

  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

export async function compileImageInstruction(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  callProviderText?: typeof import("@/lib/provider").callProviderText;
}) {
  const call = input.callProviderText ?? callProviderText;
  const prompt = buildImageInstructionPrompt(input.promptMessages);
  const raw = await call({
    settings: input.settings,
    prompt,
    purpose: "image_instruction"
  });

  return compiledInstructionSchema.parse(extractJsonObject(raw));
}
```

- [ ] **Step 4: Re-run the compiler tests**

```bash
npx vitest run tests/unit/image-generation/compile-image-instruction.test.ts
```

Expected: PASS with structured image instructions parsed from provider output.

- [ ] **Step 5: Commit the compiler**

```bash
git add lib/provider.ts lib/image-generation/types.ts lib/image-generation/compile-image-instruction.ts tests/unit/image-generation/compile-image-instruction.test.ts
git commit -m "feat: compile image instructions from chat context"
```

## Task 6: Add The Google Nano Banana Backend

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/image-generation/google-nano-banana.ts`
- Create: `tests/unit/image-generation/google-nano-banana.test.ts`

- [ ] **Step 1: Write the failing Google backend tests**

```ts
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: Buffer.from("png-bytes").toString("base64")
                  }
                }
              ]
            }
          }
        ]
      })
    }
  }))
}));

it("returns image buffers from Google Nano Banana", async () => {
  const result = await generateGoogleNanoBananaImages({
    settings: {
      imageGenerationBackend: "google_nano_banana",
      googleNanoBananaModel: "gemini-3.1-flash-image-preview",
      googleNanoBananaApiKey: "google-secret"
    },
    instruction: {
      imagePrompt: "poster of Seoul at dusk",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    }
  });

  expect(result.images).toHaveLength(1);
  expect(result.images[0]).toMatchObject({
    mimeType: "image/png",
    filename: "generated-1.png"
  });
});
```

- [ ] **Step 2: Install the SDK and run the Google backend test**

```bash
npm install @google/genai
npx vitest run tests/unit/image-generation/google-nano-banana.test.ts
```

Expected: FAIL because `generateGoogleNanoBananaImages` does not exist yet.

- [ ] **Step 3: Implement the Google adapter**

```ts
// lib/image-generation/google-nano-banana.ts
import { GoogleGenAI, Modality } from "@google/genai";

export async function generateGoogleNanoBananaImages(input: {
  settings: Pick<AppSettings, "googleNanoBananaApiKey" | "googleNanoBananaModel">;
  instruction: CompiledImageInstruction;
}): Promise<GenerateImageResult> {
  const ai = new GoogleGenAI({ apiKey: input.settings.googleNanoBananaApiKey });
  const response = await ai.models.generateContent({
    model: input.settings.googleNanoBananaModel,
    contents: input.instruction.imagePrompt,
    config: {
      responseModalities: [Modality.IMAGE]
    }
  });

  const images = (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part): part is { inlineData: { mimeType: string; data: string } } =>
      Boolean(part && typeof part === "object" && "inlineData" in part && part.inlineData?.data)
    )
    .map((part, index) => ({
      bytes: Buffer.from(part.inlineData.data, "base64"),
      mimeType: part.inlineData.mimeType,
      filename: `generated-${index + 1}.${part.inlineData.mimeType.split("/")[1] ?? "png"}`
    }));

  if (!images.length) {
    throw new Error("Google Nano Banana returned no images");
  }

  return {
    assistantText: input.instruction.assistantText || "",
    images
  };
}
```

- [ ] **Step 4: Re-run the Google backend test**

```bash
npx vitest run tests/unit/image-generation/google-nano-banana.test.ts
```

Expected: PASS with mocked Google API responses decoded into attachment-ready buffers.

- [ ] **Step 5: Commit the Google backend**

```bash
git add package.json package-lock.json lib/image-generation/google-nano-banana.ts tests/unit/image-generation/google-nano-banana.test.ts
git commit -m "feat: add google nano banana backend"
```

## Task 7: Add The Remote ComfyUI Backend And Admin Smoke Test

**Files:**
- Create: `lib/image-generation/comfyui.ts`
- Create: `app/api/settings/image-generation/test/route.ts`
- Modify: `components/settings/sections/general-section.tsx:150-339`
- Create: `tests/unit/image-generation/comfyui.test.ts`
- Test: `tests/unit/general-section.test.tsx`
- Test: `tests/unit/settings.test.ts`

- [ ] **Step 1: Write the failing ComfyUI tests**

```ts
it("injects mapped values into the workflow and downloads output images", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ prompt_id: "prompt-1" })
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        "prompt-1": {
          outputs: {
            "9": {
              images: [
                {
                  filename: "out.png",
                  subfolder: "",
                  type: "output"
                }
              ]
            }
          }
        }
      })
    })
    .mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      headers: new Headers({ "content-type": "image/png" })
    });

  const result = await generateComfyUiImages({
    settings: {
      comfyuiBaseUrl: "https://comfy.example.com",
      comfyuiAuthType: "bearer",
      comfyuiBearerToken: "secret",
      comfyuiWorkflowJson: "{\"3\":{\"inputs\":{\"text\":\"old\"}}}",
      comfyuiPromptPath: "3.inputs.text",
      comfyuiNegativePromptPath: "",
      comfyuiWidthPath: "",
      comfyuiHeightPath: "",
      comfyuiSeedPath: ""
    },
    instruction: {
      imagePrompt: "new prompt",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    },
    clientId: "client-1",
    fetchImpl: fetchMock,
    connectWebSocket: async () => ({
      waitForPromptDone: async () => {},
      close: () => {}
    })
  });

  expect(result.images[0]).toMatchObject({
    mimeType: "image/png",
    filename: "out.png"
  });
});
```

```ts
// tests/unit/general-section.test.tsx
it("shows a test workflow button for ComfyUI and calls the test route", async () => {
  render(
    React.createElement(GeneralSection, {
      settings: makeSettings({
        imageGenerationBackend: "comfyui",
        comfyuiBaseUrl: "https://comfy.example.com"
      }),
      canManageImageGeneration: true
    })
  );

  fireEvent.click(screen.getByRole("button", { name: "Test ComfyUI workflow" }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/settings/image-generation/test",
      expect.objectContaining({ method: "POST" })
    );
  });
});
```

- [ ] **Step 2: Run the ComfyUI tests**

```bash
npx vitest run tests/unit/image-generation/comfyui.test.ts tests/unit/general-section.test.tsx tests/unit/settings.test.ts
```

Expected: FAIL because the ComfyUI adapter and smoke-test route do not exist yet.

- [ ] **Step 3: Implement workflow injection, queue/history/view calls, and the test route**

```ts
// lib/image-generation/comfyui.ts
function setPathValue(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split(".").filter(Boolean);
  let cursor: Record<string, unknown> = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    const next = cursor[key];
    if (!next || typeof next !== "object") {
      throw new Error(`Invalid ComfyUI mapping path: ${path}`);
    }
    cursor = next as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]] = value;
}

export async function generateComfyUiImages(input: { /* settings + instruction */ }) {
  const prompt = JSON.parse(input.settings.comfyuiWorkflowJson) as Record<string, unknown>;
  setPathValue(prompt, input.settings.comfyuiPromptPath, input.instruction.imagePrompt);
  if (input.settings.comfyuiNegativePromptPath && input.instruction.negativePrompt) {
    setPathValue(prompt, input.settings.comfyuiNegativePromptPath, input.instruction.negativePrompt);
  }

  const queueResponse = await input.fetchImpl(`${input.settings.comfyuiBaseUrl}/prompt`, {
    method: "POST",
    headers: buildComfyUiHeaders(input.settings),
    body: JSON.stringify({ prompt, client_id: input.clientId, prompt_id: input.promptId })
  });

  // wait for websocket completion, then GET /history/{prompt_id} and GET /view?... for each image
}
```

```ts
// app/api/settings/image-generation/test/route.ts
export async function POST(request: Request) {
  const user = await requireUser();

  if (user.role !== "admin") {
    return badRequest("Only admins can test image generation settings", 403);
  }

  const payload = parseImageGenerationSettingsInput(await request.json().catch(() => ({})));
  if (payload.imageGenerationBackend !== "comfyui") {
    return badRequest("ComfyUI testing is only available when the ComfyUI backend is selected");
  }

  await generateComfyUiImages({
    settings: payloadToValidatedComfyUiSettings(payload),
    instruction: {
      imagePrompt: "Generate a simple blue square icon.",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    }
  });

  return ok({ ok: true });
}
```

- [ ] **Step 4: Re-run the ComfyUI tests**

```bash
npx vitest run tests/unit/image-generation/comfyui.test.ts tests/unit/general-section.test.tsx tests/unit/settings.test.ts
```

Expected: PASS with workflow smoke-test coverage and admin-only route behavior.

- [ ] **Step 5: Commit the ComfyUI work**

```bash
git add lib/image-generation/comfyui.ts app/api/settings/image-generation/test/route.ts components/settings/sections/general-section.tsx tests/unit/image-generation/comfyui.test.ts tests/unit/general-section.test.tsx tests/unit/settings.test.ts
git commit -m "feat: add comfyui image backend"
```

## Task 8: Integrate Image Turns Into Chat Execution And Attachment Storage

**Files:**
- Create: `lib/image-generation/run-image-turn.ts`
- Modify: `lib/chat-turn.ts:1-248`
- Modify: `app/api/conversations/[conversationId]/chat/route.ts:29-170`
- Modify: `components/chat-view.tsx:629-810`
- Test: `tests/unit/chat-turn.test.ts`
- Test: `tests/unit/chat-view.test.ts`

- [ ] **Step 1: Write the failing runtime integration tests**

```ts
// tests/unit/chat-turn.test.ts
it("creates an assistant message with generated image attachments for image mode", async () => {
  const { startChatTurn } = await import("@/lib/chat-turn");
  const imageRunner = vi.fn().mockResolvedValue({
    assistantMessage: {
      id: "msg_assistant_image",
      conversationId: conv.id,
      role: "assistant",
      content: "Here is a first pass.",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0,
      systemKind: null,
      compactedAt: null,
      createdAt: new Date().toISOString(),
      attachments: [
        {
          id: "att_generated",
          conversationId: conv.id,
          messageId: "msg_assistant_image",
          filename: "generated-1.png",
          mimeType: "image/png",
          byteSize: 3,
          sha256: "sha",
          relativePath: `${conv.id}/generated-1.png`,
          kind: "image",
          extractedText: "",
          createdAt: new Date().toISOString()
        }
      ]
    }
  });

  const result = await startChatTurn(manager, conv.id, "Make it noir", [], undefined, {
    mode: "image",
    runImageTurn: imageRunner
  });

  expect(result).toEqual({ status: "completed" });
  expect(getMessage("msg_assistant_image")?.attachments?.[0]?.filename).toBe("generated-1.png");
});
```

```ts
// tests/unit/chat-view.test.ts
it("replaces the assistant shell with the finalized assistant message from done events", async () => {
  renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

  act(() => {
    wsMock.onMessage?.({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant" }
    });
  });

  act(() => {
    wsMock.onMessage?.({
      type: "delta",
      conversationId: "conv_1",
      event: {
        type: "done",
        messageId: "msg_assistant",
        message: createMessage({
          id: "msg_assistant",
          role: "assistant",
          content: "Here is a first pass.",
          attachments: [createAttachment({ id: "att_generated" })]
        })
      }
    });
  });

  expect(screen.getByAltText("photo.png")).toBeInTheDocument();
  expect(screen.getByText("Here is a first pass.")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the runtime integration tests**

```bash
npx vitest run tests/unit/chat-turn.test.ts tests/unit/chat-view.test.ts
```

Expected: FAIL with missing `mode` branching, missing `runImageTurn`, or `done.message` being ignored by `ChatView`.

- [ ] **Step 3: Implement image-turn orchestration and finalized `done` messages**

```ts
// lib/image-generation/run-image-turn.ts
export async function runImageTurn(input: {
  conversationId: string;
  userId?: string;
  settings: ProviderProfileWithApiKey;
  appSettings: AppSettings;
  assistantMessageId: string;
  promptMessages: PromptMessage[];
}) {
  const compiled = await compileImageInstruction({
    settings: input.settings,
    promptMessages: input.promptMessages
  });

  const backendResult =
    input.appSettings.imageGenerationBackend === "google_nano_banana"
      ? await generateGoogleNanoBananaImages({ settings: input.appSettings, instruction: compiled })
      : await generateComfyUiImages({ settings: input.appSettings, instruction: compiled });

  const attachments = createAttachments(input.conversationId, backendResult.images);
  bindAttachmentsToMessage(
    input.conversationId,
    input.assistantMessageId,
    attachments.map((attachment) => attachment.id)
  );

  updateMessage(input.assistantMessageId, {
    content: backendResult.assistantText || `Generated ${attachments.length} image${attachments.length === 1 ? "" : "s"}.`,
    thinkingContent: "",
    status: "completed",
    estimatedTokens: estimateTextTokens(
      backendResult.assistantText || `Generated ${attachments.length} image${attachments.length === 1 ? "" : "s"}.`
    )
  });

  return {
    assistantMessage: getMessage(input.assistantMessageId)
  };
}
```

```ts
// lib/chat-turn.ts
export type StartChatTurn = (
  manager: ConversationManager,
  conversationId: string,
  content: string,
  attachmentIds: string[],
  personaId?: string,
  options?: {
    source?: "live" | "queue";
    mode?: ChatInputMode;
    onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void;
    runImageTurn?: typeof import("@/lib/image-generation/run-image-turn").runImageTurn;
  }
) => Promise<ChatTurnResult>;

if (options?.mode === "image") {
  const compacted = await ensureCompactedContext(conversation.id, settings, undefined, personaId, appSettings.memoriesEnabled);
  const executeImageTurn = options.runImageTurn ?? runImageTurn;
  const imageResult = await executeImageTurn({
    conversationId: conversation.id,
    userId: conversationOwnerId ?? undefined,
    settings,
    appSettings,
    assistantMessageId: assistantMessage.id,
    promptMessages: compacted.promptMessages
  });

  manager.broadcast(conversationId, {
    type: "delta",
    conversationId,
    event: {
      type: "done",
      messageId: assistantMessage.id,
      message: imageResult.assistantMessage ?? undefined
    }
  });

  return { status: "completed" };
}
```

```ts
// app/api/conversations/[conversationId]/chat/route.ts
const bodySchema = z
  .object({
    message: z.string(),
    attachmentIds: z.array(z.string().min(1)).default([]),
    mode: z.enum(["chat", "image"]).default("chat")
  })
  .refine(
    (value) => value.message.trim().length > 0 || value.attachmentIds.length > 0,
    "Chat message or attachment is required"
  );
```

- [ ] **Step 4: Re-run the chat-turn/chat-view tests**

```bash
npx vitest run tests/unit/chat-turn.test.ts tests/unit/chat-view.test.ts
```

Expected: PASS with assistant image attachments appearing immediately on completion.

- [ ] **Step 5: Commit the runtime integration**

```bash
git add lib/image-generation/run-image-turn.ts lib/chat-turn.ts app/api/conversations/[conversationId]/chat/route.ts components/chat-view.tsx tests/unit/chat-turn.test.ts tests/unit/chat-view.test.ts
git commit -m "feat: execute image turns through chat runtime"
```

## Task 9: Add End-To-End Coverage And Final Verification

**Files:**
- Modify: `tests/e2e/features.spec.ts`

- [ ] **Step 1: Add failing Playwright coverage for Google and ComfyUI image mode**

```ts
test.describe("Feature: Image generation", () => {
  test("submits an image-mode turn and renders the generated attachment in the transcript", async ({ page }) => {
    await signIn(page);
    await createNewChat(page);

    await page.getByRole("button", { name: "Toggle image generation mode" }).click();
    await page.getByPlaceholder("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break...").fill(
      "Generate a poster of Seoul at dusk"
    );

    // mock websocket/server responses so the assistant message finishes with an image attachment
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByAltText("generated-1.png")).toBeVisible();
    await expect(page.getByText("Generated 1 image.")).toBeVisible();
  });

  test("queues an image-mode follow-up while the agent is active", async ({ page }) => {
    await signIn(page);
    await createNewChat(page);

    await page.getByRole("button", { name: "Toggle image generation mode" }).click();
    await page.getByPlaceholder("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break...").fill(
      "Make it noir"
    );
    await page.getByRole("button", { name: "Queue follow-up" }).click();

    await expect(page.getByText("Make it noir")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the targeted e2e test**

```bash
npx playwright test tests/e2e/features.spec.ts --grep "Image generation"
```

Expected: FAIL until the mocked image-mode websocket flow is fully wired.

- [ ] **Step 3: Adjust any remaining accessibility labels or live-update glue required by the e2e assertions**

```tsx
// components/chat-composer.tsx
<button
  type="button"
  aria-label="Toggle image generation mode"
  aria-pressed={imageMode === "image"}
  disabled={!imageModeEnabled || isSending}
  onClick={() => onImageModeChange(imageMode === "image" ? "chat" : "image")}
>
  <ImageIcon className="h-4 w-4" />
</button>
```

- [ ] **Step 4: Run the focused e2e test again**

```bash
npx playwright test tests/e2e/features.spec.ts --grep "Image generation"
```

Expected: PASS with the image-mode transcript flow covered.

- [ ] **Step 5: Run the full verification suite**

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
```

Expected:
- `npm run lint`: exit 0
- `npm run typecheck`: exit 0
- `npm run test`: exit 0 with global coverage meeting the repo threshold
- `npm run test:e2e`: exit 0

- [ ] **Step 6: Commit the e2e coverage**

```bash
git add tests/e2e/features.spec.ts components/chat-composer.tsx
git commit -m "test: cover image generation flows"
```

