import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

import { getDb, resetDbForTests } from "@/lib/db";
import { createGithubOauthState, verifyGithubOauthState } from "@/lib/github-copilot";
import {
  claimProviderConnectionAttempt,
  getProviderProfile,
  getRuntimeProviderProfile,
  updateProviderConnection
} from "@/lib/provider-profiles";
import { getSanitizedSettings, updateSettings } from "@/lib/settings";
import {
  createProviderCatalogInput,
  createProviderProfileInput
} from "@/tests/provider-fixtures";

const { requireAdminResponseMock } = vi.hoisted(() => ({
  requireAdminResponseMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireAdminResponse: requireAdminResponseMock
}));

function buildAdminUser() {
  return {
    id: "user_admin",
    username: "admin",
    role: "admin" as const,
    authSource: "env_super_admin" as const,
    passwordManagedBy: "env" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  })
}));

function seedCopilotProfile(overrides: Parameters<typeof createProviderProfileInput>[0] = {}) {
  const id = overrides.id ?? "profile_copilot";
  const profile = createProviderProfileInput({
    id,
    name: "Copilot",
    providerKind: "github_copilot",
    providerConfig: {},
    credentials: {},
    ...overrides
  });
  updateSettings(createProviderCatalogInput([profile], { defaultProviderProfileId: id }));

  return id;
}

