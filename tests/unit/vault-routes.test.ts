import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));

import { DELETE as deleteEntry, PATCH as updateEntry } from "@/app/api/vault/[entryId]/route";
import { GET as revealSecret } from "@/app/api/vault/[entryId]/secret/route";
import { GET as listEntries, POST as createEntry } from "@/app/api/vault/route";
import { MAX_SECRET_CHARS } from "@/lib/constants";
import { createLocalUser } from "@/lib/users";

type VaultEntryBody = {
  id: string;
  name: string;
  origin: string | null;
  username: string;
  notes: string;
  lastUsedAt: string | null;
};

function entryContext(entryId: string) {
  return { params: Promise.resolve({ entryId }) };
}

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/vault", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function create(body: unknown) {
  return createEntry(jsonRequest("POST", body));
}

async function patch(entryId: string, body: unknown) {
  return updateEntry(jsonRequest("PATCH", body), entryContext(entryId));
}

async function remove(entryId: string) {
  return deleteEntry(new Request("http://localhost/api/vault", { method: "DELETE" }), entryContext(entryId));
}

async function reveal(entryId: string) {
  return revealSecret(new Request("http://localhost/api/vault"), entryContext(entryId));
}

async function createOwned(username: string, body: Record<string, unknown>) {
  const user = await createLocalUser({ username, password: "Password123!", role: "user" });
  requireUserMock.mockResolvedValue(user);
  const response = await create(body);
  expect(response.status).toBe(201);
  const { vaultEntry } = (await response.json()) as { vaultEntry: VaultEntryBody };
  return { user, entry: vaultEntry };
}

