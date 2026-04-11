import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptValue } from "@/lib/crypto";
import {
  getProviderProfile,
  listProviderProfiles,
  updateSettings
} from "@/lib/settings";

const { requireAdminUserMock } = vi.hoisted(() => ({
  requireAdminUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireAdminUser: requireAdminUserMock
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
    requireAdminUserMock.mockReset();
    requireAdminUserMock.mockResolvedValue(buildAdminUser());
  });

  it("rejects connect requests for non-copilot profiles", async () => {
    const { GET: connect } = await import("@/app/api/providers/github/connect/route");
    const id = seedCopilotProfile();

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

  it("clears oauth credentials on disconnect", async () => {
    const { POST: disconnect } = await import("@/app/api/providers/github/disconnect/route");
    const id = seedCopilotProfile({
      githubUserAccessTokenEncrypted: encryptValue("ghu_token"),
      githubTokenExpiresAt: new Date(Date.now() + 60_000).toISOString()
    });

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
    requireAdminUserMock.mockRejectedValueOnce(new Error("forbidden"));
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
