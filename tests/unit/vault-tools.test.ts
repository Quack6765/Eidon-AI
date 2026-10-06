import { describe, expect, it, vi } from "vitest";

import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { redactSecrets } from "@/lib/secret-redaction";
import { executeToolCall, type RuntimeAction } from "@/lib/tool-executors";
import type { PromptMessage } from "@/lib/types";
import { createLocalUser } from "@/lib/users";
import { createVaultEntry, findVaultEntry, listVaultEntries, revealVaultSecret } from "@/lib/vault";

const VAULT_UNAVAILABLE = "Error: The vault is only available in the user's own conversations.";

async function vaultFixture(username: string) {
  const user = await createLocalUser({ username, password: "Password123!", role: "user" });
  const conversation = createConversation("Chat", null, {}, user.id);
  const message = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "streaming",
    estimatedTokens: 0
  });
  const onActionStart = vi.fn(async (action: RuntimeAction) => createMessageAction({ messageId: message.id, ...action }).id);
  const onActionComplete = vi.fn();
  const onActionError = vi.fn();

  async function call(
    name: string,
    args: Record<string, unknown>,
    owner: { userId?: string | null; conversationId?: string | null } = {}
  ) {
    const { userId, conversationId } = { userId: user.id, conversationId: conversation.id, ...owner };
    const result = await executeToolCall(
      { id: `call_${name}`, name, arguments: JSON.stringify(args) },
      {
        input: {
          conversationId: conversationId ?? undefined,
          toolApproval: { userId, unattended: false },
          skills: [],
          mcpToolSets: [],
          onActionStart,
          onActionComplete,
          onActionError
        },
        mcpServers: [],
        loadedSkillIds: new Set<string>(),
        successfulReadOnlyToolResults: new Map(),
        timelineSortOrder: 0,
        promptMessages: [] as PromptMessage[]
      }
    );
    return { text: String(result.promptMessages.at(-1)?.content), nextSortOrder: result.nextSortOrder };
  }

  function recorded() {
    return JSON.stringify([
      onActionStart.mock.calls,
      onActionComplete.mock.calls,
      onActionError.mock.calls,
      getDb().prepare("SELECT * FROM message_actions WHERE message_id = ?").all(message.id)
    ]);
  }

  return { user, conversation, onActionStart, onActionComplete, onActionError, call, recorded };
}

describe("list_secrets", () => {
  it("lists names, sites, usernames and notes but never the values", async () => {
    const fixture = await vaultFixture("vault-list");
    const github = createVaultEntry(fixture.user.id, {
      name: "GitHub password",
      origin: "https://github.com/login",
      username: "octocat",
      notes: "Work account",
      secret: "hunter2-github"
    });
    const openai = createVaultEntry(fixture.user.id, { name: "OpenAI API key", secret: "sk-openai-value" });

    const result = await fixture.call("list_secrets", {});

    expect(result.text).toBe(
      [
        "The user's vault (values are never shown):",
        `- GitHub password · site: https://github.com · username: octocat · notes: Work account · updated ${github.updatedAt.slice(0, 10)}`,
        `- OpenAI API key · no site · updated ${openai.updatedAt.slice(0, 10)}`
      ].join("\n")
    );
    expect(result.nextSortOrder).toBe(1);
    expect(fixture.onActionStart).toHaveBeenCalledWith({
      kind: "mcp_tool_call",
      label: "Check vault",
      detail: "",
      serverId: "integration_vault",
      toolName: "list_secrets",
      arguments: {}
    });
    expect(fixture.onActionComplete).toHaveBeenCalledWith(expect.any(String), { resultSummary: "2 secrets" });
    expect(fixture.recorded()).not.toContain("hunter2-github");
    expect(fixture.recorded()).not.toContain("sk-openai-value");
  });

  it("says when the vault is empty and counts a single entry", async () => {
    const fixture = await vaultFixture("vault-list-empty");

    expect((await fixture.call("list_secrets", {})).text).toBe("The user's vault is empty.");
    createVaultEntry(fixture.user.id, { name: "Only key", secret: "only-value" });
    expect((await fixture.call("list_secrets", {})).text).toContain("- Only key · no site");

    expect(fixture.onActionComplete.mock.calls.map(([, patch]) => patch)).toEqual([
      { resultSummary: "0 secrets" },
      { resultSummary: "1 secret" }
    ]);
  });

  it("lists only the conversation owner's vault", async () => {
    const fixture = await vaultFixture("vault-list-owner");
    const other = await createLocalUser({ username: "vault-list-other", password: "Password123!", role: "user" });
    createVaultEntry(other.id, { name: "Someone else's key", secret: "other-user-value" });

    expect((await fixture.call("list_secrets", {})).text).toBe("The user's vault is empty.");
  });

  it("refuses outside the user's own conversations", async () => {
    const fixture = await vaultFixture("vault-list-refused");
    createVaultEntry(fixture.user.id, { name: "GitHub password", secret: "hunter2-github" });

    for (const owner of [{ userId: null }, { conversationId: null }]) {
      expect(await fixture.call("list_secrets", {}, owner)).toEqual({ text: VAULT_UNAVAILABLE, nextSortOrder: 0 });
    }
    expect(fixture.onActionStart).not.toHaveBeenCalled();
  });
});

