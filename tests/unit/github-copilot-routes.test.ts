import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import {
  claimProviderConnectionAttempt,
  getRuntimeProviderProfile,
  updateProviderConnection
} from "@/lib/provider-profiles";
import { updateProviderCatalog } from "@/lib/settings";
import { ensureEnvSuperAdminUser } from "@/lib/users";
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

function seedCopilotProfile() {
  const profile = createProviderProfileInput({
    id: "profile_copilot",
    name: "Copilot",
    providerKind: "github_copilot",
    providerConfig: {},
    credentials: {}
  });
  updateProviderCatalog(createProviderCatalogInput([profile]));
  return profile.id;
}

describe("GitHub Copilot provider routes", () => {
  beforeEach(async () => {
    process.env.EIDON_GITHUB_APP_CLIENT_ID = "github-client";
    process.env.EIDON_GITHUB_APP_CLIENT_SECRET = "github-secret";
    process.env.EIDON_GITHUB_APP_CALLBACK_URL =
      "https://eidon.example/api/providers/github/callback";
    requireAdminResponseMock.mockReset();
    requireAdminResponseMock.mockResolvedValue(await ensureEnvSuperAdminUser());
  });

  it("starts browser connections through the generic flow route", async () => {
    const { POST } = await import("@/app/api/providers/[profileId]/connection/flows/route");
    const profileId = seedCopilotProfile();
    const response = await POST(
      new Request(`http://localhost/api/providers/${profileId}/connection/flows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: "browser" })
      }),
      { params: Promise.resolve({ profileId }) }
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      flowId: expect.stringMatching(/^provider_connection_flow_/),
      authorizationUrl: expect.stringContaining("github.com/login/oauth/authorize")
    });
  });

  it("rejects callback requests with an invalid state token", async () => {
    const { GET } = await import("@/app/api/providers/github/callback/route");
    const response = await GET(new Request(
      "http://localhost/api/providers/github/callback?code=test-code&state=invalid-state"
    ));
    expect(response.status).toBe(400);
  });

  it("clears OAuth credentials and pending intent on disconnect", async () => {
    const { DELETE } = await import("@/app/api/providers/[profileId]/connection/route");
    const profileId = seedCopilotProfile();
    updateProviderConnection(profileId, {
      credentials: { accessToken: "ghu_token", refreshToken: "ghr_token" },
      metadata: { expiresAt: new Date(Date.now() + 60_000).toISOString() }
    });
    claimProviderConnectionAttempt(profileId);

    const response = await DELETE(
      new Request(`http://localhost/api/providers/${profileId}/connection`, { method: "DELETE" }),
      { params: Promise.resolve({ profileId }) }
    );

    expect(response.status).toBe(200);
    expect(getRuntimeProviderProfile(profileId)?.credentials).toEqual({});
    expect(getDb()
      .prepare("SELECT oauth_nonce FROM provider_profile_connections WHERE profile_id = ?")
      .get(profileId)).toEqual({ oauth_nonce: null });
  });

  it("rejects model discovery for disconnected profiles", async () => {
    const { GET } = await import("@/app/api/providers/[profileId]/models/route");
    const profileId = seedCopilotProfile();
    const response = await GET(
      new Request(`http://localhost/api/providers/${profileId}/models`),
      { params: Promise.resolve({ profileId }) }
    );
    expect(response.status).toBe(409);
  });

  it("returns forbidden for non-admin users", async () => {
    requireAdminResponseMock.mockResolvedValueOnce(null);
    const { DELETE } = await import("@/app/api/providers/[profileId]/connection/route");
    const response = await DELETE(
      new Request("http://localhost/api/providers/profile_copilot/connection", { method: "DELETE" }),
      { params: Promise.resolve({ profileId: "profile_copilot" }) }
    );
    expect(response.status).toBe(403);
  });
});
