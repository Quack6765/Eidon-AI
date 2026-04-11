import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { env, isPasswordLoginEnabled, isProduction } from "@/lib/env";
import { createId } from "@/lib/ids";
import {
  ensureEnvSuperAdminUser,
  findPersistedUserByUsername,
  getUserById,
  getUserRecordById
} from "@/lib/users";
import type { AuthSession, AuthUser } from "@/lib/types";

const encoder = new TextEncoder();
const sessionDurationMs = 1000 * 60 * 60 * 24 * 30;

function getSessionSecret() {
  return encoder.encode(env.EIDON_SESSION_SECRET);
}

function nowIso() {
  return new Date().toISOString();
}

function rowToUser(row: {
  id: string;
  username: string;
  role: AuthUser["role"];
  authSource: AuthUser["authSource"];
  createdAt: string;
  updatedAt: string;
}): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    authSource: row.authSource,
    passwordManagedBy: row.authSource === "env_super_admin" ? "env" : "local",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
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
  await ensureEnvSuperAdminUser();
}

async function getBootstrapUser() {
  const user = await ensureEnvSuperAdminUser();
  return rowToUser(user);
}

export async function findUserByUsername(username: string) {
  await ensureAdminBootstrap();
  const record = findPersistedUserByUsername(username);
  if (!record) {
    return null;
  }

  return {
    user: rowToUser(record.user),
    passwordHash: record.passwordHash
  };
}

export async function authenticateUser(username: string, password: string) {
  await ensureAdminBootstrap();
  const record = await findUserByUsername(username);
  if (!record) return null;

  if (record.user.authSource === "env_super_admin") {
    return password === env.EIDON_ADMIN_PASSWORD ? record.user : null;
  }

  if (!record.passwordHash) return null;
  return (await verifyPassword(password, record.passwordHash)) ? record.user : null;
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

function getRequestProtocol(request: Request) {
  const forwarded = request.headers.get("forwarded");

  if (forwarded) {
    const protoMatch = forwarded.match(/proto=([^;,\s]+)/i);

    if (protoMatch?.[1]) {
      return protoMatch[1].toLowerCase();
    }
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim().toLowerCase();
  }

  return new URL(request.url).protocol.replace(":", "").toLowerCase();
}

function shouldUseSecureSessionCookie(request?: Request) {
  if (!isProduction()) {
    return false;
  }

  if (!request) {
    return true;
  }

  return getRequestProtocol(request) === "https";
}

export async function setSessionCookie(token: string, expiresAt: Date, request?: Request) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureSessionCookie(request),
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

export async function verifySessionToken(token: string): Promise<{ sessionId: string; userId: string } | null> {
  if (!token) return null;
  try {
    const result = await jwtVerify(token, getSessionSecret());
    return { sessionId: result.payload.sid as string, userId: result.payload.uid as string };
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  if (!isPasswordLoginEnabled()) {
    return getBootstrapUser();
  }

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
    return null;
  }

  const session = rowToSession(sessionRow);

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(session.id);
    return null;
  }

  const user = getUserById(session.userId);
  if (!user) {
    return null;
  }

  return rowToUser(user);
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

export async function requireAdminUser() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("forbidden");
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
  const record = getUserRecordById(userId);
  if (!record) {
    return;
  }
  if (record.user.authSource === "env_super_admin") {
    throw new Error("Env-managed credentials cannot be changed in the UI");
  }
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE users
       SET username = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(username, timestamp, userId);
}

export async function updatePassword(userId: string, password: string) {
  const record = getUserRecordById(userId);
  if (!record) {
    return;
  }
  if (record.user.authSource === "env_super_admin") {
    throw new Error("Env-managed credentials cannot be changed in the UI");
  }
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE users
       SET password_hash = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(await hashPassword(password), timestamp, userId);
}

export async function updateOwnPassword(user: AuthUser, password: string) {
  if (user.passwordManagedBy === "env") {
    throw new Error("Env-managed credentials cannot be changed in the UI");
  }

  await updatePassword(user.id, password);
}
