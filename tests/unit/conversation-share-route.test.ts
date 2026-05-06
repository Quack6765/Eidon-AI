import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

describe("conversation share route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("enables and disables sharing for the authenticated owner", async () => {
    const user = await createLocalUser({
      username: "share-route-owner",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);
    const conversation = createConversation("Route share", null, {}, user.id);
    const { GET, PATCH } = await import("@/app/api/conversations/[conversationId]/share/route");

    const enabled = await PATCH(
      new Request(`http://localhost/api/conversations/${conversation.id}/share`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true })
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(enabled.status).toBe(200);
    const enabledBody = await enabled.json();
    expect(enabledBody).toEqual({
      enabled: true,
      token: expect.any(String),
      url: `http://localhost/share/${enabledBody.token}`
    });

    const current = await GET(
      new Request(`http://localhost/api/conversations/${conversation.id}/share`),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );
    await expect(current.json()).resolves.toEqual(enabledBody);

    const disabled = await PATCH(
      new Request(`http://localhost/api/conversations/${conversation.id}/share`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false })
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toEqual({
      enabled: false,
      token: null,
      url: null
    });
  });

  it("rejects invalid share updates and missing conversations", async () => {
    const user = await createLocalUser({
      username: "share-route-negative-owner",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);
    const { GET, PATCH } = await import("@/app/api/conversations/[conversationId]/share/route");

    const invalid = await PATCH(
      new Request("http://localhost/api/conversations/conv_missing/share", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: "yes" })
      }),
      { params: Promise.resolve({ conversationId: "conv_missing" }) }
    );
    expect(invalid.status).toBe(400);

    const missing = await GET(
      new Request("http://localhost/api/conversations/conv_missing/share"),
      { params: Promise.resolve({ conversationId: "conv_missing" }) }
    );
    expect(missing.status).toBe(404);
  });
});
