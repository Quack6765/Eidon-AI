import { describe, expect, it } from "vitest";

import { MAX_SECRET_CHARS, MAX_VAULT_NOTES_CHARS, MAX_VAULT_USERNAME_CHARS } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { createLocalUser } from "@/lib/users";
import {
  createVaultEntry,
  deleteVaultEntry,
  findVaultEntry,
  getVaultEntry,
  isReservedEnvVariable,
  listVaultEntries,
  normalizeSecretName,
  normalizeSecretOrigin,
  readVaultSecret,
  resolveVaultEnv,
  revealVaultSecret,
  saveVaultSecretForAgent,
  updateVaultEntry,
  VaultError
} from "@/lib/vault";

function thrown(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw");
}

function createUser(username: string) {
  return createLocalUser({ username, password: "Password123!", role: "user" });
}

const SITE_ERROR = "The site must be a web address such as https://example.com.";

describe("vault", () => {
  it("normalizes sites to their web origin and names to one tidy line", () => {
    expect(normalizeSecretOrigin(" https://Example.com/login?next=/ ")).toBe("https://example.com");
    expect(normalizeSecretOrigin("http://intranet.test:8080/a")).toBe("http://intranet.test:8080");
    expect(normalizeSecretOrigin("ftp://example.com")).toBeNull();
    expect(normalizeSecretOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeSecretOrigin("not a url")).toBeNull();
    expect(normalizeSecretName("  GitHub \n token ")).toBe("GitHub token");
    expect(normalizeSecretName("x".repeat(150))).toHaveLength(100);
  });

  it("stores values encrypted and only reveals them to their owner", async () => {
    const owner = await createUser("vault-owner");
    const other = await createUser("vault-other");

    const entry = createVaultEntry(owner.id, { name: "GitHub token", secret: "ghp_owner_value" });
    createVaultEntry(owner.id, { name: "Stripe key", origin: "https://dashboard.stripe.com", secret: "sk_owner_value" });

    const stored = getDb().prepare("SELECT secret_encrypted FROM vault_entries").all() as Array<{ secret_encrypted: string }>;
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.secret_encrypted).join(" ")).not.toMatch(/ghp_owner_value|sk_owner_value/);
    expect(revealVaultSecret(owner.id, entry.id)).toBe("ghp_owner_value");

    expect(getVaultEntry(other.id, entry.id)).toBeNull();
    expect(findVaultEntry(other.id, "GitHub token")).toBeNull();
    expect(listVaultEntries(other.id)).toEqual([]);
    expect(revealVaultSecret(other.id, entry.id)).toBeNull();
    expect(readVaultSecret(other.id, entry.id)).toBeNull();
    expect(updateVaultEntry(other.id, entry.id, { secret: "hijacked" })).toBeNull();
    expect(deleteVaultEntry(other.id, entry.id)).toBe(false);
    expect(revealVaultSecret(owner.id, entry.id)).toBe("ghp_owner_value");

    const otherEntry = createVaultEntry(other.id, { name: "github token", secret: "ghp_other_value" });
    expect(revealVaultSecret(other.id, otherEntry.id)).toBe("ghp_other_value");
    expect(findVaultEntry(owner.id, "GITHUB TOKEN")?.id).toBe(entry.id);
  });

  it("lists entries sorted by name without their values", async () => {
    const owner = await createUser("vault-list");
    createVaultEntry(owner.id, { name: "zeta", secret: "zeta-value" });
    createVaultEntry(owner.id, { name: "Alpha", origin: "https://alpha.example", username: "ada", secret: "alpha-value" });
    createVaultEntry(owner.id, { name: "beta", notes: "staging only", secret: "beta-value" });

    const listed = listVaultEntries(owner.id);
    expect(listed.map((entry) => entry.name)).toEqual(["Alpha", "beta", "zeta"]);
    expect(listed[0]).toEqual({
      id: expect.any(String),
      name: "Alpha",
      origin: "https://alpha.example",
      username: "ada",
      notes: "",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      lastUsedAt: null
    });
    expect(listed[1]).toMatchObject({ origin: null, username: "", notes: "staging only" });
    expect(JSON.stringify(listed)).not.toMatch(/-value/);
  });

  it("validates and normalizes new entries", async () => {
    const owner = await createUser("vault-create");

    const entry = createVaultEntry(owner.id, {
      name: "  GitHub \n token ",
      origin: " https://GitHub.com/login?return_to=/ ",
      username: `  ${"u".repeat(MAX_VAULT_USERNAME_CHARS + 20)}  `,
      notes: "n".repeat(MAX_VAULT_NOTES_CHARS + 20),
      secret: " spaces kept "
    });
    expect(entry).toMatchObject({ name: "GitHub token", origin: "https://github.com", lastUsedAt: null });
    expect(entry.username).toHaveLength(MAX_VAULT_USERNAME_CHARS);
    expect(entry.notes).toHaveLength(MAX_VAULT_NOTES_CHARS);
    expect(revealVaultSecret(owner.id, entry.id)).toBe(" spaces kept ");

    expect(createVaultEntry(owner.id, { name: "Blank site", origin: "   ", secret: "x" }).origin).toBeNull();
    expect(createVaultEntry(owner.id, { name: "Null site", origin: null, secret: "x" }).origin).toBeNull();
    expect(createVaultEntry(owner.id, { name: "No site", secret: "x" }).origin).toBeNull();

    const invalid: Array<[Parameters<typeof createVaultEntry>[1], string]> = [
      [{ name: "  \n ", secret: "x" }, "Give the secret a name."],
      [{ name: "Empty", secret: "" }, "The secret can't be empty."],
      [{ name: "Huge", secret: "x".repeat(MAX_SECRET_CHARS + 1) }, `The secret can be at most ${MAX_SECRET_CHARS} characters.`],
      [{ name: "Ftp", origin: "ftp://example.com", secret: "x" }, SITE_ERROR],
      [{ name: "Garbage", origin: "garbage", secret: "x" }, SITE_ERROR]
    ];
    for (const [input, message] of invalid) {
      const error = thrown(() => createVaultEntry(owner.id, input));
      expect(error).toBeInstanceOf(VaultError);
      expect(error).toMatchObject({ name: "VaultError", status: 400, message });
    }
    expect(createVaultEntry(owner.id, { name: "Max", secret: "x".repeat(MAX_SECRET_CHARS) }).name).toBe("Max");

    expect(thrown(() => createVaultEntry(owner.id, { name: "github TOKEN", secret: "dupe" }))).toMatchObject({
      status: 409,
      message: 'You already have a secret called "GitHub token".'
    });
    expect(listVaultEntries(owner.id)).toHaveLength(5);
  });

  it("updates entries, keeping the stored value unless a new one is given", async () => {
    const owner = await createUser("vault-update");
    const entry = createVaultEntry(owner.id, {
      name: "GitHub token",
      origin: "https://github.com",
      username: "octo",
      notes: "classic token",
      secret: "first-value"
    });
    createVaultEntry(owner.id, { name: "Stripe key", secret: "stripe-value" });

    expect(updateVaultEntry(owner.id, entry.id, { notes: "  fine-grained  " })).toMatchObject({
      name: "GitHub token",
      origin: "https://github.com",
      username: "octo",
      notes: "fine-grained"
    });
    expect(revealVaultSecret(owner.id, entry.id)).toBe("first-value");

    expect(updateVaultEntry(owner.id, entry.id, { secret: "second-value", username: "octocat" })).toMatchObject({
      username: "octocat",
      notes: "fine-grained"
    });
    expect(revealVaultSecret(owner.id, entry.id)).toBe("second-value");

    expect(updateVaultEntry(owner.id, entry.id, { origin: "http://intranet.test:8080/path" })?.origin).toBe("http://intranet.test:8080");
    expect(updateVaultEntry(owner.id, entry.id, { origin: null })?.origin).toBeNull();
    expect(updateVaultEntry(owner.id, entry.id, { origin: "https://github.com" })?.origin).toBe("https://github.com");
    expect(updateVaultEntry(owner.id, entry.id, { origin: "" })?.origin).toBeNull();

    expect(updateVaultEntry(owner.id, entry.id, { name: "github TOKEN" })?.name).toBe("github TOKEN");
    expect(updateVaultEntry(owner.id, entry.id, { name: " GitHub   PAT " })?.name).toBe("GitHub PAT");

    expect(thrown(() => updateVaultEntry(owner.id, entry.id, { name: "stripe KEY" }))).toMatchObject({
      status: 409,
      message: 'You already have a secret called "Stripe key".'
    });
    expect(thrown(() => updateVaultEntry(owner.id, entry.id, { name: "   " }))).toMatchObject({
      status: 400,
      message: "Give the secret a name."
    });
    expect(thrown(() => updateVaultEntry(owner.id, entry.id, { secret: "" }))).toMatchObject({
      status: 400,
      message: "The secret can't be empty."
    });
    expect(thrown(() => updateVaultEntry(owner.id, entry.id, { origin: "ftp://github.com" }))).toMatchObject({
      status: 400,
      message: SITE_ERROR
    });
    expect(getVaultEntry(owner.id, entry.id)).toMatchObject({ name: "GitHub PAT", origin: null });
    expect(revealVaultSecret(owner.id, entry.id)).toBe("second-value");

    expect(updateVaultEntry(owner.id, "vault_missing", { notes: "x" })).toBeNull();
  });

  it("deletes entries", async () => {
    const owner = await createUser("vault-delete");
    const entry = createVaultEntry(owner.id, { name: "Old key", secret: "old" });

    expect(deleteVaultEntry(owner.id, entry.id)).toBe(true);
    expect(getVaultEntry(owner.id, entry.id)).toBeNull();
    expect(revealVaultSecret(owner.id, entry.id)).toBeNull();
    expect(deleteVaultEntry(owner.id, entry.id)).toBe(false);
  });

  it("marks an entry as used only when Eidon reads it, not when the user reveals it", async () => {
    const owner = await createUser("vault-used");
    const entry = createVaultEntry(owner.id, { name: "API key", secret: "api-value" });

    expect(revealVaultSecret(owner.id, entry.id)).toBe("api-value");
    expect(getVaultEntry(owner.id, entry.id)?.lastUsedAt).toBeNull();

    expect(readVaultSecret(owner.id, entry.id)).toBe("api-value");
    expect(getVaultEntry(owner.id, entry.id)?.lastUsedAt).toEqual(expect.any(String));
    expect(readVaultSecret(owner.id, "vault_missing")).toBeNull();
  });

  it("lets the agent add and update entries but never move them to another site", async () => {
    const owner = await createUser("vault-agent");

    expect(saveVaultSecretForAgent(owner.id, { name: "  Stripe   key " })).toEqual({
      error: 'There is no secret called "Stripe key" yet, so include its value.'
    });
    expect(saveVaultSecretForAgent(owner.id, { name: "Stripe key", secret: "" })).toEqual({
      error: "The secret can't be empty."
    });
    expect(saveVaultSecretForAgent(owner.id, { name: "Stripe key", origin: "ftp://stripe.com", secret: "x" })).toEqual({
      error: SITE_ERROR
    });
    expect(listVaultEntries(owner.id)).toEqual([]);

    const created = saveVaultSecretForAgent(owner.id, {
      name: "Stripe key",
      origin: "https://dashboard.stripe.com/login",
      username: "ops@example.com",
      secret: "sk_first"
    });
    expect(created).toEqual({
      entry: expect.objectContaining({ name: "Stripe key", origin: "https://dashboard.stripe.com", username: "ops@example.com" }),
      created: true
    });
    const id = created.entry?.id ?? "";

    expect(saveVaultSecretForAgent(owner.id, { name: "stripe KEY", secret: "sk_second", notes: "rotated" })).toEqual({
      entry: expect.objectContaining({
        id,
        name: "Stripe key",
        origin: "https://dashboard.stripe.com",
        username: "ops@example.com",
        notes: "rotated"
      }),
      created: false
    });
    expect(revealVaultSecret(owner.id, id)).toBe("sk_second");

    expect(
      saveVaultSecretForAgent(owner.id, { name: "Stripe key", origin: "https://dashboard.stripe.com/settings", username: "billing@example.com" })
    ).toMatchObject({ entry: { username: "billing@example.com", notes: "rotated" }, created: false });
    expect(revealVaultSecret(owner.id, id)).toBe("sk_second");

    for (const origin of ["https://evil.example", null, ""]) {
      expect(saveVaultSecretForAgent(owner.id, { name: "Stripe key", origin, secret: "sk_stolen" })).toEqual({
        error: '"Stripe key" is tied to https://dashboard.stripe.com. Only the user can change that, in Settings → Vault.'
      });
    }
    expect(saveVaultSecretForAgent(owner.id, { name: "Stripe key", origin: "nonsense" })).toEqual({ error: SITE_ERROR });
    expect(saveVaultSecretForAgent(owner.id, { name: "Stripe key", secret: "" })).toEqual({ error: "The secret can't be empty." });
    expect(getVaultEntry(owner.id, id)?.origin).toBe("https://dashboard.stripe.com");
    expect(revealVaultSecret(owner.id, id)).toBe("sk_second");

    const apiToken = saveVaultSecretForAgent(owner.id, { name: "API token", secret: "token-1" });
    expect(apiToken).toMatchObject({ entry: { origin: null }, created: true });
    expect(saveVaultSecretForAgent(owner.id, { name: "API token", origin: "https://api.example.com", secret: "token-2" })).toEqual({
      error: '"API token" is tied to no site. Only the user can change that, in Settings → Vault.'
    });
    expect(saveVaultSecretForAgent(owner.id, { name: "API token", origin: null, secret: "token-3" })).toMatchObject({
      entry: { origin: null },
      created: false
    });
    expect(revealVaultSecret(owner.id, apiToken.entry?.id ?? "")).toBe("token-3");

    expect(() => saveVaultSecretForAgent(owner.id, { name: undefined as unknown as string })).toThrow(TypeError);
  });

  it("reserves variables that Eidon or the shell relies on", () => {
    for (const variable of [
      "PATH",
      "HOME",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "AGENT_BROWSER_SESSION",
      "AGENT_BROWSER_ANYTHING",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "PYTHONPATH",
      "BASH_ENV",
      "NODE_OPTIONS",
      "IFS",
      "PERL5OPT"
    ]) {
      expect(isReservedEnvVariable(variable)).toBe(true);
    }
    for (const variable of ["GITHUB_TOKEN", "STRIPE_KEY", "MY_PATH", "API_HOME"]) {
      expect(isReservedEnvVariable(variable)).toBe(false);
    }
  });

  it("resolves secrets into environment variables", async () => {
    const owner = await createUser("vault-env");
    const other = await createUser("vault-env-other");
    const github = createVaultEntry(owner.id, { name: "GitHub token", secret: "ghp_value" });
    const stripe = createVaultEntry(owner.id, { name: "Stripe key", origin: "https://dashboard.stripe.com", secret: "sk_value" });

    expect(
      resolveVaultEnv(owner.id, [
        { name: "github token", variable: " GITHUB_TOKEN " },
        { name: "Stripe key", variable: "STRIPE_KEY" }
      ])
    ).toEqual({
      resolved: [
        { entry: expect.objectContaining({ id: github.id }), variable: "GITHUB_TOKEN" },
        { entry: expect.objectContaining({ id: stripe.id, origin: "https://dashboard.stripe.com" }), variable: "STRIPE_KEY" }
      ]
    });
    expect(resolveVaultEnv(owner.id, [])).toEqual({ resolved: [] });
    expect(getVaultEntry(owner.id, github.id)?.lastUsedAt).toBeNull();

    for (const variable of ["github_token", "1TOKEN", "MY-TOKEN", ""]) {
      expect(resolveVaultEnv(owner.id, [{ name: "GitHub token", variable }])).toEqual({
        error: `"${variable}" isn't a valid variable name. Use capitals, digits and underscores, e.g. API_TOKEN.`
      });
    }
    for (const variable of [
      "PATH",
      "HOME",
      "HTTPS_PROXY",
      "AGENT_BROWSER_SESSION",
      "LD_PRELOAD",
      "PYTHONPATH",
      "BASH_ENV",
      "NODE_OPTIONS"
    ]) {
      expect(resolveVaultEnv(owner.id, [{ name: "GitHub token", variable }])).toEqual({
        error: `${variable} is reserved by Eidon or the shell. Pick another variable name.`
      });
    }
    expect(
      resolveVaultEnv(owner.id, [
        { name: "GitHub token", variable: "TOKEN" },
        { name: "Stripe key", variable: "TOKEN" }
      ])
    ).toEqual({ error: "TOKEN is used twice." });
    expect(resolveVaultEnv(owner.id, [{ name: "  Missing \n thing ", variable: "MISSING" }])).toEqual({
      error: 'There is no secret called "Missing thing". Call list_secrets to see the names.'
    });
    expect(resolveVaultEnv(other.id, [{ name: "GitHub token", variable: "GITHUB_TOKEN" }])).toEqual({
      error: 'There is no secret called "GitHub token". Call list_secrets to see the names.'
    });
  });
});
