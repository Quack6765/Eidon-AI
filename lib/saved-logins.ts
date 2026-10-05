import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { nowIso } from "@/lib/utils";

export type SavedLogin = {
  id: string;
  origin: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

type SavedLoginRow = {
  id: string;
  origin: string;
  label: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

export function normalizeLoginOrigin(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function normalizeLoginLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 60);
}

function toSavedLogin(row: SavedLoginRow): SavedLogin {
  return {
    id: row.id,
    origin: row.origin,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at
  };
}

export function listSavedLogins(userId: string) {
  const rows = getDb()
    .prepare(
      "SELECT id, origin, label, created_at, updated_at, last_used_at FROM saved_logins WHERE user_id = ? ORDER BY origin, label"
    )
    .all(userId) as SavedLoginRow[];
  return rows.map(toSavedLogin);
}

export function saveLogin(userId: string, origin: string, label: string, secret: string) {
  const timestamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO saved_logins (id, user_id, origin, label, secret_encrypted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, origin, label) DO UPDATE SET
         secret_encrypted = excluded.secret_encrypted,
         updated_at = excluded.updated_at`
    )
    .run(createId("login"), userId, origin, label, encryptValue(secret), timestamp, timestamp);
}

export function readSavedLogin(userId: string, origin: string, label: string) {
  const row = getDb()
    .prepare("SELECT id, secret_encrypted FROM saved_logins WHERE user_id = ? AND origin = ? AND label = ?")
    .get(userId, origin, label) as { id: string; secret_encrypted: string } | undefined;
  if (!row) return null;
  getDb().prepare("UPDATE saved_logins SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);
  return decryptValue(row.secret_encrypted);
}

export function deleteSavedLogin(id: string, userId: string) {
  return getDb().prepare("DELETE FROM saved_logins WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}
