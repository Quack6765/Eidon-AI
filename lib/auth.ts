import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { env, isPasswordLoginEnabled, isProduction } from "@/lib/env";
import { createId } from "@/lib/ids";
import type { AuthSession, AuthUser } from "@/lib/types";

const encoder = new TextEncoder();
const sessionDurationMs = 1000 * 60 * 60 * 24 * 30;

function getSessionSecret() {
  return encoder.encode(env.HERMES_SESSION_SECRET);
}

function nowIso() {
  return new Date().toISOString();
}

function rowToUser(row: {
  id: string;
  username: string;
  created_at: string;
  updated_at: string;
}): AuthUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToSession(row: {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(password: string, hashedPassword: string) {
  return argon2.verify(hashedPassword, password);
}

export async function ensureAdminBootstrap() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as count FROM admin_users").get() as {
    count: number;
  };

  if (count.count > 0) {
    return;
  }

  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO admin_users (id, username, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    createId("user"),
    env.HERMES_ADMIN_USERNAME,
    await hashPassword(env.HERMES_ADMIN_PASSWORD),
    timestamp,
    timestamp
  );
}

async function getBootstrapUser() {
  await ensureAdminBootstrap();

  const row = getDb()
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

  if (!row) {
    return null;
  }

  return rowToUser(row);
}

export async function findUserByUsername(username: string) {
  await ensureAdminBootstrap();

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, username, created_at, updated_at, password_hash
       FROM admin_users
       WHERE username = ?`
    )
    .get(username) as
    | (AuthUser & { password_hash: string; created_at: string; updated_at: string })
    | undefined;

  if (!row) {
    return null;
  }

  return {
    user: rowToUser(row),
    passwordHash: row.password_hash
  };
}

export async function createSession(userId: string) {
  const db = getDb();
  const sessionId = createId("session");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + sessionDurationMs);

  db.prepare(
    `INSERT INTO auth_sessions (id, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(sessionId, userId, expiresAt.toISOString(), createdAt.toISOString());

  const token = await new SignJWT({ sid: sessionId, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getSessionSecret());

  return { sessionId, token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    expires: expiresAt
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getSessionPayload() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  try {
    const result = await jwtVerify(token, getSessionSecret());
    return {
      sessionId: result.payload.sid as string,
      userId: result.payload.uid as string
    };
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  if (!isPasswordLoginEnabled()) {
    return getBootstrapUser();
  }

  await ensureAdminBootstrap();

  const payload = await getSessionPayload();

  if (!payload) {
    return null;
  }

  const db = getDb();
  const sessionRow = db
    .prepare(
      `SELECT id, user_id, expires_at, created_at
       FROM auth_sessions
       WHERE id = ?`
    )
    .get(payload.sessionId) as
    | {
        id: string;
        user_id: string;
        expires_at: string;
        created_at: string;
      }
    | undefined;

  if (!sessionRow) {
    await clearSessionCookie();
    return null;
  }

  const session = rowToSession(sessionRow);

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(session.id);
    await clearSessionCookie();
    return null;
  }

  const userRow = db
    .prepare(
      `SELECT id, username, created_at, updated_at
       FROM admin_users
       WHERE id = ?`
    )
    .get(session.userId) as
    | {
        id: string;
        username: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!userRow) {
    await clearSessionCookie();
    return null;
  }

  return rowToUser(userRow);
}

export async function requireUser(redirectToLogin?: true): Promise<AuthUser>
export async function requireUser(redirectToLogin: false): Promise<AuthUser | null>
export async function requireUser(redirectToLogin?: boolean): Promise<AuthUser | null> {
  const user = await getCurrentUser();
  const shouldRedirect = redirectToLogin !== false;

  if (!user) {
    if (shouldRedirect) {
      redirect("/login");
    }

    return null;
  }

  return user;
}

export async function invalidateSession(sessionId: string) {
  getDb().prepare("DELETE FROM auth_sessions WHERE id = ?").run(sessionId);
}

export async function invalidateAllSessionsForUser(userId: string) {
  getDb().prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
}

export async function updateUsername(userId: string, username: string) {
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE admin_users
       SET username = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(username, timestamp, userId);
}

export async function updatePassword(userId: string, password: string) {
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE admin_users
       SET password_hash = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(await hashPassword(password), timestamp, userId);
}