describe("github copilot routes", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(redirect).mockClear();
    requireAdminResponseMock.mockReset();
    requireAdminResponseMock.mockResolvedValue(buildAdminUser());
  });

  it("rejects connect requests for non-copilot profiles", async () => {
    const { GET: connect } = await import("@/app/api/providers/github/connect/route");
    seedCopilotProfile();

    const response = await connect(
      new Request(
        `http://localhost/api/providers/github/connect?providerProfileId=missing`
      )
    );

    expect(response.status).toBe(400);
  });

  it("rejects callback requests with an invalid state token", async () => {
    const { GET: callback } = await import("@/app/api/providers/github/callback/route");
    const response = await callback(
      new Request(
        "http://localhost/api/providers/github/callback?code=test-code&state=invalid-state"
      )
    );

    expect(response.status).toBe(400);
  });

  it("rejects a callback when the profile changes kind during token exchange", async () => {
    const admin = buildAdminUser();
    const id = seedCopilotProfile();
    const profileNonce = claimProviderConnectionAttempt(id)!;
    const state = await createGithubOauthState(id, admin.id, profileNonce);
    vi.stubGlobal("fetch", vi.fn(async () => {
      updateSettings(createProviderCatalogInput([createProviderProfileInput({
          id,
          name: "Changed provider",
          providerKind: "openai_compatible",
          providerConfig: {
            apiBaseUrl: "https://api.example.com/v1",
            apiMode: "responses"
          },
          credentials: {}
        })], { defaultProviderProfileId: id }));

      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "ghu_late",
          expires_in: 3600
        })
      } as Response;
    }));

    const { GET: callback } = await import("@/app/api/providers/github/callback/route");
    const response = await callback(new Request(
      `http://localhost/api/providers/github/callback?code=test-code&state=${encodeURIComponent(state)}`
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub Copilot is only available for Copilot profiles"
    });
    expect(getProviderProfile(id)).toMatchObject({ providerKind: "openai_compatible" });
    expect(getRuntimeProviderProfile(id)?.credentials).toEqual({});
    expect(getDb()
      .prepare("SELECT oauth_nonce FROM provider_profile_connections WHERE profile_id = ?")
      .get(id)).toEqual({ oauth_nonce: null });
  });

  it("persists a one-time nonce so only the newest callback can write across restarts", async () => {
    const id = seedCopilotProfile();
    const originalUpdatedAt = getProviderProfile(id)!.updatedAt;
    const { GET: connect } = await import("@/app/api/providers/github/connect/route");

    await expect(connect(new Request(
      `http://localhost/api/providers/github/connect?providerProfileId=${id}`
    ))).rejects.toThrow("NEXT_REDIRECT");
    const firstRedirect = String(vi.mocked(redirect).mock.calls.at(-1)?.[0]);
    const firstState = new URL(firstRedirect).searchParams.get("state")!;
    const firstClaims = await verifyGithubOauthState(firstState);

    await expect(connect(new Request(
      `http://localhost/api/providers/github/connect?providerProfileId=${id}`
    ))).rejects.toThrow("NEXT_REDIRECT");
    const secondRedirect = String(vi.mocked(redirect).mock.calls.at(-1)?.[0]);
    const secondState = new URL(secondRedirect).searchParams.get("state")!;
    const secondClaims = await verifyGithubOauthState(secondState);

    expect(secondClaims.profileNonce).not.toBe(firstClaims.profileNonce);

    updateSettings(createProviderCatalogInput([createProviderProfileInput({
        id,
        name: "Copilot renamed",
        providerKind: "github_copilot",
        providerConfig: {},
        credentials: {}
      })], { defaultProviderProfileId: id, skillsEnabled: false }));
    getDb()
      .prepare("UPDATE provider_profiles SET updated_at = ? WHERE id = ?")
      .run(originalUpdatedAt, id);
    expect(getDb()
      .prepare("SELECT oauth_nonce FROM provider_profile_connections WHERE profile_id = ?")
      .get(id)).toEqual({ oauth_nonce: secondClaims.profileNonce });
    expect(getProviderProfile(id)).not.toHaveProperty("oauthNonce");
    expect(getSanitizedSettings().providerProfiles[0]).not.toHaveProperty("oauthNonce");

    resetDbForTests();

    vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
      const code = JSON.parse(String(init?.body)).code as string;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: code === "new-code" ? "ghu_newest" : "ghu_stale",
          refresh_token: code === "new-code" ? "ghr_newest" : "ghr_stale",
          expires_in: 3600
        })
      } as Response;
    }));
    const { GET: callback } = await import("@/app/api/providers/github/callback/route");

    const staleResponse = await callback(new Request(
      `http://localhost/api/providers/github/callback?code=old-code&state=${encodeURIComponent(firstState)}`
    ));
    expect(staleResponse.status).toBe(400);
    await expect(staleResponse.json()).resolves.toEqual({
      error: "GitHub Copilot profile changed before the connection completed"
    });

    await expect(callback(new Request(
      `http://localhost/api/providers/github/callback?code=new-code&state=${encodeURIComponent(secondState)}`
    ))).rejects.toThrow("NEXT_REDIRECT");

    const replayResponse = await callback(new Request(
      `http://localhost/api/providers/github/callback?code=new-code&state=${encodeURIComponent(secondState)}`
    ));
    expect(replayResponse.status).toBe(400);

    const stored = getRuntimeProviderProfile(id)!;
    expect(stored.credentials.accessToken).toBe("ghu_newest");
    expect(stored.credentials.refreshToken).toBe("ghr_newest");
    expect(getDb()
      .prepare("SELECT oauth_nonce FROM provider_profile_connections WHERE profile_id = ?")
      .get(id)).toEqual({ oauth_nonce: null });
  });

  it("clears oauth credentials on disconnect", async () => {
    const { DELETE: disconnect } = await import("@/app/api/providers/[profileId]/connection/route");
    const id = seedCopilotProfile();
    updateProviderConnection(id, {
      credentials: { accessToken: "ghu_token", refreshToken: "ghr_token" },
      metadata: { expiresAt: new Date(Date.now() + 60_000).toISOString() }
    });
    claimProviderConnectionAttempt(id);
    expect(getDb()
      .prepare("SELECT oauth_nonce FROM provider_profile_connections WHERE profile_id = ?")
      .get(id)).not.toEqual({ oauth_nonce: null });

    const response = await disconnect(
      new Request(`http://localhost/api/providers/${id}/connection`, { method: "DELETE" }),
      { params: Promise.resolve({ profileId: id }) }
    );

    expect(response.status).toBe(200);

    const profile = getRuntimeProviderProfile(id);
    expect(profile?.credentials).toEqual({});
    expect(profile?.connectionMetadata).toEqual({});
    expect(getDb()
      .prepare("SELECT oauth_nonce FROM provider_profile_connections WHERE profile_id = ?")
      .get(id)).toEqual({ oauth_nonce: null });
  });

  it("rejects model discovery for disconnected profiles", async () => {
    const { GET: models } = await import("@/app/api/providers/[profileId]/models/route");
    const id = seedCopilotProfile();

    const response = await models(
      new Request(`http://localhost/api/providers/${id}/models`),
      { params: Promise.resolve({ profileId: id }) }
    );

    expect(response.status).toBe(409);
  });

  it("returns forbidden for non-admin users", async () => {
    requireAdminResponseMock.mockResolvedValueOnce(null);
    const { DELETE: disconnect } = await import("@/app/api/providers/[profileId]/connection/route");

    const response = await disconnect(
      new Request("http://localhost/api/providers/profile_copilot/connection", { method: "DELETE" }),
      { params: Promise.resolve({ profileId: "profile_copilot" }) }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });
});
