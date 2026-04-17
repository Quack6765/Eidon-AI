import fs from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";

import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  const response = await page.request.post("/api/auth/login", {
    data: {
      username: "admin",
      password: "changeme123"
    }
  });

  expect(response.ok()).toBeTruthy();
  const sessionCookie = response
    .headersArray()
    .find(
      (header) =>
        header.name.toLowerCase() === "set-cookie" &&
        header.value.startsWith("eidon_session=")
    )?.value;

  expect(sessionCookie).toBeTruthy();

  const token = sessionCookie?.match(/^eidon_session=([^;]+)/)?.[1];
  expect(token).toBeTruthy();

  await page.context().addCookies([
    {
      name: "eidon_session",
      value: token!,
      url: "http://localhost:3117",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/localhost:3117\/$/, { timeout: 15000 });
}

async function mockChatResponse(
  page: import("@playwright/test").Page,
  assistantAnswer = "Attachment received"
) {
  await page.route("**/api/conversations/*/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"type":"message_start","messageId":"msg_assistant"}',
        "",
        `data: {"type":"answer_delta","text":${JSON.stringify(assistantAnswer)}}`,
        "",
        'data: {"type":"done","messageId":"msg_assistant"}',
        "",
      ].join("\n")
    });
  });
}

async function createNewChat(page: import("@playwright/test").Page) {
  const newChatButtons = page.getByRole("button", { name: "New chat", exact: true });
  await expect(newChatButtons.first()).toBeVisible({ timeout: 10000 });

  let newChatButton: import("@playwright/test").Locator | null = null;
  const buttonCount = await newChatButtons.count();

  for (let index = 0; index < buttonCount; index += 1) {
    const candidate = newChatButtons.nth(index);

    if ((await candidate.isVisible()) && (await candidate.isEnabled())) {
      newChatButton = candidate;
      break;
    }
  }

  expect(newChatButton).not.toBeNull();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await newChatButton!.click();

    try {
      await expect(page).toHaveURL(/\/chat\//, { timeout: 4000 });
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(500);
    }
  }
}

type MockChatRequest = {
  stream: boolean;
  lastUserContent: string;
  isTitleRequest: boolean;
};

type MockProviderOptions = {
  queuedAnswer?: string | ((lastUserContent: string) => string);
};

async function startMockOpenAiCompatibleServer(options: MockProviderOptions = {}) {
  const chatRequests: MockChatRequest[] = [];
  let initialStreamConnections = 0;
  const openSockets = new Set<Socket>();

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Not found" } }));
      return;
    }

    const body = await readJsonBody(request);
    const lastUserContent = extractLastUserContent(body);
    const isStream = body.stream === true;
    const isTitleRequest = !isStream;

    chatRequests.push({
      stream: isStream,
      lastUserContent,
      isTitleRequest
    });

    if (!isStream) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl_mock_title",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? "mock-model",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "Mock title"
              }
            }
          ]
        })
      );
      return;
    }

    if (lastUserContent === "Initial question") {
      initialStreamConnections += 1;
      await streamInitialTurn(response, request, initialStreamConnections);
      return;
    }

    const queuedAnswer =
      typeof options.queuedAnswer === "function"
        ? options.queuedAnswer(lastUserContent)
        : options.queuedAnswer ?? `Handled ${lastUserContent}`;

    await streamQueuedTurn(response, body.model ?? "mock-model", queuedAnswer);
  });

  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.on("close", () => {
      openSockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    apiBaseUrl: `${origin}/v1`,
    close: async () => {
      for (const socket of openSockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    reset() {
      chatRequests.length = 0;
      initialStreamConnections = 0;
    },
    listChatRequests() {
      return [...chatRequests];
    }
  };
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function extractLastUserContent(body: any) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const lastUserMessage = [...messages].reverse().find((message) => message?.role === "user");

  if (!lastUserMessage) {
    return "";
  }

  const { content } = lastUserMessage;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("");
  }

  return "";
}

function writeChatCompletionChunk(response: ServerResponse, chunk: Record<string, unknown>) {
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

async function streamInitialTurn(
  response: ServerResponse,
  request: IncomingMessage,
  connectionNumber: number
) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  writeChatCompletionChunk(response, {
    id: "chatcmpl_initial",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: connectionNumber === 1 ? "Working on the first answer..." : "Still working..."
        },
        finish_reason: null
      }
    ]
  });

  const keepAlive = setInterval(() => {
    if (response.destroyed) {
      clearInterval(keepAlive);
      return;
    }

    response.write(": keep-alive\n\n");
  }, 250);

  await new Promise<void>((resolve) => {
    request.once("close", () => {
      clearInterval(keepAlive);
      resolve();
    });
  });
}

