import { z } from "zod";

import {
  MAX_SECRET_CHARS,
  MAX_VAULT_NAME_CHARS,
  MAX_VAULT_NOTES_CHARS,
  MAX_VAULT_USERNAME_CHARS
} from "@/lib/constants";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { SHELL_ENV_ALLOWLIST, SHELL_ENV_EXTRA_ALLOWLIST } from "@/lib/local-shell";
import { nowIso } from "@/lib/utils";

export type VaultEntry = {
  id: string;
  name: string;
  origin: string | null;
  username: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type VaultEntryInput = {
  name?: string;
  origin?: string | null;
  username?: string;
  notes?: string;
  secret?: string;
};

export type VaultEnvRequest = { name: string; variable: string };

export const vaultEntryUpdateSchema = z
  .object({
    name: z.string().max(MAX_VAULT_NAME_CHARS * 2).optional(),
    origin: z.string().max(2_000).nullable().optional(),
    username: z.string().max(MAX_VAULT_USERNAME_CHARS).optional(),
    notes: z.string().max(MAX_VAULT_NOTES_CHARS).optional(),
    secret: z.string().min(1).max(MAX_SECRET_CHARS).optional()
  })
  .strict();

export const vaultEntryCreateSchema = vaultEntryUpdateSchema.extend({
  name: z.string().max(MAX_VAULT_NAME_CHARS * 2),
  secret: z.string().min(1).max(MAX_SECRET_CHARS)
});

type VaultEntryRow = {
  id: string;
  name: string;
  origin: string | null;
  username: string;
  notes: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

const ENTRY_COLUMNS = "id, name, origin, username, notes, created_at, updated_at, last_used_at";
const ENV_VARIABLE_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_ENV_PREFIXES = ["LD_", "DYLD_", "PYTHON", "BASH_", "GCONV", "MALLOC_", "GLIBC_", "NODE_", "AGENT_BROWSER_"];
const RESERVED_ENV_NAMES = new Set<string>([
  ...SHELL_ENV_ALLOWLIST,
  ...SHELL_ENV_EXTRA_ALLOWLIST.map((name) => name.toUpperCase()),
  "ENV",
  "IFS",
  "PS4",
  "CDPATH",
  "SHELLOPTS",
  "BASHOPTS",
  "LOCPATH",
  "NLSPATH",
  "HOSTALIASES",
  "RES_OPTIONS",
  "LOCALDOMAIN",
  "TZDIR",
  "PERL5OPT",
  "PERL5LIB",
  "RUBYOPT",
  "RUBYLIB"
]);

export class VaultError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "VaultError";
  }
}

export function normalizeSecretOrigin(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function normalizeSecretName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_VAULT_NAME_CHARS);
}

function toVaultEntry(row: VaultEntryRow): VaultEntry {
  return {
    id: row.id,
    name: row.name,
    origin: row.origin,
    username: row.username,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at
  };
}

function parseOrigin(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || !value.trim()) return null;
  const origin = normalizeSecretOrigin(value);
  if (!origin) throw new VaultError("The site must be a web address such as https://example.com.");
  return origin;
}

function parseName(value: string) {
  const name = normalizeSecretName(value);
  if (!name) throw new VaultError("Give the secret a name.");
  return name;
}

function parseSecret(value: string) {
  if (!value) throw new VaultError("The secret can't be empty.");
  if (value.length > MAX_SECRET_CHARS) throw new VaultError(`The secret can be at most ${MAX_SECRET_CHARS} characters.`);
  return value;
}

function parseText(value: string | undefined, limit: number) {
  return value === undefined ? undefined : value.trim().slice(0, limit);
}

function assertNameFree(userId: string, name: string, exceptId?: string) {
  const existing = findVaultEntry(userId, name);
  if (existing && existing.id !== exceptId) {
    throw new VaultError(`You already have a secret called "${existing.name}".`, 409);
  }
}

export function listVaultEntries(userId: string) {
  const rows = getDb()
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM vault_entries WHERE user_id = ? ORDER BY name`)
    .all(userId) as VaultEntryRow[];
  return rows.map(toVaultEntry);
}

export function getVaultEntry(userId: string, id: string) {
  const row = getDb()
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM vault_entries WHERE id = ? AND user_id = ?`)
    .get(id, userId) as VaultEntryRow | undefined;
  return row ? toVaultEntry(row) : null;
}

