import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, createSecretKey, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

import {
  SESSION_COOKIE_NAME,
  SESSION_TOKEN_AUDIENCE,
  SESSION_TOKEN_ISSUER,
  SESSION_TOKEN_USE,
  MOBILE_DEVICE_NAME_MAX_CHARS,
  MOBILE_SESSION_DURATION_MS,
  MOBILE_SESSION_TOKEN_AUDIENCE,
  MOBILE_SESSION_TOKEN_USE
} from "@/lib/constants";
import { getDb } from "@/lib/db";
import { env, isPasswordLoginEnabled, isProduction } from "@/lib/env";
import { createId } from "@/lib/ids";
import {
  ensureEnvSuperAdminUser,
  findPersistedUserByUsername,
  getUserById,
  getUserRecordById
} from "@/lib/users";
import type { AuthSession, AuthUser, MobileSession } from "@/lib/types";
import { nowIso } from "@/lib/utils";

const encoder = new TextEncoder();
const sessionDurationMs = 1000 * 60 * 60 * 24 * 30;
const mobileAuthContext = new AsyncLocalStorage<{
  user: AuthUser;
  sessionId: string;
}>();

type SessionPayload = {
  sessionId: string;
  userId: string;
};

function getSessionSecret() {
  return encoder.encode(env.EIDON_SESSION_SECRET);
}

function getMobileSessionSecret() {
  return createSecretKey(
    createHash("sha256")
      .update("eidon-mobile-session-v1\0")
      .update(env.EIDON_SESSION_SECRET)
      .digest()
  );
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
    `INSERT INTO auth_sessions (id, user_id, purpose, device_name, expires_at, created_at)
     VALUES (?, ?, 'browser', NULL, ?, ?)`
  ).run(sessionId, userId, expiresAt.toISOString(), createdAt.toISOString());

  const token = await new SignJWT({ sid: sessionId, uid: userId, tokenUse: SESSION_TOKEN_USE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_TOKEN_ISSUER)
    .setAudience(SESSION_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getSessionSecret());

  return { sessionId, token, expiresAt };
}

export async function createMobileSession(userId: string, deviceName: string) {
  const normalizedDeviceName = deviceName.trim();
  if (!normalizedDeviceName || normalizedDeviceName.length > MOBILE_DEVICE_NAME_MAX_CHARS) {
    throw new Error("Invalid mobile device name");
  }

  const db = getDb();
  const sessionId = createId("mobile_session");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + MOBILE_SESSION_DURATION_MS);

  db.prepare(
    `INSERT INTO auth_sessions (id, user_id, purpose, device_name, expires_at, created_at)
     VALUES (?, ?, 'mobile', ?, ?, ?)`
  ).run(
    sessionId,
    userId,
    normalizedDeviceName,
    expiresAt.toISOString(),
    createdAt.toISOString()
  );

  const token = await new SignJWT({
    sid: sessionId,
    uid: userId,
    tokenUse: MOBILE_SESSION_TOKEN_USE
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_TOKEN_ISSUER)
    .setAudience(MOBILE_SESSION_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getMobileSessionSecret());

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

async function decodeSessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const result = await jwtVerify(token, getSessionSecret(), {
      algorithms: ["HS256"],
      issuer: SESSION_TOKEN_ISSUER,
      audience: SESSION_TOKEN_AUDIENCE
    });
    const { sid, uid, tokenUse } = result.payload;

    if (
      tokenUse !== SESSION_TOKEN_USE ||
      typeof sid !== "string" ||
      !sid.trim() ||
      typeof uid !== "string" ||
      !uid.trim()
    ) {
      return null;
    }

    return {
      sessionId: sid,
      userId: uid
    };
  } catch {
    return null;
  }
}

function decodeMobileSessionToken(token: string): SessionPayload | null {
  try {
    if (token.length > 8192) {
      return null;
    }

    const segments = token.split(".");

    if (
      segments.length !== 3 ||
      segments.some((segment) => !segment || !/^[A-Za-z0-9_-]+$/.test(segment))
    ) {
      return null;
    }

    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    const headerBytes = Buffer.from(encodedHeader, "base64url");
    const payloadBytes = Buffer.from(encodedPayload, "base64url");
    const signature = Buffer.from(encodedSignature, "base64url");

    if (
      headerBytes.toString("base64url") !== encodedHeader ||
      payloadBytes.toString("base64url") !== encodedPayload ||
      signature.toString("base64url") !== encodedSignature
    ) {
      return null;
    }

    const expectedSignature = createHmac("sha256", getMobileSessionSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();

    if (
      signature.length !== expectedSignature.length ||
      !timingSafeEqual(signature, expectedSignature)
    ) {
      return null;
    }

    const header = JSON.parse(headerBytes.toString("utf8")) as unknown;
    const payload = JSON.parse(payloadBytes.toString("utf8")) as unknown;

    if (
      !header ||
      typeof header !== "object" ||
      Array.isArray(header) ||
      (header as Record<string, unknown>).alg !== "HS256" ||
      "crit" in header ||
      "b64" in header ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      return null;
    }

    const {
      sid,
      uid,
      tokenUse,
      iss,
      aud,
      exp,
      nbf
    } = payload as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);

    if (
      tokenUse !== MOBILE_SESSION_TOKEN_USE ||
      iss !== SESSION_TOKEN_ISSUER ||
      aud !== MOBILE_SESSION_TOKEN_AUDIENCE ||
      typeof exp !== "number" ||
      !Number.isFinite(exp) ||
      exp <= now ||
      (nbf !== undefined &&
        (typeof nbf !== "number" || !Number.isFinite(nbf) || nbf > now)) ||
      typeof sid !== "string" ||
      !sid.trim() ||
      typeof uid !== "string" ||
      !uid.trim()
    ) {
      return null;
    }

    return { sessionId: sid, userId: uid };
  } catch {
    return null;
  }
}