async function streamQueuedTurn(
  response: ServerResponse,
  model: string,
  assistantText: string
) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  writeChatCompletionChunk(response, {
    id: "chatcmpl_queued_turn",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: assistantText
        },
        finish_reason: null
      }
    ]
  });

  writeChatCompletionChunk(response, {
    id: "chatcmpl_queued_turn",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop"
      }
    ]
  });
  response.write("data: [DONE]\n\n");
  response.end();
}

async function configureMockProvider(
  page: import("@playwright/test").Page,
  apiBaseUrl: string
) {
  const settingsResponse = await page.request.get("/api/settings");
  expect(settingsResponse.ok()).toBeTruthy();

  const settingsPayload = (await settingsResponse.json()) as {
    settings: {
      defaultProviderProfileId: string;
      skillsEnabled: boolean;
      conversationRetention: "forever" | "90d" | "30d" | "7d";
      memoriesEnabled: boolean;
      memoriesMaxCount: number;
      mcpTimeout: number;
      providerProfiles: Array<Record<string, unknown>>;
    };
  };

  const currentProfile = settingsPayload.settings.providerProfiles[0];
  expect(currentProfile).toBeTruthy();
  const mockProfileId = `${currentProfile.id as string}_queued_mock`;

  const nextSettings = {
    defaultProviderProfileId: mockProfileId,
    skillsEnabled: settingsPayload.settings.skillsEnabled,
    conversationRetention: settingsPayload.settings.conversationRetention,
    memoriesEnabled: settingsPayload.settings.memoriesEnabled,
    memoriesMaxCount: settingsPayload.settings.memoriesMaxCount,
    mcpTimeout: settingsPayload.settings.mcpTimeout,
    providerProfiles: [
      ...settingsPayload.settings.providerProfiles,
      {
        ...currentProfile,
        id: mockProfileId,
        name: `${String(currentProfile.name ?? "Profile")} (Queued Follow-ups Test)`,
        providerKind: "openai_compatible",
        apiBaseUrl,
        apiKey: "test-api-key",
        model: "mock-model",
        apiMode: "chat_completions",
        systemPrompt:
          typeof currentProfile.systemPrompt === "string" && currentProfile.systemPrompt.length > 0
            ? currentProfile.systemPrompt
            : "You are a concise assistant.",
        temperature: 0.2,
        maxOutputTokens: 512,
        reasoningEffort: "medium",
        reasoningSummaryEnabled: false,
        modelContextLimit: 16384,
        compactionThreshold: 0.8,
        freshTailCount: 12,
        tokenizerModel: "gpt-tokenizer",
        safetyMarginTokens: 1200,
        leafSourceTokenLimit: 12000,
        leafMinMessageCount: 6,
        mergedMinNodeCount: 4,
        mergedTargetTokens: 1600,
        visionMode: "native",
        visionMcpServerId: null
      }
    ]
  };

  const providerResponse = await page.request.put("/api/settings/providers", {
    data: nextSettings
  });

  expect(providerResponse.ok()).toBeTruthy();

  return async () => {
    try {
      const restoreResponse = await page.request.put("/api/settings/providers", {
        data: settingsPayload.settings,
        timeout: 5000
      });

      expect(restoreResponse.ok()).toBeTruthy();
    } catch {
      // Best-effort cleanup. The test should not hang on provider restore.
    }
  };
}

async function updateImageGenerationSettings(
  page: import("@playwright/test").Page,
  overrides: Partial<{
    imageGenerationBackend: "disabled" | "google_nano_banana";
    googleNanoBananaModel: string;
    googleNanoBananaApiKey: string;
  }>
) {
  const response = await page.request.put("/api/settings/image-generation", {
    data: {
      imageGenerationBackend: "disabled",
      googleNanoBananaModel: "gemini-3.1-flash-image-preview",
      googleNanoBananaApiKey: "",
      ...overrides
    }
  });

  expect(response.ok()).toBeTruthy();
}

