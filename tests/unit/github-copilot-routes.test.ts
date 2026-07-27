import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

import { decryptValue, encryptValue } from "@/lib/crypto";
import { getDb, resetDbForTests } from "@/lib/db";
import { createGithubOauthState, verifyGithubOauthState } from "@/lib/github-copilot";
import {
  claimGithubCopilotConnectionAttempt,
  getProviderProfile,
  getSanitizedSettings,
  updateSettings
} from "@/lib/settings";

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

function buildProfile(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: overrides.id ?? `profile_${crypto.randomUUID()}`,
    name: overrides.name ?? "Profile",
    apiBaseUrl: overrides.apiBaseUrl ?? "https://api.example.com/v1",
    apiKey: overrides.apiKey ?? "",
    model: overrides.model ?? "gpt-test",
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

function seedCopilotProfile(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string) ?? "profile_copilot";

  updateSettings({
    defaultProviderProfileId: id,
    skillsEnabled: true,
    providerProfiles: [
      buildProfile({
        id,
        name: "Copilot",
        providerKind: "github_copilot",
        apiBaseUrl: "",
        apiKey: "",
        ...overrides
      })
    ]
  });

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
    const profileNonce = claimGithubCopilotConnectionAttempt(id)!;
    const state = await createGithubOauthState(id, admin.id, profileNonce);
    vi.stubGlobal("fetch", vi.fn(async () => {
      updateSettings({
        defaultProviderProfileId: id,
        skillsEnabled: true,
        providerProfiles: [buildProfile({
          id,
          name: "Changed provider",
          providerKind: "openai_compatible",
          apiKeyAction: "clear"
        })]
      });

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
    expect(getProviderProfile(id)).toMatchObject({
      providerKind: "openai_compatible",
      githubUserAccessTokenEncrypted: "",
      githubRefreshTokenEncrypted: ""
    });
    expect(getDb()
      .prepare("SELECT github_oauth_nonce FROM provider_profiles WHERE id = ?")
      .get(id)).toEqual({ github_oauth_nonce: null });
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

    updateSettings({
      defaultProviderProfileId: id,
      skillsEnabled: false,
      providerProfiles: [buildProfile({
        id,
        name: "Copilot renamed",
        providerKind: "github_copilot",
        apiBaseUrl: "",
        apiKey: ""
      })]
    });
    getDb()
      .prepare("UPDATE provider_profiles SET updated_at = ? WHERE id = ?")
      .run(originalUpdatedAt, id);
    expect(getDb()
      .prepare("SELECT github_oauth_nonce FROM provider_profiles WHERE id = ?")
      .get(id)).toEqual({ github_oauth_nonce: secondClaims.profileNonce });
    expect(getProviderProfile(id)).not.toHaveProperty("githubOauthNonce");
    expect(getSanitizedSettings().providerProfiles[0]).not.toHaveProperty("githubOauthNonce");

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

    const stored = getProviderProfile(id)!;
    expect(decryptValue(stored.githubUserAccessTokenEncrypted)).toBe("ghu_newest");
    expect(decryptValue(stored.githubRefreshTokenEncrypted)).toBe("ghr_newest");
    expect(getDb()
      .prepare("SELECT github_oauth_nonce FROM provider_profiles WHERE id = ?")
      .get(id)).toEqual({ github_oauth_nonce: null });
  });

  it("clears oauth credentials on disconnect", async () => {
    const { POST: disconnect } = await import("@/app/api/providers/github/disconnect/route");
    const id = seedCopilotProfile({
      githubUserAccessTokenEncrypted: encryptValue("ghu_token"),
      githubTokenExpiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    claimGithubCopilotConnectionAttempt(id);
    expect(getDb()
      .prepare("SELECT github_oauth_nonce FROM provider_profiles WHERE id = ?")
      .get(id)).not.toEqual({ github_oauth_nonce: null });

    const response = await disconnect(
      new Request("http://localhost/api/providers/github/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerProfileId: id })
      })
    );

    expect(response.status).toBe(200);

    const profile = getProviderProfile(id);
    expect(profile?.githubUserAccessTokenEncrypted).toBe("");
    expect(profile?.githubTokenExpiresAt).toBeNull();
    expect(getDb()
      .prepare("SELECT github_oauth_nonce FROM provider_profiles WHERE id = ?")
      .get(id)).toEqual({ github_oauth_nonce: null });
  });

  it("rejects model discovery for disconnected profiles", async () => {
    const { GET: models } = await import("@/app/api/providers/github/models/route");
    const id = seedCopilotProfile();

    const response = await models(
      new Request(
        `http://localhost/api/providers/github/models?providerProfileId=${id}`
      )
    );

    expect(response.status).toBe(400);
  });

  it("returns forbidden for non-admin users", async () => {
    requireAdminResponseMock.mockResolvedValueOnce(null);
    const { POST: disconnect } = await import("@/app/api/providers/github/disconnect/route");

    const response = await disconnect(
      new Request("http://localhost/api/providers/github/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerProfileId: "profile_copilot" })
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });
});
