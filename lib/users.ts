import argon2 from "argon2";

import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";
import type { PersistedUser, UserRole } from "@/lib/types";

type UserRow = {
  id: string;
  username: string;
  role: UserRole;
  auth_source: PersistedUser["authSource"];
  password_hash: string | null;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function rowToUser(row: UserRow): PersistedUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    authSource: row.auth_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function ensureUserSettings(userId: string, timestamp = nowIso()) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_settings (user_id, updated_at)
       VALUES (?, ?)`
    )
    .run(userId, timestamp);
}

async function hashLocalPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

function getLegacyAdminRow() {
  return getDb()
    .prepare(
      `SELECT id, username, created_at, updated_at
       FROM admin_users
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get() as
    | {
        id: string;
        username: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

export function getUserById(userId: string) {
  const row = getDb()
    .prepare(
      `SELECT id, username, role, auth_source, password_hash, created_at, updated_at
       FROM users
       WHERE id = ?`
    )
    .get(userId) as UserRow | undefined;

  return row ? rowToUser(row) : null;
}

export function getUserRecordById(userId: string) {
  const row = getDb()
    .prepare(
      `SELECT id, username, role, auth_source, password_hash, created_at, updated_at
       FROM users
       WHERE id = ?`
    )
    .get(userId) as UserRow | undefined;

  if (!row) {
    return null;
  }

  return {
    user: rowToUser(row),
    passwordHash: row.password_hash
  };
}

export function findPersistedUserByUsername(username: string) {
  const row = getDb()
    .prepare(
      `SELECT id, username, role, auth_source, password_hash, created_at, updated_at
       FROM users
       WHERE username = ?`
    )
    .get(username) as UserRow | undefined;

  if (!row) {
    return null;
  }

  return {
    user: rowToUser(row),
    passwordHash: row.password_hash
  };
}

export function listUsers() {
  const rows = getDb()
    .prepare(
      `SELECT id, username, role, auth_source, password_hash, created_at, updated_at
       FROM users
       ORDER BY created_at ASC, username ASC`
    )
    .all() as UserRow[];

  return rows.map(rowToUser);
}

export async function ensureEnvSuperAdminUser(): Promise<PersistedUser> {
  const db = getDb();
  const envUsername = env.EIDON_ADMIN_USERNAME;
  const existingEnvUser = db
    .prepare(
      `SELECT id, username, role, auth_source, password_hash, created_at, updated_at
       FROM users
       WHERE auth_source = 'env_super_admin'`
    )
    .get() as UserRow | undefined;
  const conflictingLocal = db
    .prepare(`SELECT id FROM users WHERE auth_source = 'local' AND username = ?`)
    .get(envUsername) as { id: string } | undefined;

  if (conflictingLocal) {
    throw new Error(`Env super-admin username "${envUsername}" collides with an existing local user`);
  }

  if (existingEnvUser) {
    if (existingEnvUser.username !== envUsername || existingEnvUser.role !== "admin") {
      db.prepare(`UPDATE users SET username = ?, role = 'admin', updated_at = ? WHERE id = ?`).run(
        envUsername,
        nowIso(),
        existingEnvUser.id
      );
    }
    ensureUserSettings(existingEnvUser.id);
    return getUserById(existingEnvUser.id)!;
  }

  const legacyAdmin = getLegacyAdminRow();
  const timestamp = nowIso();
  const userId = legacyAdmin?.id ?? createId("user");
  const createdAt = legacyAdmin?.created_at ?? timestamp;
  const updatedAt = legacyAdmin?.updated_at ?? timestamp;

  db.prepare(
    `INSERT INTO users (id, username, role, auth_source, password_hash, created_at, updated_at)
     VALUES (?, ?, 'admin', 'env_super_admin', NULL, ?, ?)`
  ).run(userId, envUsername, createdAt, updatedAt);
  ensureUserSettings(userId, updatedAt);
  return getUserById(userId)!;
}

export async function createLocalUser({
  username,
  password,
  role
}: {
  username: string;
  password: string;
  role: UserRole;
}) {
  if (username === env.EIDON_ADMIN_USERNAME) {
    throw new Error(`Username "${username}" is reserved for the env super-admin`);
  }

  const db = getDb();
  const timestamp = nowIso();
  const userId = createId("user");
  const passwordHash = await hashLocalPassword(password);

  db.prepare(
    `INSERT INTO users (id, username, role, auth_source, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'local', ?, ?, ?)`
  ).run(userId, username, role, passwordHash, timestamp, timestamp);
  ensureUserSettings(userId, timestamp);
  return getUserById(userId)!;
}

export async function updateManagedUser(
  userId: string,
  updates: {
    username?: string;
    role?: UserRole;
    password?: string;
  }
) {
  const existing = getUserRecordById(userId);

  if (!existing) {
    return null;
  }

  if (existing.user.authSource !== "local") {
    throw new Error("Env-managed users cannot be updated by the manager");
  }

  const nextUsername = updates.username ?? existing.user.username;
  if (nextUsername === env.EIDON_ADMIN_USERNAME) {
    throw new Error(`Username "${nextUsername}" is reserved for the env super-admin`);
  }

  const nextRole = updates.role ?? existing.user.role;
  const nextPasswordHash =
    updates.password === undefined
      ? existing.passwordHash
      : await hashLocalPassword(updates.password);
  const timestamp = nowIso();

  getDb()
    .prepare(
      `UPDATE users
       SET username = ?, role = ?, password_hash = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(nextUsername, nextRole, nextPasswordHash, timestamp, userId);

  return getUserById(userId);
}

export function deleteManagedUser(userId: string) {
  const existing = getUserRecordById(userId);

  if (!existing) {
    return false;
  }

  if (existing.user.authSource !== "local") {
    throw new Error("Env-managed users cannot be deleted by the manager");
  }

  const result = getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
  return result.changes > 0;
}