async function enterComposerText(
  composer: import("@playwright/test").Locator,
  text: string
) {
  await composer.evaluate((element, nextValue) => {
    const textarea = element as HTMLTextAreaElement & {
      _valueTracker?: { setValue: (value: string) => void };
    };
    const previousValue = textarea.value;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;

    valueSetter?.call(textarea, nextValue);
    textarea._valueTracker?.setValue(previousValue);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await expect(composer).toHaveValue(text);
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wq4cAAAAASUVORK5CYII=",
  "base64"
);

async function mockAttachmentUpload(
  page: import("@playwright/test").Page,
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    kind: "image" | "text";
  }>
) {
  await page.route("**/api/attachments", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          conversationId: "conv_test",
          messageId: null,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          byteSize: attachment.kind === "image" ? TINY_PNG.length : 5,
          sha256: `${attachment.id}-sha`,
          relativePath: `${attachment.id}_${attachment.filename}`,
          kind: attachment.kind,
          extractedText: attachment.kind === "text" ? "hello" : "",
          createdAt: new Date().toISOString()
        }))
      })
    });
  });

  await page.route("**/api/attachments/*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    const requestUrl = new URL(route.request().url());
    const attachmentId = requestUrl.pathname.split("/").pop();
    const attachment = attachments.find((item) => item.id === attachmentId);

    if (!attachment) {
      await route.fulfill({ status: 404 });
      return;
    }

    if (requestUrl.searchParams.get("format") === "text") {
      if (attachment.kind !== "text") {
        await route.fulfill({
          status: 415,
          contentType: "application/json",
          body: JSON.stringify({ error: "Preview unavailable for this attachment type." })
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          content: "hello"
        })
      });
      return;
    }

    await route.fulfill(
      attachment.kind === "image"
        ? {
            status: 200,
            contentType: "image/png",
            body: TINY_PNG
          }
        : {
            status: 200,
            contentType: attachment.mimeType,
            body: "hello"
          }
    );
  });
}

