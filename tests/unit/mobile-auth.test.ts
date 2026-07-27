import { createHash, createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authenticateMobileRequest,
  createMobileSession,
  createSession,
  ensureAdminBootstrap,
  extractMobileBearerToken,
  findUserByUsername,
  getCurrentUser,
  invalidateAllSessionsForUser,
  invalidateMobileSessionsForUser,
  listMobileSessionsForUser,
  runWithMobileUser,
  updatePassword,
  verifyMobileSessionToken,
  verifySessionToken
} from "@/lib/auth";
import { GET as getMobileSession } from "@/app/api/v1/auth/session/route";
import { GET as listMobileSessions } from "@/app/api/v1/auth/sessions/route";
import { DELETE as revokeMobileSession } from "@/app/api/v1/auth/sessions/[sessionId]/route";
import { POST as loginMobile } from "@/app/api/v1/auth/login/route";
import { POST as logoutMobile } from "@/app/api/v1/auth/logout/route";
import { getDb } from "@/lib/db";
import { resetMobileLoginRateLimiterForTests } from "@/lib/mobile-api";
import { createLocalUser, deleteManagedUser } from "@/lib/users";
import { assertOpenApiResponse } from "@/tests/fixtures/mobile-contract-validator";

const originalNodeEnv = process.env.NODE_ENV;
const originalPasswordLogin = process.env.EIDON_PASSWORD_LOGIN_ENABLED;
const mutableEnv = process.env as Record<string, string | undefined>;

function getMobileSigningKey() {
  return createSecretKey(
    createHash("sha256")
      .update("eidon-mobile-session-v1\0")
      .update(process.env.EIDON_SESSION_SECRET!)
      .digest()
  );
}

async function signMobileClaims(
  claims: Record<string, unknown>,
  options: {
    issuer?: string;
    audience?: string | string[];
    expiration?: number;
    notBefore?: number;
  } = {}
) {
  let token = new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(options.issuer ?? "eidon")
    .setAudience(options.audience ?? "eidon-mobile-api");

  if (options.expiration !== undefined) {
    token = token.setExpirationTime(options.expiration);
  }

  if (options.notBefore !== undefined) {
    token = token.setNotBefore(options.notBefore);
  }

  return token.sign(getMobileSigningKey());
}

