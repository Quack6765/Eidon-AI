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
import { redactSecrets, resetSecretRedactionForTests } from "@/lib/secret-redaction";
import type { RuntimeAction } from "@/lib/tool-executors";
import { createLocalUser } from "@/lib/users";
import { createVaultEntry, getVaultEntry, listVaultEntries, revealVaultSecret } from "@/lib/vault";

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
    name: "password",
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

function cardPayload(actionId: string) {
  const card = getDb().prepare("SELECT proposal_payload_json FROM message_actions WHERE id = ?").get(actionId) as {
    proposal_payload_json: string;
  };
  return JSON.parse(card.proposal_payload_json) as Record<string, unknown>;
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
      'The user entered the password into @e5 on https://example.com and saved it in the vault as "password". The value is hidden from your text output, but a screenshot can show it if the field is not masked. Continue, for example by submitting the form.'
    );
    expect(browserMocks.runBrowserSessionCommand.mock.calls.map((call) => call[1])).toEqual([
      ["get", "url", "--json"],
      ["focus", "@e5"]
    ]);
    expect(typedText()).toBe("correct-horse-battery");
    expect(stream.received.every((event) => (event as { type?: string }).type === "input_keyboard")).toBe(true);
    expect(allActionText()).not.toContain("correct-horse-battery");
    expect(cardPayload(actionId)).toMatchObject({ resolution: "filled", saved: true });
    expect(redactSecrets(context.conversation.id, "value: correct-horse-battery")).toBe("value: [hidden secret]");
    const saved = listVaultEntries(context.user.id);
    expect(saved).toEqual([expect.objectContaining({ name: "password", origin: "https://example.com" })]);
    expect(revealVaultSecret(context.user.id, saved[0].id)).toBe("correct-horse-battery");
    expect(onWaitChange).toHaveBeenLastCalledWith(false);
  });

  it("fills a vault entry for the same site without asking", async () => {
    const context = await fixture("secret-saved");
    const entry = createVaultEntry(context.user.id, { name: "Password", origin: "https://example.com", secret: "saved-value-123" });
    const onActionComplete = vi.fn();
    const onActionError = vi.fn();

    await expect(request(context, { onActionComplete, onActionError })).resolves.toBe(
      'Eidon filled "Password" from the vault into @e5 without asking the user. The value is hidden from your text output, but a screenshot can show it if the field is not masked. If it turns out to be wrong, call request_secret again with replace_saved: true.'
    );
    expect(context.onActionStart).toHaveBeenCalledTimes(1);
    expect(context.onActionStart).toHaveBeenCalledWith({
      kind: "mcp_tool_call",
      label: "Fill from vault",
      detail: "Password",
      serverId: "integration_vault",
      toolName: "request_secret",
      arguments: { name: "Password", origin: "https://example.com", target: "@e5" }
    });
    expect(onActionComplete).toHaveBeenCalledWith(context.started[0], {
      detail: "Password",
      resultSummary: "Typed into the page on https://example.com"
    });
    expect(typedText()).toBe("saved-value-123");
    expect(redactSecrets(context.conversation.id, "saved-value-123")).toBe("[hidden secret]");
    expect(getVaultEntry(context.user.id, entry.id)?.lastUsedAt).toEqual(expect.any(String));
    expect(allActionText()).not.toContain("saved-value-123");

    browserMocks.url = "https://evil.example/";
    await expect(request(context, { onActionComplete, onActionError })).resolves.toBe(
      "Error: The browser is on https://evil.example, not https://example.com, so Eidon didn't type it."
    );
    expect(onActionError).toHaveBeenCalledWith(context.started[1], {
      detail: "Password",
      resultSummary: "The browser is on https://evil.example, not https://example.com, so Eidon didn't type it."
    });

    browserMocks.url = "https://example.com/";
    const asked = request(context, { replaceSaved: true, save: true });
    await flush();
    expect(context.onActionStart).toHaveBeenCalledTimes(3);
    await submitComputerSecret(context.started[2], context.user.id, { value: "replaced-value-456", save: true });
    await expect(asked).resolves.toContain('saved it in the vault as "password"');
    expect(listVaultEntries(context.user.id)).toEqual([expect.objectContaining({ id: entry.id, origin: "https://example.com" })]);
    expect(revealVaultSecret(context.user.id, entry.id)).toBe("replaced-value-456");

    const declined = request(context, { replaceSaved: true });
    await flush();
    declineComputerSecret(context.started[3], context.user.id);
    await expect(declined).resolves.toContain("declined");
    expect(revealVaultSecret(context.user.id, entry.id)).toBe("replaced-value-456");
  });

  it("refuses vault entries tied to another site or to no site without asking", async () => {
    const context = await fixture("secret-other-site");
    createVaultEntry(context.user.id, { name: "password", origin: "https://other.example", secret: "other-site-value" });
    createVaultEntry(context.user.id, { name: "API token", secret: "api-token-value" });

    const otherSite =
      'Error: "password" in the vault is for https://other.example, so Eidon only types it there. Use another name for a secret on https://example.com.';
    await expect(request(context)).resolves.toBe(otherSite);
    await expect(request(context, { replaceSaved: true, save: true })).resolves.toBe(otherSite);
    await expect(request(context, { name: "api   token" })).resolves.toBe(
      'Error: "API token" in the vault isn\'t tied to a site, so Eidon won\'t type it into a page. The user can set its site in Settings → Vault.'
    );
    expect(context.onActionStart).not.toHaveBeenCalled();
    expect(browserMocks.runBrowserSessionCommand).not.toHaveBeenCalled();
    expect(stream.received).toHaveLength(0);
    expect(redactSecrets(context.conversation.id, "other-site-value api-token-value")).toBe("other-site-value api-token-value");
  });

  it("does not save over a vault entry that belongs to another site", async () => {
    const context = await fixture("secret-save-conflict");
    const result = request(context, { save: true });
    await flush();
    const actionId = context.started[0];
    const entry = createVaultEntry(context.user.id, { name: "PASSWORD", origin: "https://other.example", secret: "kept-value" });

    await submitComputerSecret(actionId, context.user.id, { value: "typed-value", save: true });

    await expect(result).resolves.toBe(
      "The user entered the password into @e5 on https://example.com. The value is hidden from your text output, but a screenshot can show it if the field is not masked. Continue, for example by submitting the form."
    );
    expect(typedText()).toBe("typed-value");
    expect(cardPayload(actionId)).toMatchObject({ resolution: "filled" });
    expect(cardPayload(actionId)).not.toHaveProperty("saved");
    expect(listVaultEntries(context.user.id)).toEqual([expect.objectContaining({ id: entry.id, origin: "https://other.example" })]);
    expect(revealVaultSecret(context.user.id, entry.id)).toBe("kept-value");
  });

  it("only saves the answer when the user asks to", async () => {
    const context = await fixture("secret-no-save");
    const result = request(context, { save: true });
    await flush();

    await submitComputerSecret(context.started[0], context.user.id, { value: "one-time-value", save: false });

    await expect(result).resolves.not.toContain("vault");
    expect(listVaultEntries(context.user.id)).toEqual([]);
  });

  it("refuses to type on another site or into a missing field, and keeps the request open", async () => {
    const context = await fixture("secret-mismatch");
    const result = request(context);
    await flush();
    const actionId = context.started[0];

    browserMocks.url = "https://attacker.example/phish";
    await expect(submitComputerSecret(actionId, context.user.id, { value: "hunter22", save: false })).rejects.toMatchObject({
      status: 409,
      message: "The browser is on https://attacker.example, not https://example.com, so Eidon didn't type it."
    });
    browserMocks.url = "https://example.com/login";
    browserMocks.focusOk = false;
    await expect(submitComputerSecret(actionId, context.user.id, { value: "hunter22", save: false })).rejects.toThrow(
      "couldn't find the field"
    );
    browserMocks.runBrowserSessionCommand.mockResolvedValueOnce({ ok: false, output: "" });
    await expect(submitComputerSecret(actionId, context.user.id, { value: "hunter22", save: false })).rejects.toThrow(
      "couldn't read the browser's address"
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
      const result = request(expiring, { name: "one-time code" });
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