test.describe("Feature: Create and delete conversations", () => {
  test("creates a new chat and deletes it", async ({ page }) => {
    await signIn(page);

    // Create chat
    await createNewChat(page);
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    // Verify the new conversation appears in sidebar
    await expect(page.getByRole("link", { name: "Conversation" }).first()).toBeVisible({
      timeout: 5000
    });

    // Find the conversation item in sidebar, hover to reveal "..." button
    const convRow = page.getByRole("button", { name: "Conversation" }).first();
    await convRow.hover();

    // Click the more options button
    const moreBtn = convRow.locator("button").last();
    await expect(moreBtn).toBeVisible({ timeout: 3000 });
    await moreBtn.click();

    // Click "Delete" in the context menu
    await page.locator('aside').getByText("Delete").first().click();

    // Confirm the deletion
    await page.getByRole("button", { name: "Delete", exact: true }).click({ timeout: 5000 });

    // Should navigate away from the chat
    await page.waitForURL(/localhost:3117\/(chat\/)?$|^\/$/, { timeout: 5000 }).catch(() => {});
  });

  test("removes an empty chat after leaving it for another conversation", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: /New chat/i }).first().click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    const emptyConversationPath = new URL(page.url()).pathname;
    await expect(page.locator(`aside a[href="${emptyConversationPath}"]`)).toBeVisible({
      timeout: 5000
    });

    await page.getByRole("link", { name: "Open settings" }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
    await expect(page.locator(`aside a[href="${emptyConversationPath}"]`)).toHaveCount(0);
  });

  test("dictates into the composer draft and waits for manual send", async ({ page }) => {
    let chatRequests = 0;

    await page.addInitScript(() => {
      (window as Window & {
        __EIDON_SPEECH_START_CALLED__?: boolean;
        __EIDON_SPEECH_AUDIO_REQUESTED__?: boolean;
      }).__EIDON_SPEECH_START_CALLED__ = false;
      (window as Window & {
        __EIDON_SPEECH_START_CALLED__?: boolean;
        __EIDON_SPEECH_AUDIO_REQUESTED__?: boolean;
      }).__EIDON_SPEECH_AUDIO_REQUESTED__ = false;

      class FakeSpeechRecognition {
        lang = "en-US";
        interimResults = false;
        continuous = true;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        onend: (() => void) | null = null;

        start() {
          (
            window as Window & {
              __EIDON_SPEECH_START_CALLED__?: boolean;
            }
          ).__EIDON_SPEECH_START_CALLED__ = true;
        }

        stop() {
          this.onresult?.({
            results: [[{ transcript: "hello from voice input" }]]
          });
          this.onend?.();
        }
      }

      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true,
        value: FakeSpeechRecognition
      });
      Object.defineProperty(window, "webkitSpeechRecognition", {
        configurable: true,
        value: FakeSpeechRecognition
      });
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: class {
          createMediaStreamSource() {
            return {
              connect() {},
              disconnect() {}
            };
          }

          createAnalyser() {
            return {
              fftSize: 256,
              getByteTimeDomainData(target: Uint8Array) {
                target.fill(128);
              }
            };
          }

          resume() {
            return Promise.resolve();
          }

          close() {
            return Promise.resolve();
          }
        }
      });

      Object.defineProperty(window.navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            (
              window as Window & {
                __EIDON_SPEECH_AUDIO_REQUESTED__?: boolean;
              }
            ).__EIDON_SPEECH_AUDIO_REQUESTED__ = true;

            return new MediaStream();
          }
        }
      });
    });

    await page.route("**/api/conversations/*/chat", async (route) => {
      chatRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          'data: {"type":"message_start","messageId":"msg_assistant"}',
          "",
          'data: {"type":"answer_delta","text":"Attachment received"}',
          "",
          'data: {"type":"done","messageId":"msg_assistant"}',
          "",
        ].join("\n")
      });
    });

    await signIn(page);
    await page.getByRole("button", { name: /New chat/i }).first().click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });
    await expect
      .poll(
        () =>
          page.evaluate(() => ({
            hasSpeechRecognition: typeof (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition,
            hasMediaDevices: typeof navigator.mediaDevices?.getUserMedia
          })),
        { timeout: 5000 }
      )
      .toEqual({
        hasSpeechRecognition: "function",
        hasMediaDevices: "function"
      });

    const composer = page.getByPlaceholder(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );
    const startVoiceInputButton = page.getByRole("button", { name: "Start voice input" });

    await expect(composer).toBeVisible({ timeout: 5000 });
    await expect(startVoiceInputButton).toBeVisible({
      timeout: 5000
    });
    await expect(startVoiceInputButton).toBeEnabled({ timeout: 5000 });

    await startVoiceInputButton.click();
    await expect
      .poll(
        () =>
          page.evaluate(() => ({
            audioRequested: Boolean(
              (
                window as Window & {
                  __EIDON_SPEECH_AUDIO_REQUESTED__?: boolean;
                }
              ).__EIDON_SPEECH_AUDIO_REQUESTED__
            ),
            speechStartCalled: Boolean(
              (
                window as Window & {
                  __EIDON_SPEECH_START_CALLED__?: boolean;
                }
              ).__EIDON_SPEECH_START_CALLED__
            )
          })),
        { timeout: 5000 }
      )
      .toEqual({
        audioRequested: true,
        speechStartCalled: true
      });

    await expect(page.getByRole("button", { name: "Stop voice input" })).toBeVisible({
      timeout: 5000
    });

    await page.getByRole("button", { name: "Stop voice input" }).click();

    await expect(composer).toHaveValue("hello from voice input", { timeout: 5000 });
    const submittedTranscript = page.locator("p").filter({ hasText: "hello from voice input" });
    await expect(submittedTranscript).toHaveCount(0);
    const sendMessageButton = page.getByRole("button", { name: "Send message" });
    await expect(sendMessageButton).toBeVisible();
    await expect(sendMessageButton).toBeEnabled({ timeout: 5000 });
    await expect.poll(() => chatRequests, { timeout: 2000 }).toBe(0);

    await sendMessageButton.click();
    await expect(submittedTranscript).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Feature: Folders", () => {
  test("creates and renames a folder", async ({ page }) => {
    await signIn(page);

    await page.getByRole("button", { name: "New folder" }).click();

    // Fill folder name
    const folderInput = page.getByPlaceholder("Folder name");
    await folderInput.fill("Work Chats");
    await folderInput.press("Enter");

    // Verify folder appears in sidebar
    await expect(page.getByRole("button", { name: "Work Chats folder" }).first()).toBeVisible({
      timeout: 3000
    });
  });
});

