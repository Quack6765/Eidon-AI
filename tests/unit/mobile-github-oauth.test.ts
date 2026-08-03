import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as deleteMobileRoute,
  GET as getMobileRoute,
  POST as postMobileRoute
} from "@/app/api/v1/[...path]/route";
import { createMobileSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  cancelGithubProviderConnectionFlow,
  createGithubProviderConnectionFlow,
  getGithubProviderConnectionFlow,
  handleGithubProviderConnectionCallback
} from "@/lib/provider-adapters/github-provider-connection";
import {
  claimProviderConnectionAttempt,
  getRuntimeProviderProfile
} from "@/lib/provider-profiles";
import { updateProviderCatalog } from "@/lib/settings";
import { createLocalUser, ensureEnvSuperAdminUser } from "@/lib/users";
import { assertOpenApiResponse } from "@/tests/fixtures/mobile-contract-validator";
import { createProviderCatalogInput, createProviderProfileInput } from "@/tests/provider-fixtures";

const githubEnvNames = [
  "EIDON_GITHUB_APP_CLIENT_ID",
  "EIDON_GITHUB_APP_CLIENT_SECRET",
  "EIDON_GITHUB_APP_CALLBACK_URL"
] as const;
const originalGithubEnv = Object.fromEntries(
  githubEnvNames.map((name) => [name, process.env[name]])
);