export async function getSessionPayload() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return token ? decodeSessionToken(token) : null;
}

export async function verifySessionToken(token: string): Promise<{ sessionId: string; userId: string } | null> {
  if (!token) return null;
  const payload = await decodeSessionToken(token);
  if (!payload) {
    return null;
  }

  const db = getDb();
  const session = db
    .prepare(
      `SELECT id, user_id, expires_at
       FROM auth_sessions
       WHERE id = ? AND purpose = 'browser'`
    )
    .get(payload.sessionId) as
    | { id: string; user_id: string; expires_at: string }
    | undefined;

  if (!session || session.user_id !== payload.userId) {
    return null;
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(session.id);
    return null;
  }

  if (!getUserById(payload.userId)) {
    return null;
  }

  return payload;
}

export async function verifyMobileSessionToken(
  token: string
): Promise<{ sessionId: string; userId: string } | null> {
  if (!token) return null;
  const payload = await decodeMobileSessionToken(token);
  if (!payload) return null;

  const db = getDb();
  const session = db
    .prepare(
      `SELECT id, user_id, expires_at
       FROM auth_sessions
       WHERE id = ? AND purpose = 'mobile'`
    )
    .get(payload.sessionId) as
    | { id: string; user_id: string; expires_at: string }
    | undefined;

  if (!session || session.user_id !== payload.userId) return null;

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(session.id);
    return null;
  }

  if (!getUserById(payload.userId)) return null;
  return payload;
}

export function extractMobileBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = authorization.match(/^Bearer ([^\s,]+)$/);
  return match?.[1] ?? null;
}

export async function authenticateMobileRequest(request: Request) {
  const token = extractMobileBearerToken(request);
  if (!token) return null;
  const session = await verifyMobileSessionToken(token);
  if (!session) return null;
  const record = getUserById(session.userId);
  if (!record) return null;
  return { sessionId: session.sessionId, user: rowToUser(record) };
}

export function runWithMobileUser<T>(
  sessionId: string,
  user: AuthUser,
  callback: () => T
) {
  return mobileAuthContext.run({ sessionId, user }, callback);
}

export function getMobileRequestSessionId() {
  return mobileAuthContext.getStore()?.sessionId ?? null;
}

export async function getCurrentUser() {
  const mobileContext = mobileAuthContext.getStore();
  if (mobileContext) {
    const current = getUserById(mobileContext.user.id);
    return current ? rowToUser(current) : null;
  }

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
       WHERE id = ? AND purpose = 'browser'`
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

export async function requireAdminResponse() {
  try {
    return await requireAdminUser();
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return null;
    }
    throw error;
  }
}

export async function invalidateSession(sessionId: string) {
  getDb().prepare("DELETE FROM auth_sessions WHERE id = ?").run(sessionId);
}

export async function invalidateAllSessionsForUser(userId: string) {
  getDb().prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
}

export async function invalidateMobileSessionsForUser(userId: string) {
  getDb()
    .prepare("DELETE FROM auth_sessions WHERE user_id = ? AND purpose = 'mobile'")
    .run(userId);
}

export function listMobileSessionsForUser(userId: string): MobileSession[] {
  const rows = getDb()
    .prepare(
      `SELECT id, user_id, device_name, expires_at, created_at
       FROM auth_sessions
       WHERE user_id = ? AND purpose = 'mobile' AND expires_at > ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(userId, new Date().toISOString()) as Array<{
    id: string;
    user_id: string;
    device_name: string | null;
    expires_at: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    deviceName: row.device_name ?? "Unknown device",
    expiresAt: row.expires_at,
    createdAt: row.created_at
  }));
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
  await invalidateAllSessionsForUser(userId);
}

export async function updateOwnPassword(user: AuthUser, password: string) {
  if (user.passwordManagedBy === "env") {
    throw new Error("Env-managed credentials cannot be changed in the UI");
  }

  await updatePassword(user.id, password);
}