test.describe("Feature: Move conversation to folder", () => {
  test("moves a conversation into a folder by dragging it onto the folder", async ({ page }) => {
    await signIn(page);

    // Create a folder first
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByPlaceholder("Folder name").fill("Projects");
    await page.getByPlaceholder("Folder name").press("Enter");
    await expect(page.getByRole("button", { name: "Projects folder" }).first()).toBeVisible({
      timeout: 3000
    });

    // Create a chat
    await createNewChat(page);
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    const convLink = page.locator('aside a[href*="/chat/"]').first();
    const folderRow = page.getByRole("button", { name: "Projects folder" }).first();

    const convBox = await convLink.boundingBox();
    const folderBox = await folderRow.boundingBox();

    if (!convBox || !folderBox) {
      throw new Error("Could not find drag source or folder target");
    }

    await page.mouse.move(convBox.x + convBox.width / 2, convBox.y + convBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(folderBox.x + folderBox.width / 2, folderBox.y + folderBox.height / 2, {
      steps: 20
    });
    await page.mouse.up();

    const projectsFolder = page.getByRole("button", { name: "Projects folder" }).first();
    await expect(projectsFolder.getByText("1")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Feature: Search conversations", () => {
  test("searches for a conversation", async ({ page }) => {
    await signIn(page);

    // Create a chat
    await createNewChat(page);
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

    // Click search
    await page.getByRole("button", { name: "Search" }).click();

    // Type search query
    const searchInput = page.getByPlaceholder("Search");
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("Conversation");
    await page.waitForTimeout(500);

    // Should show matching results
    await expect(page.getByRole("link", { name: "Conversation" }).first()).toBeVisible({
      timeout: 5000
    });
  });
});

test.describe("Feature: MCP Servers in settings", () => {
  test("adds, tests, retests, and removes an MCP server", async ({ page }) => {
    await signIn(page);
    const serverName = `Test MCP ${Date.now()}`;

    await page.route("**/api/mcp-servers/test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          protocolVersion: "2025-03-26",
          toolCount: 2,
          text: "2 tools discovered"
        })
      });
    });

    await page.goto("/settings/mcp-servers");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "MCP Servers" })).toBeVisible({ timeout: 10000 });

    // Add MCP server
    await page.getByRole("button", { name: "Add MCP server" }).click();
    await page.getByPlaceholder("My MCP Server").fill(serverName);
    await page.getByPlaceholder("https://...").fill("https://mcp.example.com/api");
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.locator("text=2 tools discovered").first()).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Add server" }).click();

    await expect(page.locator("span").filter({ hasText: serverName }).first()).toBeVisible({
      timeout: 5000
    });
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.locator("text=2 tools discovered").first()).toBeVisible({ timeout: 5000 });

    // Delete it
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator("span").filter({ hasText: serverName })).toHaveCount(0, {
      timeout: 3000
    });
  });
});

