import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as startMobileGithubOauth } from "@/app/api/v1/providers/github/connect/route";
import {
  DELETE as cancelMobileGithubOauth,
  GET as getMobileGithubOauth
} from "@/app/api/v1/providers/github/connect/[flowId]/route";
import { createMobileSession } from "@/lib/auth";
import { decryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import {
  cancelMobileGithubOauthFlow,
  createMobileGithubOauthFlow,
  getMobileGithubOauthFlowForUser,
  handleMobileGithubOauthCallback
} from "@/lib/mobile-github-oauth";
import {
  claimGithubCopilotConnectionAttempt,
  getProviderProfile,
  updateSettings
} from "@/lib/settings";
import { createLocalUser, ensureEnvSuperAdminUser } from "@/lib/users";
import { assertOpenApiResponse } from "@/tests/fixtures/mobile-contract-validator";

const githubEnvNames = [
  "EIDON_GITHUB_APP_CLIENT_ID",
  "EIDON_GITHUB_APP_CLIENT_SECRET",
  "EIDON_GITHUB_APP_CALLBACK_URL"
] as const;
const originalGithubEnv = Object.fromEntries(
  githubEnvNames.map((name) => [name, process.env[name]])
);

function buildProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "profile_copilot",
    name: overrides.name ?? "Copilot",
    providerKind: overrides.providerKind ?? "github_copilot",
    apiBaseUrl: overrides.apiBaseUrl ?? "",
    apiKey: "",
    model: "gpt-4.1",
    apiMode: "responses" as const,
    systemPrompt: "Be exact.",
    temperature: 0.4,
    maxOutputTokens: 512,
    reasoningEffort: "medium" as const,
    reasoningSummaryEnabled: true,
    modelContextLimit: 16384,
    compactionThreshold: 0.8,
    freshTailCount: 12,
    ...overrides
  };
}

function seedCopilotProfile() {
  updateSettings({
    defaultProviderProfileId: "profile_copilot",
    skillsEnabled: true,
    providerProfiles: [buildProfile()]
  });
}

function getState(authorizationUrl: string) {
  return new URL(authorizationUrl).searchParams.get("state")!;
}

function callbackRequest(state: string, params = "code=oauth-code") {
  return new Request(
    `https://eidon.example/api/providers/github/callback?${params}&state=${encodeURIComponent(state)}`
  );
}