describe("vault routes", () => {
  beforeEach(() => requireUserMock.mockReset());

  it("creates entries and lists them without their values", async () => {
    const { entry } = await createOwned("vault-route-creator", {
      name: "  GitHub   login ",
      origin: "https://GitHub.com/login?next=/settings",
      username: " octocat ",
      notes: "Work account",
      secret: "created-secret-value"
    });

    expect(entry).toMatchObject({
      name: "GitHub login",
      origin: "https://github.com",
      username: "octocat",
      notes: "Work account",
      lastUsedAt: null
    });
    expect(entry).not.toHaveProperty("secret");

    const keyResponse = await create({ name: "OpenAI key", secret: "sk-created-key", origin: "" });
    expect(keyResponse.status).toBe(201);
    const keyText = await keyResponse.text();
    expect(keyText).not.toContain("sk-created-key");
    expect((JSON.parse(keyText) as { vaultEntry: VaultEntryBody }).vaultEntry).toMatchObject({
      origin: null,
      username: "",
      notes: ""
    });

    const listed = await listEntries();
    expect(listed.status).toBe(200);
    const text = await listed.text();
    expect(text).not.toContain("created-secret-value");
    expect(text).not.toContain("sk-created-key");
    const { vaultEntries } = JSON.parse(text) as { vaultEntries: VaultEntryBody[] };
    expect(vaultEntries.map((item) => item.name)).toEqual(["GitHub login", "OpenAI key"]);
    expect(vaultEntries[0]).toEqual(entry);
  });

  it("rejects invalid bodies and duplicate names without echoing the value", async () => {
    await createOwned("vault-route-validator", { name: "Bank", secret: "first-bank-secret" });

    const invalid = [
      { name: "Bank 2", secret: "leaky-secret", value: "extra" },
      { name: "Bank 2", secret: "" },
      { name: "Bank 2" },
      { secret: "leaky-secret" },
      { name: "Bank 2", secret: "x".repeat(MAX_SECRET_CHARS + 1) },
      { name: "Bank 2", secret: "leaky-secret", origin: "ftp://example.com" },
      { name: "Bank 2", secret: "leaky-secret", origin: "not a site" },
      { name: "   ", secret: "leaky-secret" },
      "not json"
    ];
    for (const body of invalid) {
      const response = await create(body);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("leaky-secret");
    }

    const badOrigin = await create({ name: "Bank 2", secret: "leaky-secret", origin: "javascript:alert(1)" });
    expect(await badOrigin.json()).toEqual({ error: "The site must be a web address such as https://example.com." });

    const duplicate = await create({ name: "  bank ", secret: "leaky-secret" });
    expect(duplicate.status).toBe(409);
    const duplicateText = await duplicate.text();
    expect(duplicateText).not.toContain("leaky-secret");
    expect(JSON.parse(duplicateText)).toEqual({ error: 'You already have a secret called "Bank".' });

    const { vaultEntries } = (await (await listEntries()).json()) as { vaultEntries: VaultEntryBody[] };
    expect(vaultEntries.map((item) => item.name)).toEqual(["Bank"]);
  });

  it("updates fields partially and keeps the secret when it is omitted", async () => {
    const { entry } = await createOwned("vault-route-editor", {
      name: "Shop",
      origin: "https://shop.example.com",
      username: "buyer",
      secret: "original-shop-secret"
    });
    const other = await create({ name: "Mail", secret: "mail-secret" });
    expect(other.status).toBe(201);

    const notesOnly = await patch(entry.id, { notes: "Rotates monthly" });
    expect(notesOnly.status).toBe(200);
    expect(((await notesOnly.json()) as { vaultEntry: VaultEntryBody }).vaultEntry).toMatchObject({
      name: "Shop",
      origin: "https://shop.example.com",
      username: "buyer",
      notes: "Rotates monthly"
    });
    expect(await (await reveal(entry.id)).json()).toEqual({ secret: "original-shop-secret" });

    const renamed = await patch(entry.id, { name: "SHOP", origin: null, secret: "rotated-shop-secret" });
    expect(renamed.status).toBe(200);
    const renamedText = await renamed.text();
    expect(renamedText).not.toContain("rotated-shop-secret");
    expect((JSON.parse(renamedText) as { vaultEntry: VaultEntryBody }).vaultEntry).toMatchObject({
      name: "SHOP",
      origin: null,
      username: "buyer",
      notes: "Rotates monthly"
    });
    expect(await (await reveal(entry.id)).json()).toEqual({ secret: "rotated-shop-secret" });

    const conflict = await patch(entry.id, { name: "mail" });
    expect(conflict.status).toBe(409);

    expect((await patch(entry.id, { secret: "" })).status).toBe(400);
    expect((await patch(entry.id, { label: "Shop" })).status).toBe(400);
    expect((await patch(entry.id, { origin: "mailto:buyer@example.com" })).status).toBe(400);
    expect((await patch(entry.id, "not json")).status).toBe(400);
    expect((await patch("vault_missing", { notes: "x" })).status).toBe(404);

    expect(await (await reveal(entry.id)).json()).toEqual({ secret: "rotated-shop-secret" });
  });

  it("reveals a value without caching it and deletes entries", async () => {
    const { entry } = await createOwned("vault-route-revealer", { name: "Server", secret: "server-root-secret" });

    const revealed = await reveal(entry.id);
    expect(revealed.status).toBe(200);
    expect(revealed.headers.get("cache-control")).toBe("no-store");
    expect(await revealed.json()).toEqual({ secret: "server-root-secret" });

    const { vaultEntries } = (await (await listEntries()).json()) as { vaultEntries: VaultEntryBody[] };
    expect(vaultEntries[0].lastUsedAt).toBeNull();

    const deleted = await remove(entry.id);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ success: true });

    expect((await reveal(entry.id)).status).toBe(404);
    expect((await remove(entry.id)).status).toBe(404);
    expect((await patch(entry.id, { notes: "gone" })).status).toBe(404);
    expect(await (await listEntries()).json()).toEqual({ vaultEntries: [] });
  });

  it("keeps entries private to their owner", async () => {
    const { user: owner, entry } = await createOwned("vault-route-owner", {
      name: "Private",
      secret: "owner-only-secret"
    });
    const stranger = await createLocalUser({ username: "vault-route-stranger", password: "Password123!", role: "user" });

    requireUserMock.mockResolvedValue(stranger);
    expect(await (await listEntries()).json()).toEqual({ vaultEntries: [] });
    const peek = await reveal(entry.id);
    expect(peek.status).toBe(404);
    expect(await peek.text()).not.toContain("owner-only-secret");
    expect((await patch(entry.id, { secret: "hijacked-secret" })).status).toBe(404);
    expect((await remove(entry.id)).status).toBe(404);
    expect((await create({ name: "Private", secret: "stranger-secret" })).status).toBe(201);

    requireUserMock.mockResolvedValue(owner);
    expect(await (await reveal(entry.id)).json()).toEqual({ secret: "owner-only-secret" });
    const { vaultEntries } = (await (await listEntries()).json()) as { vaultEntries: VaultEntryBody[] };
    expect(vaultEntries).toEqual([entry]);
  });
});
