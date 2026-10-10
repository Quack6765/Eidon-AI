import { describe, expect, it } from "vitest";

import { POST as postMobileRoute } from "@/app/api/v1/[...path]/route";
import { createMobileSession } from "@/lib/auth";
import { getAssistantTurnStartPreflight } from "@/lib/chat-turn";
import { createConversation, getConversation } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getProviderConnectionSummary } from "@/lib/provider-profile";
import { getRuntimeProviderProfile, updateProviderConnection } from "@/lib/provider-profiles";
import {
  getDefaultRuntimeProviderProfile,
  getSanitizedSettings,
  updateProviderCatalog
} from "@/lib/settings";
import { createLocalUser } from "@/lib/users";
import {
  createProviderCatalogInput,
  createProviderProfileInput,
  createRuntimeProviderProfile
} from "@/tests/provider-fixtures";

const SHARED_ID = "profile_shared";
const PRIVATE_ID = "profile_private";

const sharedProfile = createProviderProfileInput({
  id: SHARED_ID,
  name: "Shared",
  model: "gpt-test",
  credentials: { apiKey: "sk-shared" }
});
const privateProfile = createProviderProfileInput({
  id: PRIVATE_ID,
  name: "ChatGPT",
  providerKind: "chatgpt_subscription",
  providerConfig: {},
  model: "gpt-6-luna",
  credentials: {}
});

async function seed() {
  const owner = await createLocalUser({ username: "owner-admin", password: "OwnerAdmin123!", role: "admin" });
  const member = await createLocalUser({ username: "member", password: "MemberUser123!", role: "user" });
  updateProviderCatalog(createProviderCatalogInput([privateProfile, sharedProfile], {
    defaultProviderProfileId: PRIVATE_ID
  }));
  updateProviderConnection(PRIVATE_ID, {
    credentials: { accessToken: "access", refreshToken: "refresh" },
    metadata: { expiresAt: new Date(Date.now() + 3_600_000).toISOString(), accountLabel: "owner@example.com", ownerUserId: owner.id }
  });
  return { owner, member };
}

describe("owner-only provider access", () => {
  it("shows a private provider only to its owner while admins keep the full catalog", async () => {
    const { owner, member } = await seed();
    const otherAdmin = await createLocalUser({ username: "other-admin", password: "OtherAdmin123!", role: "admin" });

    const memberSettings = getSanitizedSettings(member.id);
    expect(memberSettings.providerProfiles.map((profile) => profile.id)).toEqual([SHARED_ID]);
    expect(memberSettings.defaultProviderProfileId).toBe(SHARED_ID);
    expect(JSON.stringify(memberSettings)).not.toContain("owner@example.com");

    for (const viewer of [owner.id, otherAdmin.id, undefined]) {
      const settings = getSanitizedSettings(viewer);
      expect(settings.providerProfiles.map((profile) => profile.id)).toEqual([PRIVATE_ID, SHARED_ID]);
      expect(settings.defaultProviderProfileId).toBe(PRIVATE_ID);
    }
  });

  it("resolves each user's default to a provider they may use", async () => {
    const { owner, member } = await seed();

    expect(getDefaultRuntimeProviderProfile(owner.id)?.id).toBe(PRIVATE_ID);
    expect(getDefaultRuntimeProviderProfile(member.id)?.id).toBe(SHARED_ID);
    expect(getDefaultRuntimeProviderProfile(null)?.id).toBe(SHARED_ID);
    expect(createConversation("Member chat", null, undefined, member.id).providerProfileId).toBe(SHARED_ID);
    expect(createConversation("Owner chat", null, undefined, owner.id).providerProfileId).toBe(PRIVATE_ID);
  });

  it("blocks turns that would spend another account's subscription", async () => {
    const { owner, member } = await seed();
    const memberChat = createConversation("Member chat", null, { providerProfileId: PRIVATE_ID }, member.id);
    const ownerChat = createConversation("Owner chat", null, { providerProfileId: PRIVATE_ID }, owner.id);

    expect(getAssistantTurnStartPreflight(memberChat.id)).toMatchObject({
      ok: false,
      errorMessage: expect.stringContaining("private")
    });
    expect(getAssistantTurnStartPreflight(ownerChat.id)).toMatchObject({ ok: true });
  });

  it("rejects selecting a private provider for another user's conversation", async () => {
    const { owner, member } = await seed();
    const memberSession = await createMobileSession(member.id, "Member device");
    const ownerSession = await createMobileSession(owner.id, "Owner device");
    const create = (token: string) => postMobileRoute(
      new Request("https://eidon.example/api/v1/conversations", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ providerProfileId: PRIVATE_ID })
      }),
      { params: Promise.resolve({ path: ["conversations"] }) }
    );

    expect((await create(memberSession.token)).status).toBe(404);
    expect((await create(ownerSession.token)).status).toBe(201);
  });

  it("reassigns removed profiles to a default each owner may use", async () => {
    const { owner, member } = await seed();
    const removedProfile = createProviderProfileInput({
      id: "profile_removed",
      name: "Removed",
      model: "gpt-test",
      credentials: { apiKey: "sk-removed" }
    });
    updateProviderCatalog(createProviderCatalogInput([privateProfile, sharedProfile, removedProfile], {
      defaultProviderProfileId: PRIVATE_ID
    }));
    const memberChat = createConversation("Member chat", null, { providerProfileId: "profile_removed" }, member.id);
    const ownerChat = createConversation("Owner chat", null, { providerProfileId: "profile_removed" }, owner.id);

    updateProviderCatalog(createProviderCatalogInput([privateProfile, sharedProfile], {
      defaultProviderProfileId: PRIVATE_ID
    }));

    expect(getConversation(memberChat.id)?.providerProfileId).toBe(SHARED_ID);
    expect(getConversation(ownerChat.id)?.providerProfileId).toBe(PRIVATE_ID);
    expect(getRuntimeProviderProfile(PRIVATE_ID)?.connectionMetadata.ownerUserId).toBe(owner.id);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM provider_profiles").get()).toEqual({ count: 2 });
  });

  it("keeps a refreshable connection connected after its access token expires", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const profile = createRuntimeProviderProfile({
      providerKind: "chatgpt_subscription",
      providerConfig: {},
      credentials: { accessToken: "access", refreshToken: "refresh" },
      connectionMetadata: { expiresAt: past }
    });

    expect(getProviderConnectionSummary(profile).status).toBe("connected");
    expect(getProviderConnectionSummary({
      ...profile,
      connectionMetadata: { expiresAt: past, refreshExpiresAt: past }
    }).status).toBe("expired");
    expect(getProviderConnectionSummary({
      ...profile,
      credentials: { accessToken: "access" }
    }).status).toBe("expired");
    expect(getProviderConnectionSummary({ ...profile, credentials: {} }).status).toBe("disconnected");
  });
});