describe("mobile GitHub OAuth", () => {
  beforeEach(() => {
    process.env.EIDON_GITHUB_APP_CLIENT_ID = "github-client";
    process.env.EIDON_GITHUB_APP_CLIENT_SECRET = "github-secret";
    process.env.EIDON_GITHUB_APP_CALLBACK_URL =
      "https://eidon.example/api/providers/github/callback";
    seedCopilotProfile();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "ghu_mobile_access",
      refresh_token: "ghr_mobile_refresh",
      expires_in: 3600,
      refresh_token_expires_in: 7200
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));
  });

  afterEach(() => {
    for (const name of githubEnvNames) {
      const value = originalGithubEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a short-lived flow, stores tokens only on the server, and redirects with sanitized status", async () => {
    const admin = await ensureEnvSuperAdminUser();
    const flow = await createMobileGithubOauthFlow({
      ...admin,
      passwordManagedBy: "env"
    }, "profile_copilot");
    const state = getState(flow.authorizationUrl);

    expect(flow.flowId).toMatch(/^mobile_github_oauth_/);
    expect(new Date(flow.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(getMobileGithubOauthFlowForUser(flow.flowId, admin.id)).toMatchObject({
      id: flow.flowId,
      status: "pending",
      profileId: "profile_copilot"
    });

    const response = await handleMobileGithubOauthCallback(callbackRequest(state));
    expect(response?.status).toBe(303);
    const location = new URL(response!.headers.get("location")!);
    expect(location.protocol).toBe("eidon:");
    expect(location.host).toBe("oauth");
    expect(location.pathname).toBe("/github");
    expect(Object.fromEntries(location.searchParams)).toEqual({
      flowId: flow.flowId,
      status: "success"
    });
    expect(location.toString()).not.toContain("ghu_mobile_access");
    expect(location.toString()).not.toContain("ghr_mobile_refresh");

    const profile = getProviderProfile("profile_copilot")!;
    expect(decryptValue(profile.githubUserAccessTokenEncrypted)).toBe("ghu_mobile_access");
    expect(decryptValue(profile.githubRefreshTokenEncrypted)).toBe("ghr_mobile_refresh");
    expect(getMobileGithubOauthFlowForUser(flow.flowId, admin.id)?.status).toBe("succeeded");

    const replay = await handleMobileGithubOauthCallback(callbackRequest(state));
    expect(new URL(replay!.headers.get("location")!).searchParams.get("status")).toBe("failure");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("rejects stale provider intent before exchanging a code", async () => {
    const admin = await ensureEnvSuperAdminUser();
    const flow = await createMobileGithubOauthFlow({ ...admin, passwordManagedBy: "env" }, "profile_copilot");
    claimGithubCopilotConnectionAttempt("profile_copilot");

    const response = await handleMobileGithubOauthCallback(callbackRequest(getState(flow.authorizationUrl)));
    expect(new URL(response!.headers.get("location")!).searchParams.get("status")).toBe("failure");
    expect(fetch).not.toHaveBeenCalled();
    expect(getProviderProfile("profile_copilot")!.githubUserAccessTokenEncrypted).toBe("");
  });

  it("rejects expired, canceled, wrong-role, and cross-user flows before token exchange", async () => {
    const localAdmin = await createLocalUser({
      username: "oauth-admin",
      password: "OauthAdminPassword123!",
      role: "admin"
    });
    const other = await createLocalUser({
      username: "oauth-other",
      password: "OauthOtherPassword123!",
      role: "user"
    });

    const expired = await createMobileGithubOauthFlow({
      ...localAdmin,
      passwordManagedBy: "local"
    }, "profile_copilot");
    getDb().prepare("UPDATE mobile_github_oauth_flows SET expires_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", expired.flowId);
    expect(new URL((await handleMobileGithubOauthCallback(
      callbackRequest(getState(expired.authorizationUrl))
    ))!.headers.get("location")!).searchParams.get("status")).toBe("failure");

    const canceled = await createMobileGithubOauthFlow({
      ...localAdmin,
      passwordManagedBy: "local"
    }, "profile_copilot");
    expect(getMobileGithubOauthFlowForUser(canceled.flowId, other.id)).toBeNull();
    expect(cancelMobileGithubOauthFlow(canceled.flowId, other.id)).toBe(false);
    expect(cancelMobileGithubOauthFlow(canceled.flowId, localAdmin.id)).toBe(true);
    expect(cancelMobileGithubOauthFlow(canceled.flowId, localAdmin.id)).toBe(false);
    expect(new URL((await handleMobileGithubOauthCallback(
      callbackRequest(getState(canceled.authorizationUrl))
    ))!.headers.get("location")!).searchParams.get("status")).toBe("failure");

    const wrongRole = await createMobileGithubOauthFlow({
      ...localAdmin,
      passwordManagedBy: "local"
    }, "profile_copilot");
    getDb().prepare("UPDATE users SET role = 'user' WHERE id = ?").run(localAdmin.id);
    expect(new URL((await handleMobileGithubOauthCallback(
      callbackRequest(getState(wrongRole.authorizationUrl))
    ))!.headers.get("location")!).searchParams.get("status")).toBe("failure");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles denial, malformed mobile state, and provider errors without leaking details", async () => {
    const admin = await ensureEnvSuperAdminUser();
    const denied = await createMobileGithubOauthFlow({ ...admin, passwordManagedBy: "env" }, "profile_copilot");
    const deniedResponse = await handleMobileGithubOauthCallback(
      callbackRequest(getState(denied.authorizationUrl), "error=access_denied")
    );
    expect(new URL(deniedResponse!.headers.get("location")!).searchParams.get("status")).toBe("failure");
    expect(getMobileGithubOauthFlowForUser(denied.flowId, admin.id)?.status).toBe("canceled");

    const malformedState = await new SignJWT({ tokenUse: "github_mobile_oauth_state" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("eidon")
      .setAudience("eidon-github-mobile-oauth")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(process.env.EIDON_SESSION_SECRET!));
    const malformed = await handleMobileGithubOauthCallback(callbackRequest(malformedState));
    expect(malformed?.status).toBe(400);
    expect(malformed?.headers.get("cache-control")).toBe("no-store");

    const failed = await createMobileGithubOauthFlow({ ...admin, passwordManagedBy: "env" }, "profile_copilot");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: "internal-provider-detail",
      error_description: "token exchange included a secret"
    }), {
      status: 400,
      headers: { "content-type": "application/json" }
    }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failedResponse = await handleMobileGithubOauthCallback(
      callbackRequest(getState(failed.authorizationUrl))
    );
    const failedLocation = failedResponse!.headers.get("location")!;
    expect(new URL(failedLocation).searchParams.get("status")).toBe("failure");
    expect(failedLocation).not.toContain("internal-provider-detail");
    expect(failedLocation).not.toContain("secret");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("internal-provider-detail");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("token exchange included a secret");
  });

  it("rejects non-admins, unsupported profiles, and missing OAuth configuration", async () => {
    const member = await createLocalUser({
      username: "oauth-member",
      password: "OauthMemberPassword123!",
      role: "user"
    });
    await expect(createMobileGithubOauthFlow({
      ...member,
      passwordManagedBy: "local"
    }, "profile_copilot")).rejects.toThrow("Only administrators");

    const admin = await ensureEnvSuperAdminUser();
    await expect(createMobileGithubOauthFlow({
      ...admin,
      passwordManagedBy: "env"
    }, "missing")).rejects.toThrow("not found");

    delete process.env.EIDON_GITHUB_APP_CLIENT_SECRET;
    await expect(createMobileGithubOauthFlow({
      ...admin,
      passwordManagedBy: "env"
    }, "profile_copilot")).rejects.toThrow("not configured");

    expect(await handleMobileGithubOauthCallback(new Request(
      "https://eidon.example/api/providers/github/callback?state=ordinary-browser-state"
    ))).toBeNull();
  });

  it("enforces administrator and flow-owner authorization on native OAuth routes", async () => {
    const member = await createLocalUser({
      username: "oauth-route-member",
      password: "OauthRouteMember123!",
      role: "user"
    });
    const localAdmin = await createLocalUser({
      username: "oauth-route-admin",
      password: "OauthRouteAdmin123!",
      role: "admin"
    });
    const otherAdmin = await createLocalUser({
      username: "oauth-route-other-admin",
      password: "OauthRouteOtherAdmin123!",
      role: "admin"
    });
    const memberSession = await createMobileSession(member.id, "Member OAuth device");
    const adminSession = await createMobileSession(localAdmin.id, "Admin OAuth device");
    const otherAdminSession = await createMobileSession(otherAdmin.id, "Other admin device");
    const request = (token: string, method = "GET") => new Request(
      "https://eidon.example/api/v1/providers/github/connect",
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(method === "POST" ? { "content-type": "application/json" } : {})
        },
        ...(method === "POST" ? {
          body: JSON.stringify({ providerProfileId: "profile_copilot" })
        } : {})
      }
    );

    expect((await startMobileGithubOauth(request(memberSession.token, "POST"))).status).toBe(403);
    const started = await startMobileGithubOauth(request(adminSession.token, "POST"));
    expect(started.status).toBe(201);
    assertOpenApiResponse(
      "/providers/github/connect",
      "post",
      started.status,
      await started.clone().json()
    );
    const startedBody = await started.json() as { data: { flowId: string } };

    expect((await getMobileGithubOauth(
      request(memberSession.token),
      { params: Promise.resolve({ flowId: startedBody.data.flowId }) }
    )).status).toBe(403);
    expect((await getMobileGithubOauth(
      request(otherAdminSession.token),
      { params: Promise.resolve({ flowId: startedBody.data.flowId }) }
    )).status).toBe(404);

    const ownerStatus = await getMobileGithubOauth(
      request(adminSession.token),
      { params: Promise.resolve({ flowId: startedBody.data.flowId }) }
    );
    expect(ownerStatus.status).toBe(200);
    assertOpenApiResponse(
      "/providers/github/connect/{flowId}",
      "get",
      ownerStatus.status,
      await ownerStatus.clone().json()
    );
    expect(JSON.stringify(await ownerStatus.json())).not.toMatch(/token|nonce/i);

    getDb().prepare("UPDATE users SET role = 'user' WHERE id = ?").run(localAdmin.id);
    expect((await getMobileGithubOauth(
      request(adminSession.token),
      { params: Promise.resolve({ flowId: startedBody.data.flowId }) }
    )).status).toBe(403);
    expect((await cancelMobileGithubOauth(
      request(adminSession.token, "DELETE"),
      { params: Promise.resolve({ flowId: startedBody.data.flowId }) }
    )).status).toBe(403);
    getDb().prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(localAdmin.id);

    const canceled = await cancelMobileGithubOauth(
      request(adminSession.token, "DELETE"),
      { params: Promise.resolve({ flowId: startedBody.data.flowId }) }
    );
    expect(canceled.status).toBe(200);
    assertOpenApiResponse(
      "/providers/github/connect/{flowId}",
      "delete",
      canceled.status,
      await canceled.clone().json()
    );
    expect((await cancelMobileGithubOauth(
      request(adminSession.token, "DELETE"),
      { params: Promise.resolve({ flowId: startedBody.data.flowId }) }
    )).status).toBe(409);
  });
});
