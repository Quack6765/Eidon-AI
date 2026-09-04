import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBot } from "@/lib/bots";
import { getConversation } from "@/lib/conversations";
import { updateProviderCatalog } from "@/lib/settings";
import { createLocalUser } from "@/lib/users";
import { createProviderProfileInput } from "@/tests/provider-fixtures";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("PATCH /api/bots/:botId provider selection", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("pins a bot to a configured provider, rejects unknown ones, and can return to the default", async () => {
    const user = await createLocalUser({ username: "providerroute", password: "password-123", role: "user" as const });
    const primary = createProviderProfileInput({ id: "profile_route_primary", name: "Primary", model: "gpt-a" });
    const secondary = createProviderProfileInput({ id: "profile_route_secondary", name: "Secondary", model: "gpt-b" });
    updateProviderCatalog({ defaultProviderProfileId: primary.id, skillsEnabled: false, providerProfiles: [primary, secondary] });
    const bot = createBot({ name: "Route Bot" }, user.id);
    requireUserMock.mockResolvedValue(user);
    const context = { params: Promise.resolve({ botId: bot.id }) };

    const { PATCH } = await import("@/app/api/bots/[botId]/route");

    const pinned = await PATCH(patchRequest({ providerProfileId: secondary.id }), context);
    expect(pinned.ok).toBe(true);
    expect(((await pinned.json()) as { bot: { providerProfileId: string | null } }).bot.providerProfileId).toBe(secondary.id);
    expect(getConversation(bot.homeConversationId)?.providerProfileId).toBe(secondary.id);

    const unknown = await PATCH(patchRequest({ providerProfileId: "profile_nope" }), context);
    expect(unknown.status).toBe(400);
    expect(getConversation(bot.homeConversationId)?.providerProfileId).toBe(secondary.id);

    const reset = await PATCH(patchRequest({ providerProfileId: null }), context);
    expect(reset.ok).toBe(true);
    expect(((await reset.json()) as { bot: { providerProfileId: string | null } }).bot.providerProfileId).toBeNull();
    expect(getConversation(bot.homeConversationId)?.providerProfileId).toBeNull();
  });
});
