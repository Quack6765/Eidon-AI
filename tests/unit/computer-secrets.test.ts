import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

const browserMocks = vi.hoisted(() => ({
  url: "https://example.com/login",
  focusOk: true,
  runBrowserSessionCommand: vi.fn()
}));

vi.mock("@/lib/agent-computer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-computer")>();
  return { ...actual, runBrowserSessionCommand: browserMocks.runBrowserSessionCommand };
});

import { conversationBrowserTarget } from "@/lib/agent-computer-relay";
import {
  declineComputerSecret,
  requestComputerSecret,
  SECRET_REQUEST_TIMEOUT_MS,
  SecretRequestError,
  submitComputerSecret
} from "@/lib/computer-secrets";
import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { listSavedLogins, saveLogin } from "@/lib/saved-logins";
import { redactSecrets, resetSecretRedactionForTests } from "@/lib/secret-redaction";
import type { RuntimeAction } from "@/lib/tool-executors";
import { createLocalUser } from "@/lib/users";

const stream = { server: null as WebSocketServer | null, port: 0, received: [] as Array<{ eventType: string; text?: string }> };

function typedText() {
  return stream.received
    .filter((event) => event.eventType === "keyDown")
    .map((event) => event.text ?? "")
    .join("");
}

async function fixture(username: string, options: { browserOpen?: boolean } = {}) {
  const user = await createLocalUser({ username, password: "Password123!", role: "user" });
  const conversation = createConversation(undefined, undefined, undefined, user.id);
  const message = createMessage({ conversationId: conversation.id, role: "assistant", content: "", status: "streaming" });
  if (options.browserOpen !== false) {
    const { socketDir, sessionName } = conversationBrowserTarget(conversation.id);
    mkdirSync(socketDir, { recursive: true });
    writeFileSync(join(socketDir, `${sessionName}.stream`), String(stream.port));
  }
  const started: string[] = [];
  const onActionStart = vi.fn(async (action: RuntimeAction) => {
    const persisted = createMessageAction({ messageId: message.id, ...action });
    started.push(persisted.id);
    return persisted.id;
  });
  return { user, conversation, onActionStart, started };
}

function request(context: Awaited<ReturnType<typeof fixture>>, overrides: Partial<Parameters<typeof requestComputerSecret>[0]> = {}) {
  return requestComputerSecret({
    conversationId: context.conversation.id,
    userId: context.user.id,
    label: "password",
    origin: "https://example.com",
    target: "@e5",
    onActionStart: context.onActionStart,
    ...overrides
  });
}

async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function allActionText() {
  return JSON.stringify(getDb().prepare("SELECT * FROM message_actions").all());
}