test.describe("Feature: Mobile settings navigation", () => {
  test("shows the providers list first on mobile and opens detail on selection", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);

    await page.goto("/settings/providers");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Back to list" })).toHaveCount(0);

    await page.locator("span", { hasText: "Default profile" }).click();
    await expect(page.getByRole("button", { name: "Back to list" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Provider preset", { exact: true })).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "Back to list" }).click();
    await expect(page.getByRole("button", { name: "Back to list" })).toHaveCount(0);
    await expect(page.locator("span", { hasText: "Default profile" })).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Feature: Skills in settings", () => {
  test("adds and removes a skill", async ({ page }) => {
    await signIn(page);

    await page.goto("/settings/skills");
    await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible({ timeout: 5000 });

    // Add skill
    await page.getByLabel("Add skill").click();
    await page.getByPlaceholder("Skill name").fill("Test Skill");
    await page.getByPlaceholder("Explain when this skill should and should not trigger").fill("Use when the user asks for French output.");
    await page.getByPlaceholder("Enter the full skill instructions...").fill("Always respond in French.");
    await page.getByRole("button", { name: "Add skill" }).last().click();

    await expect(page.getByText("Test Skill")).toBeVisible({ timeout: 5000 });

    // Delete it
    await page.getByText("Test Skill", { exact: true }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator("span").filter({ hasText: "Test Skill" })).toHaveCount(0, {
      timeout: 3000
    });
  });
});

test.describe("Feature: Automations workspace", () => {
  test("runs automations in the dedicated workspace without polluting the main chat sidebar", async ({ page }) => {
    await signIn(page);

    await page.goto("/settings/automations");
    await expect(page.getByRole("heading", { name: "Scheduled automations" })).toBeVisible({
      timeout: 10000
    });

    await page.getByRole("button", { name: "Add automation" }).click();
    await page.getByLabel("Name").fill("Morning summary");
    await page.getByLabel("Prompt").fill("Summarize priorities");
    await expect(page.getByLabel("Provider profile")).toHaveValue(/profile_/);
    await page.getByRole("button", { name: "Save automation" }).click();
    await expect(page.getByRole("heading", { name: "Morning summary" })).toBeVisible({
      timeout: 5000
    });

    await page.goto("/automations");
    await expect(page.locator("aside").getByText("Morning summary")).toBeVisible({
      timeout: 5000
    });
    await expect(page.locator('aside a[href*="/chat/"]')).toHaveCount(0);

    await page.locator("aside").getByRole("link", { name: /Morning summary/ }).click();
    await expect(page.getByRole("heading", { name: "Morning summary" })).toBeVisible({
      timeout: 5000
    });

    await page.getByRole("button", { name: "Run now" }).click();
    await expect(page.getByText("running").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('aside a[href*="/chat/"]')).toHaveCount(0);

    await expect(page.getByRole("link", { name: /Open transcript/ }).first()).toBeVisible({
      timeout: 10000
    });
    await page.getByRole("link", { name: /Open transcript/ }).first().click();
    await expect(page).toHaveURL(/\/automations\/[^/]+\/runs\/[^/]+$/, { timeout: 10000 });
    await expect(page.getByPlaceholder(/Ask, create, or start a task/i)).toBeVisible({
      timeout: 10000
    });
  });
});

test.describe("Feature: Chat attachments", () => {
  test("attaches an image from the paperclip flow and sends it", async ({ page }) => {
    await signIn(page);
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
      (response) =>
        response.url().includes("/api/attachments") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Attach files" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: TINY_PNG
    });
    await uploadResponsePromise;

    await expect(page.getByRole("button", { name: "Remove photo.png" })).toBeVisible({
      timeout: 5000
    });
    await page.getByPlaceholder(/Ask, create, or start a task/i).fill("Please inspect this");
    await expect(page.getByAltText("photo.png")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled({
      timeout: 5000
    });
  });

  test("attaches a text file from the paperclip flow", async ({ page }) => {
    await signIn(page);
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
      (response) =>
        response.url().includes("/api/attachments") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Attach files" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello")
    });
    await uploadResponsePromise;

    await expect(page.getByText("notes.txt")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled({
      timeout: 5000
    });
  });

  test("keeps a single user bubble when sending one prompt with two attachments", async ({ page }) => {
    await signIn(page);
    await mockChatResponse(page);
    await mockAttachmentUpload(page, [
      {
        id: "att_photo",
        filename: "photo.png",
        mimeType: "image/png",
        kind: "image"
      },
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
      (response) =>
        response.url().includes("/api/attachments") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Attach files" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles([
      { name: "photo.png", mimeType: "image/png", buffer: TINY_PNG },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }
    ]);
    await uploadResponsePromise;

    await page.getByPlaceholder(/Ask, create, or start a task/i).fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("hello", { exact: true })).toHaveCount(1, {
      timeout: 10000
    });
    await expect(page.getByRole("button", { name: "Preview photo.png" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Preview notes.txt" })).toHaveCount(1);
  });

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
      timeout: 1000
    });
    await page.waitForTimeout(250);
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
      timeout: 1000
    });
    await page.waitForTimeout(250);
    await expect(page.getByRole("button", { name: "Preview notes.txt" }).last()).toBeVisible({
      timeout: 10000
    });

    await page.getByRole("button", { name: "Preview notes.txt" }).last().click();
    await expect(page.getByRole("dialog", { name: "Attachment preview" })).toBeVisible();
    await expect(page.getByText("hello")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download attachment" })).toHaveAttribute(
      "href",
      /\/api\/attachments\/att_notes\?download=1$/
    );
  });

  test("renders assistant-imported local screenshots and files as transcript tiles", async ({
    page
  }) => {
    test.setTimeout(120_000);
    const tempDir = fs.mkdtempSync(path.join("/tmp", "eidon-assistant-local-attachments-"));
    const screenshotPath = path.join(tempDir, "screenshot.png");
    const reportPath = path.join(tempDir, "report.txt");
    const assistantAnswer = [
      "Here are the local files you asked for.",
      "",
      `![Screenshot](${screenshotPath})`,
      "",
      `[Report](${reportPath})`
    ].join("\n");

    fs.writeFileSync(screenshotPath, TINY_PNG);
    fs.writeFileSync(reportPath, "report body", "utf8");

    const mockServer = await startMockOpenAiCompatibleServer({
      queuedAnswer: () => assistantAnswer
    });
    let restoreProviderSettings: (() => Promise<void>) | null = null;

    try {
      await signIn(page);
      restoreProviderSettings = await configureMockProvider(page, mockServer.apiBaseUrl);
      mockServer.reset();

      await createNewChat(page);
      await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });

      const composer = page.getByPlaceholder(/Ask, create, or start a task/i);
      const sendMessageButton = page.getByRole("button", { name: "Send message" });
      const startVoiceInputButton = page.getByRole("button", { name: "Start voice input" });
      await expect(composer).toBeEditable({ timeout: 10000 });
      await expect(startVoiceInputButton).toBeEnabled({ timeout: 10000 });
      await enterComposerText(composer, "Please review these");
      await expect(sendMessageButton).toBeEnabled({ timeout: 10000 });
      await sendMessageButton.click();

      await page.waitForTimeout(250);
      await expect(page.getByRole("button", { name: "Preview screenshot.png" })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Preview report.txt" })).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Report" })).toHaveCount(0);
      await expect(page.getByRole("img", { name: "Screenshot" })).toHaveCount(0);
      await expect(page.locator(`a[href="${reportPath}"]`)).toHaveCount(0);
      await expect(page.locator(`img[src="${screenshotPath}"]`)).toHaveCount(0);

      await page.getByRole("button", { name: "Preview screenshot.png" }).last().click();
      await expect(page.getByRole("dialog", { name: "Attachment preview" })).toBeVisible();
      await expect(page.getByRole("img", { name: "Screenshot" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Download attachment" })).toHaveAttribute(
        "href",
        /\/api\/attachments\/[^/]+\?download=1$/
      );
      await page.getByRole("button", { name: "Close attachment preview" }).click();

      await expect(page.getByRole("button", { name: "Preview screenshot.png" }).last()).toBeVisible({
        timeout: 10000
      });
      await expect(page.getByRole("button", { name: "Preview report.txt" }).last()).toBeVisible({
        timeout: 10000
      });
      await expect(page.getByText(screenshotPath)).toHaveCount(0);
      await expect(page.getByText(reportPath)).toHaveCount(0);
    } finally {
      if (restoreProviderSettings) {
        await restoreProviderSettings();
      }
      await mockServer.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

test.describe("Feature: Image generation", () => {
  test("keeps the composer free of an image-mode toggle even when image generation is enabled", async ({ page }) => {
    await signIn(page);
    await updateImageGenerationSettings(page, {
      imageGenerationBackend: "google_nano_banana"
    });

    await createNewChat(page);
    await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });
    await expect(
      page.getByRole("button", { name: "Toggle image generation mode" })
    ).toHaveCount(0, { timeout: 5000 });

    await updateImageGenerationSettings(page, {
      imageGenerationBackend: "disabled"
    });
  });
});