function bearerRequest(url: string, token: string, method = "GET") {
  return new Request(url, {
    method,
    headers: { authorization: `Bearer ${token}` }
  });
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("mobile session authentication", () => {
  beforeEach(() => {
    mutableEnv.NODE_ENV = "test";
    process.env.EIDON_PASSWORD_LOGIN_ENABLED = "true";
    resetMobileLoginRateLimiterForTests();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
    process.env.EIDON_PASSWORD_LOGIN_ENABLED = originalPasswordLogin;
    vi.restoreAllMocks();
  });

  it("creates cryptographically and persistently isolated browser and mobile sessions", async () => {
    await ensureAdminBootstrap();
    const admin = (await findUserByUsername("admin"))!.user;
    const browser = await createSession(admin.id);
    const mobile = await createMobileSession(admin.id, "Charles's iPad");

    await expect(verifySessionToken(browser.token)).resolves.toEqual({
      sessionId: browser.sessionId,
      userId: admin.id
    });
    await expect(verifyMobileSessionToken(mobile.token)).resolves.toEqual({
      sessionId: mobile.sessionId,
      userId: admin.id
    });
    await expect(verifySessionToken(mobile.token)).resolves.toBeNull();
    await expect(verifyMobileSessionToken(browser.token)).resolves.toBeNull();

    expect(getDb().prepare(
      "SELECT id, purpose, device_name FROM auth_sessions ORDER BY purpose ASC"
    ).all()).toEqual([
      { id: browser.sessionId, purpose: "browser", device_name: null },
      { id: mobile.sessionId, purpose: "mobile", device_name: "Charles's iPad" }
    ]);
    expect(JSON.stringify(getDb().prepare("SELECT * FROM auth_sessions").all())).not.toContain(mobile.token);
  });

  it("rejects malformed, wrong-user, expired, revoked, and deleted-user sessions", async () => {
    const user = await createLocalUser({
      username: "mobile-member",
      password: "MemberPassword123!",
      role: "user"
    });
    const other = await createLocalUser({
      username: "other-member",
      password: "OtherPassword123!",
      role: "user"
    });
    const malformed = await new SignJWT({ sid: "session", uid: user.id, tokenUse: "mobile_session" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("eidon")
      .setAudience("eidon-mobile-api")
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(process.env.EIDON_SESSION_SECRET!));

    await expect(verifyMobileSessionToken("not-a-token")).resolves.toBeNull();
    await expect(verifyMobileSessionToken(malformed)).resolves.toBeNull();

    const wrongUser = await createMobileSession(user.id, "Wrong user fixture");
    getDb().prepare("UPDATE auth_sessions SET user_id = ? WHERE id = ?").run(other.id, wrongUser.sessionId);
    await expect(verifyMobileSessionToken(wrongUser.token)).resolves.toBeNull();

    const expired = await createMobileSession(user.id, "Expired device");
    getDb().prepare("UPDATE auth_sessions SET expires_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", expired.sessionId);
    await expect(verifyMobileSessionToken(expired.token)).resolves.toBeNull();
    expect(getDb().prepare("SELECT id FROM auth_sessions WHERE id = ?").get(expired.sessionId)).toBeUndefined();

    const revoked = await createMobileSession(user.id, "Revoked device");
    await invalidateMobileSessionsForUser(user.id);
    await expect(verifyMobileSessionToken(revoked.token)).resolves.toBeNull();

    const deleted = await createMobileSession(other.id, "Deleted user device");
    expect(deleteManagedUser(other.id)).toBe(true);
    await expect(verifyMobileSessionToken(deleted.token)).resolves.toBeNull();
  });

  it("strictly validates mobile token structure, signature, header, and claims", async () => {
    const user = await createLocalUser({
      username: "strict-token-member",
      password: "StrictTokenPassword123!",
      role: "user"
    });
    const mobile = await createMobileSession(user.id, "Strict token fixture");
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sid: mobile.sessionId,
      uid: user.id,
      tokenUse: "mobile_session"
    };

    const noExpiration = await signMobileClaims(claims);
    const wrongIssuer = await signMobileClaims(claims, {
      issuer: "other-issuer",
      expiration: now + 60
    });
    const multipleAudiences = await signMobileClaims(claims, {
      audience: ["eidon-mobile-api", "other-audience"],
      expiration: now + 60
    });
    const futureNotBefore = await signMobileClaims(claims, {
      expiration: now + 120,
      notBefore: now + 60
    });
    const [header, payload, signature] = mobile.token.split(".");

    await expect(verifyMobileSessionToken(noExpiration)).resolves.toBeNull();
    await expect(verifyMobileSessionToken(wrongIssuer)).resolves.toBeNull();
    await expect(verifyMobileSessionToken(multipleAudiences)).resolves.toBeNull();
    await expect(verifyMobileSessionToken(futureNotBefore)).resolves.toBeNull();
    await expect(verifyMobileSessionToken(`${header}.${payload}.${signature}=`)).resolves.toBeNull();
    await expect(verifyMobileSessionToken(`${mobile.token}${"x".repeat(8192)}`)).resolves.toBeNull();
  });

  it("validates device names, bearer syntax, and current database roles", async () => {
    const user = await createLocalUser({
      username: "role-member",
      password: "RolePassword123!",
      role: "user"
    });

    await expect(createMobileSession(user.id, " ")).rejects.toThrow("Invalid mobile device name");
    await expect(createMobileSession(user.id, "x".repeat(81))).rejects.toThrow("Invalid mobile device name");

    const mobile = await createMobileSession(user.id, "iPhone");
    expect(extractMobileBearerToken(bearerRequest("http://localhost", mobile.token))).toBe(mobile.token);
    expect(extractMobileBearerToken(new Request("http://localhost"))).toBeNull();
    expect(extractMobileBearerToken(new Request("http://localhost", {
      headers: { authorization: `Basic ${mobile.token}` }
    }))).toBeNull();
    expect(extractMobileBearerToken(new Request("http://localhost", {
      headers: { authorization: `Bearer ${mobile.token},extra` }
    }))).toBeNull();

    await expect(authenticateMobileRequest(bearerRequest("http://localhost", mobile.token)))
      .resolves.toMatchObject({ user: { id: user.id, role: "user" } });

    getDb().prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    await expect(runWithMobileUser(mobile.sessionId, {
      ...user,
      role: "user",
      passwordManagedBy: "local"
    }, () => getCurrentUser())).resolves.toMatchObject({ role: "admin" });
  });

  it("lists live device sessions and supports scoped and global revocation", async () => {
    const user = await createLocalUser({
      username: "session-owner",
      password: "SessionPassword123!",
      role: "user"
    });
    const browser = await createSession(user.id);
    const first = await createMobileSession(user.id, "Phone");
    const second = await createMobileSession(user.id, "Tablet");
    getDb().prepare("UPDATE auth_sessions SET expires_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", first.sessionId);

    expect(listMobileSessionsForUser(user.id)).toEqual([
      expect.objectContaining({ id: second.sessionId, deviceName: "Tablet" })
    ]);

    await invalidateMobileSessionsForUser(user.id);
    await expect(verifyMobileSessionToken(second.token)).resolves.toBeNull();
    await expect(verifySessionToken(browser.token)).resolves.not.toBeNull();

    await invalidateAllSessionsForUser(user.id);
    await expect(verifySessionToken(browser.token)).resolves.toBeNull();
  });

  it("revokes browser and mobile sessions when a password changes", async () => {
    const user = await createLocalUser({
      username: "password-session-owner",
      password: "OriginalPassword123!",
      role: "user"
    });
    const browser = await createSession(user.id);
    const mobile = await createMobileSession(user.id, "Password change device");

    await updatePassword(user.id, "UpdatedPassword123!");

    await expect(verifySessionToken(browser.token)).resolves.toBeNull();
    await expect(verifyMobileSessionToken(mobile.token)).resolves.toBeNull();
  });

  it("logs in, resolves the session, lists devices, revokes an owned device, and logs out", async () => {
    const loginResponse = await loginMobile(new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
      body: JSON.stringify({
        username: "admin",
        password: "changeme123",
        deviceName: "Integration iPhone"
      })
    }));
    expect(loginResponse.status).toBe(201);
    expect(loginResponse.headers.get("cache-control")).toBe("no-store");
    assertOpenApiResponse(
      "/auth/login",
      "post",
      loginResponse.status,
      await loginResponse.clone().json()
    );
    const loginBody = await readJson(loginResponse) as {
      data: { accessToken: string; tokenType: string; expiresAt: string; user: { username: string } };
    };
    expect(loginBody.data).toMatchObject({
      tokenType: "Bearer",
      user: { username: "admin" }
    });
    expect(new Date(loginBody.data.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const sessionResponse = await getMobileSession(
      bearerRequest("http://localhost/api/v1/auth/session", loginBody.data.accessToken)
    );
    expect(sessionResponse.status).toBe(200);
    assertOpenApiResponse(
      "/auth/session",
      "get",
      sessionResponse.status,
      await sessionResponse.clone().json()
    );
    const sessionBody = await readJson(sessionResponse) as { data: { sessionId: string } };

    const listResponse = await listMobileSessions(
      bearerRequest("http://localhost/api/v1/auth/sessions", loginBody.data.accessToken)
    );
    assertOpenApiResponse(
      "/auth/sessions",
      "get",
      listResponse.status,
      await listResponse.clone().json()
    );
    await expect(listResponse.json()).resolves.toEqual({
      data: {
        sessions: [expect.objectContaining({
          id: sessionBody.data.sessionId,
          deviceName: "Integration iPhone",
          current: true
        })]
      }
    });

    const missingRevocation = await revokeMobileSession(
      bearerRequest("http://localhost/api/v1/auth/sessions/missing", loginBody.data.accessToken, "DELETE"),
      { params: Promise.resolve({ sessionId: "missing" }) }
    );
    expect(missingRevocation.status).toBe(404);
    assertOpenApiResponse(
      "/auth/sessions/{sessionId}",
      "delete",
      missingRevocation.status,
      await missingRevocation.clone().json()
    );

    const revokeResponse = await revokeMobileSession(
      bearerRequest("http://localhost/api/v1/auth/sessions/current", loginBody.data.accessToken, "DELETE"),
      { params: Promise.resolve({ sessionId: sessionBody.data.sessionId }) }
    );
    assertOpenApiResponse(
      "/auth/sessions/{sessionId}",
      "delete",
      revokeResponse.status,
      await revokeResponse.clone().json()
    );
    await expect(revokeResponse.json()).resolves.toEqual({
      data: { success: true, currentSessionRevoked: true }
    });
    expect((await getMobileSession(
      bearerRequest("http://localhost/api/v1/auth/session", loginBody.data.accessToken)
    )).status).toBe(401);

    const secondLogin = await loginMobile(new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
      body: JSON.stringify({ username: "admin", password: "changeme123", deviceName: "Second" })
    }));
    const secondBody = await readJson(secondLogin) as { data: { accessToken: string } };
    const logoutResponse = await logoutMobile(
      bearerRequest("http://localhost/api/v1/auth/logout", secondBody.data.accessToken, "POST")
    );
    assertOpenApiResponse(
      "/auth/logout",
      "post",
      logoutResponse.status,
      await logoutResponse.clone().json()
    );
    await expect(logoutResponse.json()).resolves.toEqual({ data: { success: true } });
    expect((await logoutMobile(
      bearerRequest("http://localhost/api/v1/auth/logout", secondBody.data.accessToken, "POST")
    )).status).toBe(401);
  });

  it("uses generic invalid credentials and bounded throttling", async () => {
    await ensureAdminBootstrap();
    const request = (username: string, password: string) => new Request(
      "http://localhost/api/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "198.51.100.10" },
        body: JSON.stringify({ username, password, deviceName: "Test device" })
      }
    );

    const existing = await loginMobile(request("admin", "wrong-password"));
    const missing = await loginMobile(request("does-not-exist", "wrong-password"));
    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    assertOpenApiResponse(
      "/auth/login",
      "post",
      existing.status,
      await existing.clone().json()
    );
    assertOpenApiResponse(
      "/auth/login",
      "post",
      missing.status,
      await missing.clone().json()
    );
    await expect(existing.json()).resolves.toEqual({
      error: { code: "invalid_credentials", message: "Invalid username or password" }
    });
    await expect(missing.json()).resolves.toEqual({
      error: { code: "invalid_credentials", message: "Invalid username or password" }
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await loginMobile(request("admin", "wrong-password"))).status).toBe(401);
    }
    const limited = await loginMobile(request("admin", "wrong-password"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("900");
  });

  it("rejects disabled login, invalid payloads, missing bearers, and production HTTP", async () => {
    const invalid = await loginMobile(new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "", password: "", deviceName: "" })
    }));
    expect(invalid.status).toBe(400);

    process.env.EIDON_PASSWORD_LOGIN_ENABLED = "false";
    expect((await loginMobile(new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "changeme123", deviceName: "Phone" })
    }))).status).toBe(403);

    process.env.EIDON_PASSWORD_LOGIN_ENABLED = "true";
    expect((await getMobileSession(new Request("http://localhost/api/v1/auth/session"))).status).toBe(401);

    mutableEnv.NODE_ENV = "production";
    expect((await loginMobile(new Request("http://eidon.example/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "changeme123", deviceName: "Phone" })
    }))).status).toBe(400);
  });
});