describe("secret requests", () => {
  beforeAll(async () => {
    stream.server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    stream.server.on("connection", (socket) =>
      socket.on("message", (raw) => stream.received.push(JSON.parse(raw.toString())))
    );
    await new Promise<void>((resolve) => stream.server!.once("listening", () => resolve()));
    stream.port = (stream.server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => stream.server?.close(resolve));
  });

  beforeEach(() => {
    stream.received.length = 0;
    resetSecretRedactionForTests();
    browserMocks.url = "https://example.com/login";
    browserMocks.focusOk = true;
    browserMocks.runBrowserSessionCommand.mockReset();
    browserMocks.runBrowserSessionCommand.mockImplementation(async (_target: unknown, args: string[]) => {
      if (args[0] === "get") return { ok: true, output: `note\n${JSON.stringify({ success: true, data: { url: browserMocks.url } })}` };
      return { ok: browserMocks.focusOk, output: browserMocks.focusOk ? "✓ Done" : "✗ Element not found" };
    });
  });

  it("asks the user, types their answer into the page and never stores or reveals it", async () => {
    const context = await fixture("secret-fill");
    const onWaitChange = vi.fn();

    const result = request(context, { save: true, onWaitChange });
    await flush();
    const actionId = context.started[0];
    expect(onWaitChange).toHaveBeenCalledWith(true);

    await submitComputerSecret(actionId, context.user.id, { value: "correct-horse-battery", save: true });

    await expect(result).resolves.toBe(
      "The user entered the password into @e5 on https://example.com and saved it for next time. You can't see the value. Continue, for example by submitting the form."
    );
    expect(browserMocks.runBrowserSessionCommand.mock.calls.map((call) => call[1])).toEqual([
      ["get", "url", "--json"],
      ["focus", "@e5"]
    ]);
    expect(typedText()).toBe("correct-horse-battery");
    expect(stream.received.every((event) => (event as { type?: string }).type === "input_keyboard")).toBe(true);
    expect(allActionText()).not.toContain("correct-horse-battery");
    const card = getDb().prepare("SELECT proposal_payload_json FROM message_actions WHERE id = ?").get(actionId) as {
      proposal_payload_json: string;
    };
    expect(JSON.parse(card.proposal_payload_json)).toMatchObject({ resolution: "filled", saved: true });
    expect(redactSecrets(context.conversation.id, "value: correct-horse-battery")).toBe("value: [hidden secret]");
    expect(listSavedLogins(context.user.id)).toEqual([expect.objectContaining({ origin: "https://example.com", label: "password" })]);
    expect(onWaitChange).toHaveBeenLastCalledWith(false);
  });

  it("fills a saved login for the same site without asking", async () => {
    const context = await fixture("secret-saved");
    saveLogin(context.user.id, "https://example.com", "password", "saved-value-123");

    await expect(request(context)).resolves.toContain("Eidon filled the saved password for https://example.com into @e5 without asking");
    expect(context.onActionStart).not.toHaveBeenCalled();
    expect(typedText()).toBe("saved-value-123");
    expect(redactSecrets(context.conversation.id, "saved-value-123")).toBe("[hidden secret]");

    browserMocks.url = "https://evil.example/";
    await expect(request(context)).resolves.toBe(
      "Error: The bot's browser is on https://evil.example, not https://example.com, so Eidon didn't type it."
    );

    browserMocks.url = "https://example.com/";
    const asked = request(context, { replaceSaved: true, save: true });
    await flush();
    expect(context.onActionStart).toHaveBeenCalledTimes(1);
    declineComputerSecret(context.started[0], context.user.id);
    await expect(asked).resolves.toContain("declined");
  });

  it("refuses to type on another site or into a missing field, and keeps the request open", async () => {
    const context = await fixture("secret-mismatch");
    const result = request(context);
    await flush();
    const actionId = context.started[0];

    browserMocks.url = "https://attacker.example/phish";
    await expect(submitComputerSecret(actionId, context.user.id, { value: "hunter22", save: false })).rejects.toMatchObject({
      status: 409,
      message: "The bot's browser is on https://attacker.example, not https://example.com, so Eidon didn't type it."
    });
    browserMocks.url = "https://example.com/login";
    browserMocks.focusOk = false;
    await expect(submitComputerSecret(actionId, context.user.id, { value: "hunter22", save: false })).rejects.toThrow(
      "couldn't find the field"
    );
    browserMocks.runBrowserSessionCommand.mockResolvedValueOnce({ ok: false, output: "" });
    await expect(submitComputerSecret(actionId, context.user.id, { value: "hunter22", save: false })).rejects.toThrow(
      "couldn't read the bot's browser address"
    );
    expect(stream.received).toHaveLength(0);

    const stranger = await createLocalUser({ username: "secret-stranger", password: "Password123!", role: "user" });
    await expect(submitComputerSecret(actionId, stranger.id, { value: "x", save: false })).rejects.toMatchObject({ status: 404 });
    expect(() => declineComputerSecret(actionId, stranger.id)).toThrow(SecretRequestError);

    declineComputerSecret(actionId, context.user.id);
    await expect(result).resolves.toBe("The user declined to enter the password. Don't ask for it again in this task.");
    await expect(submitComputerSecret(actionId, context.user.id, { value: "late", save: false })).rejects.toMatchObject({ status: 409 });
  });

  it("gives up after 30 minutes and when the run stops", async () => {
    const expiring = await fixture("secret-expire");
    vi.useFakeTimers();
    try {
      const result = request(expiring, { label: "one-time code" });
      await vi.advanceTimersByTimeAsync(SECRET_REQUEST_TIMEOUT_MS);
      await expect(result).resolves.toBe("Nobody entered the one-time code within 30 minutes. Tell the user what you still need and stop.");
    } finally {
      vi.useRealTimers();
    }
    expect(allActionText()).toContain("Nobody answered within 30 minutes");

    const stopping = await fixture("secret-stop");
    const controller = new AbortController();
    const stopped = request(stopping, { abortSignal: controller.signal });
    await flush();
    controller.abort();
    await expect(stopped).resolves.toBe("The request for the password was stopped. Don't continue the sign-in.");
  });

  it("explains what is missing before asking the user anything", async () => {
    const context = await fixture("secret-invalid", { browserOpen: false });

    await expect(request(context, { origin: "javascript:alert(1)" })).resolves.toContain("origin must be the page's web origin");
    await expect(request(context, { target: "  " })).resolves.toContain("target must be the field to fill");
    await expect(request(context, { conversationId: undefined })).resolves.toContain("can't be requested in this conversation");
    await expect(request(context)).resolves.toContain("Your browser is not open yet");

    const open = await fixture("secret-no-card");
    await expect(request(open, { onActionStart: undefined })).resolves.toContain("can't be requested in this conversation");
    expect(context.onActionStart).not.toHaveBeenCalled();
  });
});