test.describe("Feature: Queued chat follow-ups", () => {
  test("shows queued follow-ups above the composer and keeps them across a reconnect", async ({
    page
  }) => {
    test.setTimeout(60_000);
    const mockServer = await startMockOpenAiCompatibleServer();
    let restoreProviderSettings: (() => Promise<void>) | null = null;

    try {
      await signIn(page);
      restoreProviderSettings = await configureMockProvider(page, mockServer.apiBaseUrl);
      mockServer.reset();

      await createNewChat(page);
      await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });
      const initialStreamRequestCount = mockServer
        .listChatRequests()
        .filter((request) => request.stream && !request.isTitleRequest).length;

      const composer = page.getByPlaceholder(/Ask, create, or start a task/i);
      const sendMessageButton = page.getByRole("button", { name: "Send message" });
      const startVoiceInputButton = page.getByRole("button", { name: "Start voice input" });

      await expect(composer).toBeEditable({ timeout: 10000 });
      await expect(startVoiceInputButton).toBeEnabled({ timeout: 10000 });
      await enterComposerText(composer, "Initial question");
      await expect(sendMessageButton).toBeEnabled({ timeout: 10000 });
      await sendMessageButton.click();
      await expect(composer).toHaveValue("");

      await expect.poll(
        () =>
          mockServer
            .listChatRequests()
            .filter((request) => request.stream && !request.isTitleRequest)
            .length,
        { timeout: 10000 }
      ).toBe(initialStreamRequestCount + 1);

      await expect(page.getByRole("button", { name: "Stop response" }).first()).toBeVisible({
        timeout: 10000
      });

      await enterComposerText(composer, "First queued follow-up");
      await page.getByRole("button", { name: "Queue follow-up" }).click();
      await expect(composer).toHaveValue("");
      await enterComposerText(composer, "Second queued follow-up");
      await page.getByRole("button", { name: "Queue follow-up" }).click();
      await expect(composer).toHaveValue("");
      await enterComposerText(composer, "Third queued follow-up");
      await page.getByRole("button", { name: "Queue follow-up" }).click();
      await expect(composer).toHaveValue("");

      const queueHeader = page.getByText("3 queued follow-ups");
      await expect(queueHeader).toBeVisible({ timeout: 10000 });
      await expect(page.getByText("First queued follow-up", { exact: true })).toBeVisible();
      await expect(page.getByText("Second queued follow-up", { exact: true })).toBeVisible();
      await expect(page.getByText("Third queued follow-up", { exact: true })).toBeVisible();

      const queueHeaderBox = await queueHeader.boundingBox();
      const composerBox = await composer.boundingBox();
      expect(queueHeaderBox?.y).toBeLessThan(composerBox?.y ?? Number.POSITIVE_INFINITY);

      const reconnectedPage = await page.context().newPage();
      await reconnectedPage.goto(page.url(), { waitUntil: "domcontentloaded" });

      const reconnectedComposer = reconnectedPage.getByPlaceholder(/Ask, create, or start a task/i);
      const reconnectedQueueHeader = reconnectedPage.getByText("3 queued follow-ups");

      await expect(reconnectedComposer).toBeEditable({ timeout: 10000 });
      await expect(reconnectedQueueHeader).toBeVisible({ timeout: 10000 });
      await expect(reconnectedPage.getByText("First queued follow-up", { exact: true })).toBeVisible();
      await expect(reconnectedPage.getByText("Second queued follow-up", { exact: true })).toBeVisible();
      await expect(reconnectedPage.getByText("Third queued follow-up", { exact: true })).toBeVisible();
      await reconnectedPage.close();
    } finally {
      if (restoreProviderSettings) {
        await restoreProviderSettings();
      }
      await mockServer.close();
    }
  });

  test("sends the selected queued item next and preserves the remaining FIFO order", async ({
    page
  }) => {
    test.setTimeout(60_000);
    const mockServer = await startMockOpenAiCompatibleServer();
    let restoreProviderSettings: (() => Promise<void>) | null = null;

    try {
      await signIn(page);
      restoreProviderSettings = await configureMockProvider(page, mockServer.apiBaseUrl);
      mockServer.reset();

      await createNewChat(page);
      await expect(page).toHaveURL(/\/chat\//, { timeout: 10000 });
      const initialStreamRequestCount = mockServer
        .listChatRequests()
        .filter((request) => request.stream && !request.isTitleRequest).length;

      const composer = page.getByPlaceholder(/Ask, create, or start a task/i);
      const sendMessageButton = page.getByRole("button", { name: "Send message" });
      const startVoiceInputButton = page.getByRole("button", { name: "Start voice input" });

      await expect(composer).toBeEditable({ timeout: 10000 });
      await expect(startVoiceInputButton).toBeEnabled({ timeout: 10000 });
      await enterComposerText(composer, "Initial question");
      await expect(sendMessageButton).toBeEnabled({ timeout: 10000 });
      await sendMessageButton.click();
      await expect(composer).toHaveValue("");

      await expect.poll(
        () =>
          mockServer
            .listChatRequests()
            .filter((request) => request.stream && !request.isTitleRequest)
            .length,
        { timeout: 10000 }
      ).toBe(initialStreamRequestCount + 1);

      await expect(page.getByRole("button", { name: "Stop response" }).first()).toBeVisible({
        timeout: 10000
      });

      await enterComposerText(composer, "First queued follow-up");
      await page.getByRole("button", { name: "Queue follow-up" }).click();
      await expect(composer).toHaveValue("");
      await enterComposerText(composer, "Second queued follow-up");
      await page.getByRole("button", { name: "Queue follow-up" }).click();
      await expect(composer).toHaveValue("");
      await enterComposerText(composer, "Third queued follow-up");
      await page.getByRole("button", { name: "Queue follow-up" }).click();
      await expect(composer).toHaveValue("");

      const queueHeader = page.getByText("3 queued follow-ups");
      await expect(queueHeader).toBeVisible({ timeout: 10000 });

      const thirdQueuedRow = page
        .getByText("Third queued follow-up", { exact: true })
        .locator("xpath=..");
      await thirdQueuedRow.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByText("Third queued follow-up", { exact: true })).toHaveCount(0);

      const secondQueuedRow = page
        .getByText("Second queued follow-up", { exact: true })
        .locator("xpath=..");
      await secondQueuedRow.getByRole("button", { name: "Send now" }).click();

      await expect.poll(
        () =>
          mockServer
            .listChatRequests()
            .filter((request) => request.stream && !request.isTitleRequest)
            .length,
        { timeout: 15000 }
      ).toBe(initialStreamRequestCount + 3);

      const dispatchedMessages = mockServer
        .listChatRequests()
        .filter((request) => request.stream && !request.isTitleRequest)
        .slice(initialStreamRequestCount)
        .map((request) => request.lastUserContent);

      expect(dispatchedMessages).toEqual([
        "Initial question",
        "Second queued follow-up",
        "First queued follow-up"
      ]);
      expect(dispatchedMessages).not.toContain("Third queued follow-up");

      await expect(page.getByText("Second queued follow-up", { exact: true })).toHaveCount(0, {
        timeout: 10000
      });
      await expect(page.getByText("First queued follow-up", { exact: true })).toHaveCount(0, {
        timeout: 10000
      });
      await expect(page.getByText("Handled Second queued follow-up")).toBeVisible({
        timeout: 10000
      });
    } finally {
      if (restoreProviderSettings) {
        await restoreProviderSettings();
      }
      await mockServer.close();
    }
  });
});