export function findVaultEntry(userId: string, name: string) {
  const row = getDb()
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM vault_entries WHERE user_id = ? AND name = ?`)
    .get(userId, normalizeSecretName(name)) as VaultEntryRow | undefined;
  return row ? toVaultEntry(row) : null;
}

export function createVaultEntry(userId: string, input: VaultEntryInput & { name: string; secret: string }) {
  const name = parseName(input.name);
  const secret = parseSecret(input.secret);
  const origin = parseOrigin(input.origin) ?? null;
  assertNameFree(userId, name);
  const id = createId("vault");
  const timestamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO vault_entries (id, user_id, name, origin, username, notes, secret_encrypted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      name,
      origin,
      parseText(input.username, MAX_VAULT_USERNAME_CHARS) ?? "",
      parseText(input.notes, MAX_VAULT_NOTES_CHARS) ?? "",
      encryptValue(secret),
      timestamp,
      timestamp
    );
  return getVaultEntry(userId, id) as VaultEntry;
}

export function updateVaultEntry(userId: string, id: string, input: VaultEntryInput) {
  const current = getVaultEntry(userId, id);
  if (!current) return null;
  const name = input.name === undefined ? current.name : parseName(input.name);
  if (name !== current.name) assertNameFree(userId, name, id);
  const origin = parseOrigin(input.origin);
  const secret = input.secret === undefined ? undefined : parseSecret(input.secret);
  getDb()
    .prepare(
      `UPDATE vault_entries
       SET name = ?, origin = ?, username = ?, notes = ?, secret_encrypted = COALESCE(?, secret_encrypted), updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(
      name,
      origin === undefined ? current.origin : origin,
      parseText(input.username, MAX_VAULT_USERNAME_CHARS) ?? current.username,
      parseText(input.notes, MAX_VAULT_NOTES_CHARS) ?? current.notes,
      secret === undefined ? null : encryptValue(secret),
      nowIso(),
      id,
      userId
    );
  return getVaultEntry(userId, id);
}

export function deleteVaultEntry(userId: string, id: string) {
  return getDb().prepare("DELETE FROM vault_entries WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function revealVaultSecret(userId: string, id: string) {
  const row = getDb()
    .prepare("SELECT secret_encrypted FROM vault_entries WHERE id = ? AND user_id = ?")
    .get(id, userId) as { secret_encrypted: string } | undefined;
  return row ? decryptValue(row.secret_encrypted) : null;
}

export function readVaultSecret(userId: string, id: string) {
  const secret = revealVaultSecret(userId, id);
  if (secret !== null) {
    getDb().prepare("UPDATE vault_entries SET last_used_at = ? WHERE id = ? AND user_id = ?").run(nowIso(), id, userId);
  }
  return secret;
}

export function saveVaultSecretForAgent(userId: string, input: VaultEntryInput & { name: string }) {
  try {
    const existing = findVaultEntry(userId, input.name);
    if (!existing) {
      if (input.secret === undefined) return { error: `There is no secret called "${normalizeSecretName(input.name)}" yet, so include its value.` };
      return { entry: createVaultEntry(userId, { ...input, secret: input.secret }), created: true };
    }
    const origin = parseOrigin(input.origin);
    if (origin !== undefined && origin !== existing.origin) {
      return {
        error: `"${existing.name}" is tied to ${existing.origin ?? "no site"}. Only the user can change that, in Settings → Vault.`
      };
    }
    const entry = updateVaultEntry(userId, existing.id, {
      secret: input.secret,
      username: input.username,
      notes: input.notes
    }) as VaultEntry;
    return { entry, created: false };
  } catch (error) {
    if (error instanceof VaultError) return { error: error.message };
    throw error;
  }
}

export function isReservedEnvVariable(variable: string) {
  return RESERVED_ENV_NAMES.has(variable) || RESERVED_ENV_PREFIXES.some((prefix) => variable.startsWith(prefix));
}

export function resolveVaultEnv(userId: string, requests: VaultEnvRequest[]) {
  const seen = new Set<string>();
  const resolved: Array<{ entry: VaultEntry; variable: string }> = [];
  for (const request of requests) {
    const variable = request.variable.trim();
    if (!ENV_VARIABLE_PATTERN.test(variable)) {
      return { error: `"${variable}" isn't a valid variable name. Use capitals, digits and underscores, e.g. API_TOKEN.` };
    }
    if (isReservedEnvVariable(variable)) {
      return { error: `${variable} is reserved by Eidon or the shell. Pick another variable name.` };
    }
    if (seen.has(variable)) return { error: `${variable} is used twice.` };
    seen.add(variable);
    const entry = findVaultEntry(userId, request.name);
    if (!entry) return { error: `There is no secret called "${normalizeSecretName(request.name)}". Call list_secrets to see the names.` };
    resolved.push({ entry, variable });
  }
  return { resolved };
}