function seedCopilotProfile() {
  const profile = createProviderProfileInput({
    id: "profile_copilot",
    name: "Copilot",
    providerKind: "github_copilot",
    providerConfig: {},
    model: "gpt-4.1",
    credentials: {}
  });
  updateProviderCatalog(createProviderCatalogInput([profile]));
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
    const flow = await createGithubProviderConnectionFlow({
      ...admin,
      passwordManagedBy: "env"
    }, "profile_copilot");
    const state = getState(flow.authorizationUrl);

    expect(flow.flowId).toMatch(/^provider_connection_flow_/);
    expect(new Date(flow.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(getGithubProviderConnectionFlow(flow.flowId, admin.id)).toMatchObject({
      id: flow.flowId,
      status: "pending",
      profileId: "profile_copilot"
    });

    const response = await handleGithubProviderConnectionCallback(callbackRequest(state));
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

    const profile = getRuntimeProviderProfile("profile_copilot")!;
    expect(profile.credentials.accessToken).toBe("ghu_mobile_access");
    expect(profile.credentials.refreshToken).toBe("ghr_mobile_refresh");
    expect(getGithubProviderConnectionFlow(flow.flowId, admin.id)?.status).toBe("succeeded");

    const replay = await handleGithubProviderConnectionCallback(callbackRequest(state));
    expect(new URL(replay!.headers.get("location")!).searchParams.get("status")).toBe("failure");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("rejects stale provider intent before exchanging a code", async () => {
    const admin = await ensureEnvSuperAdminUser();
    const flow = await createGithubProviderConnectionFlow({ ...admin, passwordManagedBy: "env" }, "profile_copilot");
    claimProviderConnectionAttempt("profile_copilot");

    const response = await handleGithubProviderConnectionCallback(callbackRequest(getState(flow.authorizationUrl)));
    expect(new URL(response!.headers.get("location")!).searchParams.get("status")).toBe("failure");
    expect(fetch).not.toHaveBeenCalled();
    expect(getRuntimeProviderProfile("profile_copilot")!.credentials).toEqual({});
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

    const expired = await createGithubProviderConnectionFlow({
      ...localAdmin,
      passwordManagedBy: "local"
    }, "profile_copilot");
    getDb().prepare("UPDATE provider_connection_flows SET expires_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", expired.flowId);
    expect(new URL((await handleGithubProviderConnectionCallback(
      callbackRequest(getState(expired.authorizationUrl))
    ))!.headers.get("location")!).searchParams.get("status")).toBe("failure");

    const canceled = await createGithubProviderConnectionFlow({
      ...localAdmin,
      passwordManagedBy: "local"
    }, "profile_copilot");
    expect(getGithubProviderConnectionFlow(canceled.flowId, other.id)).toBeNull();
    expect(cancelGithubProviderConnectionFlow(canceled.flowId, other.id)).toBe(false);
    expect(cancelGithubProviderConnectionFlow(canceled.flowId, localAdmin.id)).toBe(true);
    expect(cancelGithubProviderConnectionFlow(canceled.flowId, localAdmin.id)).toBe(false);
    expect(new URL((await handleGithubProviderConnectionCallback(
      callbackRequest(getState(canceled.authorizationUrl))
    ))!.headers.get("location")!).searchParams.get("status")).toBe("failure");

    const wrongRole = await createGithubProviderConnectionFlow({
      ...localAdmin,
      passwordManagedBy: "local"
    }, "profile_copilot");
    getDb().prepare("UPDATE users SET role = 'user' WHERE id = ?").run(localAdmin.id);
    expect(new URL((await handleGithubProviderConnectionCallback(
      callbackRequest(getState(wrongRole.authorizationUrl))
    ))!.headers.get("location")!).searchParams.get("status")).toBe("failure");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles denial, malformed mobile state, and provider errors without leaking details", async () => {
    const admin = await ensureEnvSuperAdminUser();
    const denied = await createGithubProviderConnectionFlow({ ...admin, passwordManagedBy: "env" }, "profile_copilot");
    const deniedResponse = await handleGithubProviderConnectionCallback(
      callbackRequest(getState(denied.authorizationUrl), "error=access_denied")
    );
    expect(new URL(deniedResponse!.headers.get("location")!).searchParams.get("status")).toBe("failure");
    expect(getGithubProviderConnectionFlow(denied.flowId, admin.id)?.status).toBe("canceled");

    const malformedState = await new SignJWT({ tokenUse: "github_mobile_oauth_state" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("eidon")
      .setAudience("eidon-github-mobile-oauth")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(process.env.EIDON_SESSION_SECRET!));
    const malformed = await handleGithubProviderConnectionCallback(callbackRequest(malformedState));
    expect(malformed?.status).toBe(400);
    expect(malformed?.headers.get("cache-control")).toBe("no-store");

    const failed = await createGithubProviderConnectionFlow({ ...admin, passwordManagedBy: "env" }, "profile_copilot");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: "internal-provider-detail",
      error_description: "token exchange included a secret"
    }), {
      status: 400,
      headers: { "content-type": "application/json" }
    }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failedResponse = await handleGithubProviderConnectionCallback(
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
    await expect(createGithubProviderConnectionFlow({
      ...member,
      passwordManagedBy: "local"
    }, "profile_copilot")).rejects.toThrow("Only administrators");

    const admin = await ensureEnvSuperAdminUser();
    await expect(createGithubProviderConnectionFlow({
      ...admin,
      passwordManagedBy: "env"
    }, "missing")).rejects.toThrow("not found");

    delete process.env.EIDON_GITHUB_APP_CLIENT_SECRET;
    await expect(createGithubProviderConnectionFlow({
      ...admin,
      passwordManagedBy: "env"
    }, "profile_copilot")).rejects.toThrow("not configured");

    expect((await handleGithubProviderConnectionCallback(new Request(
      "https://eidon.example/api/providers/github/callback?state=ordinary-browser-state"
    )))?.status).toBe(400);
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
      "https://eidon.example/api/v1/providers/profile_copilot/connection/flows",
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(method === "POST" ? { "content-type": "application/json" } : {})
        },
        ...(method === "POST" ? { body: JSON.stringify({}) } : {})
      }
    );
    const startContext = {
      params: Promise.resolve({
        path: ["providers", "profile_copilot", "connection", "flows"]
      })
    };

    expect((await postMobileRoute(request(memberSession.token, "POST"), startContext)).status).toBe(403);
    const started = await postMobileRoute(request(adminSession.token, "POST"), startContext);
    expect(started.status).toBe(201);
    assertOpenApiResponse(
      "/providers/{profileId}/connection/flows",
      "post",
      started.status,
      await started.clone().json()
    );
    const startedBody = await started.json() as { data: { flowId: string } };

    const flowContext = {
      params: Promise.resolve({
        path: ["providers", "profile_copilot", "connection", "flows", startedBody.data.flowId]
      })
    };
    expect((await getMobileRoute(
      request(memberSession.token),
      flowContext
    )).status).toBe(403);
    expect((await getMobileRoute(
      request(otherAdminSession.token),
      flowContext
    )).status).toBe(404);

    const ownerStatus = await getMobileRoute(
      request(adminSession.token),
      flowContext
    );
    expect(ownerStatus.status).toBe(200);
    assertOpenApiResponse(
      "/providers/{profileId}/connection/flows/{flowId}",
      "get",
      ownerStatus.status,
      await ownerStatus.clone().json()
    );
    expect(JSON.stringify(await ownerStatus.json())).not.toMatch(/token|nonce/i);

    getDb().prepare("UPDATE users SET role = 'user' WHERE id = ?").run(localAdmin.id);
    expect((await getMobileRoute(
      request(adminSession.token),
      flowContext
    )).status).toBe(403);
    expect((await deleteMobileRoute(
      request(adminSession.token, "DELETE"),
      flowContext
    )).status).toBe(403);
    getDb().prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(localAdmin.id);

    const canceled = await deleteMobileRoute(
      request(adminSession.token, "DELETE"),
      flowContext
    );
    expect(canceled.status).toBe(200);
    assertOpenApiResponse(
      "/providers/{profileId}/connection/flows/{flowId}",
      "delete",
      canceled.status,
      await canceled.clone().json()
    );
    expect((await deleteMobileRoute(
      request(adminSession.token, "DELETE"),
      flowContext
    )).status).toBe(409);
  });
});