describe("save_secret", () => {
  it("saves a new entry and keeps its value out of the timeline", async () => {
    const fixture = await vaultFixture("vault-save-new");
    const value = "sk_live_vaultvalue";

    const result = await fixture.call("save_secret", {
      name: "  Stripe key ",
      secret: value,
      origin: "https://dashboard.stripe.com/login",
      username: "ops@example.com",
      notes: "Billing"
    });

    expect(result).toEqual({
      text: 'Saved "Stripe key" in the user\'s vault for https://dashboard.stripe.com. Refer to it by that name; never repeat the value.',
      nextSortOrder: 1
    });
    const entry = findVaultEntry(fixture.user.id, "Stripe key");
    expect(entry).toMatchObject({ origin: "https://dashboard.stripe.com", username: "ops@example.com", notes: "Billing" });
    expect(revealVaultSecret(fixture.user.id, entry!.id)).toBe(value);
    expect(fixture.onActionStart).toHaveBeenCalledWith({
      kind: "mcp_tool_call",
      label: "Save to vault",
      detail: "Stripe key",
      serverId: "integration_vault",
      toolName: "save_secret",
      arguments: {
        name: "Stripe key",
        origin: "https://dashboard.stripe.com/login",
        username: "ops@example.com",
        notes: "Billing"
      }
    });
    expect(fixture.onActionComplete).toHaveBeenCalledWith(expect.any(String), {
      detail: "Stripe key",
      resultSummary: "Saved in your vault"
    });
    expect(fixture.recorded()).not.toContain(value);
    expect(redactSecrets(fixture.conversation.id, `key=${value}`)).toBe("key=[hidden secret]");
  });

  it("saves an API key without a site", async () => {
    const fixture = await vaultFixture("vault-save-api");

    const result = await fixture.call("save_secret", { name: "OpenAI API key", secret: "sk-openai-value" });

    expect(result.text).toBe('Saved "OpenAI API key" in the user\'s vault. Refer to it by that name; never repeat the value.');
    expect(findVaultEntry(fixture.user.id, "OpenAI API key")?.origin).toBeNull();
    expect(fixture.onActionStart.mock.calls[0][0].arguments).toEqual({ name: "OpenAI API key" });
    expect(fixture.recorded()).not.toContain("sk-openai-value");
  });

  it("updates an existing entry found by name", async () => {
    const fixture = await vaultFixture("vault-save-update");
    const existing = createVaultEntry(fixture.user.id, {
      name: "GitHub password",
      origin: "https://github.com",
      username: "octocat",
      secret: "old-github-value"
    });

    const result = await fixture.call("save_secret", {
      name: "github PASSWORD",
      secret: "new-github-value",
      origin: "https://github.com/settings",
      notes: "Rotated"
    });

    expect(result.text).toBe(
      'Updated "GitHub password" in the user\'s vault for https://github.com. Refer to it by that name; never repeat the value.'
    );
    expect(listVaultEntries(fixture.user.id)).toEqual([
      expect.objectContaining({ id: existing.id, username: "octocat", notes: "Rotated" })
    ]);
    expect(revealVaultSecret(fixture.user.id, existing.id)).toBe("new-github-value");
    expect(fixture.onActionComplete).toHaveBeenCalledWith(expect.any(String), {
      detail: "GitHub password",
      resultSummary: "Updated in your vault"
    });
    expect(fixture.recorded()).not.toContain("new-github-value");
  });

  it("updates only the details when the value is left out", async () => {
    const fixture = await vaultFixture("vault-save-details");
    const existing = createVaultEntry(fixture.user.id, { name: "GitHub password", secret: "kept-github-value" });

    const result = await fixture.call("save_secret", { name: "GitHub password", secret: "", username: "new-user" });

    expect(result.text).toContain('Updated "GitHub password"');
    expect(findVaultEntry(fixture.user.id, "GitHub password")?.username).toBe("new-user");
    expect(revealVaultSecret(fixture.user.id, existing.id)).toBe("kept-github-value");
  });

  it("refuses to move an existing entry to another site", async () => {
    const fixture = await vaultFixture("vault-save-origin");
    const github = createVaultEntry(fixture.user.id, { name: "GitHub password", origin: "https://github.com", secret: "real-github-value" });
    createVaultEntry(fixture.user.id, { name: "API key", secret: "real-api-value" });

    const moved = await fixture.call("save_secret", {
      name: "GitHub password",
      secret: "phished-value",
      origin: "https://evil.example"
    });
    const tied = await fixture.call("save_secret", { name: "API key", origin: "https://evil.example" });

    expect(moved).toEqual({
      text: 'Error: "GitHub password" is tied to https://github.com. Only the user can change that, in Settings → Vault.',
      nextSortOrder: 1
    });
    expect(tied.text).toBe('Error: "API key" is tied to no site. Only the user can change that, in Settings → Vault.');
    expect(fixture.onActionError).toHaveBeenCalledWith(expect.any(String), {
      detail: "GitHub password",
      resultSummary: '"GitHub password" is tied to https://github.com. Only the user can change that, in Settings → Vault.'
    });
    expect(fixture.onActionComplete).not.toHaveBeenCalled();
    expect(revealVaultSecret(fixture.user.id, github.id)).toBe("real-github-value");
    expect(fixture.recorded()).not.toContain("phished-value");
    expect(redactSecrets(fixture.conversation.id, "phished-value")).toBe("[hidden secret]");
  });

  it("asks for the value before creating a new entry", async () => {
    const fixture = await vaultFixture("vault-save-missing");

    for (const args of [{ name: "New key" }, { name: "New key", secret: "" }]) {
      expect(await fixture.call("save_secret", args)).toEqual({
        text: 'Error: There is no secret called "New key" yet, so include its value.',
        nextSortOrder: 1
      });
    }
    expect(fixture.onActionError).toHaveBeenCalledTimes(2);
    expect(listVaultEntries(fixture.user.id)).toEqual([]);
  });

  it("rejects a site that isn't a web address", async () => {
    const fixture = await vaultFixture("vault-save-bad-origin");

    const result = await fixture.call("save_secret", { name: "FTP login", secret: "ftp-value", origin: "ftp://example.com" });

    expect(result.text).toBe("Error: The site must be a web address such as https://example.com.");
    expect(listVaultEntries(fixture.user.id)).toEqual([]);
    expect(fixture.recorded()).not.toContain("ftp-value");
  });

  it("needs a name", async () => {
    const fixture = await vaultFixture("vault-save-unnamed");

    for (const args of [{ secret: "orphan-value" }, { name: "   ", secret: "orphan-value" }]) {
      expect(await fixture.call("save_secret", args)).toEqual({
        text: "Error: save_secret needs a name.",
        nextSortOrder: 0
      });
    }
    expect(fixture.onActionStart).not.toHaveBeenCalled();
    expect(listVaultEntries(fixture.user.id)).toEqual([]);
    expect(redactSecrets(fixture.conversation.id, "orphan-value")).toBe("[hidden secret]");
  });

  it("refuses outside the user's own conversations", async () => {
    const fixture = await vaultFixture("vault-save-refused");

    for (const owner of [{ userId: null }, { conversationId: null }]) {
      expect(await fixture.call("save_secret", { name: "Stray key", secret: "stray-value" }, owner)).toEqual({
        text: VAULT_UNAVAILABLE,
        nextSortOrder: 0
      });
    }
    expect(fixture.onActionStart).not.toHaveBeenCalled();
    expect(listVaultEntries(fixture.user.id)).toEqual([]);
  });
});
