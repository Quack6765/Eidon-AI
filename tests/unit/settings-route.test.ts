import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

describe("settings route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("accepts provider-neutral speech settings on the general settings endpoint", async () => {
    const user = await createLocalUser({
      username: "settings-route-user",
      password: "Password123!",
      role: "user"
    });

    requireUserMock.mockResolvedValue(user);

    const { PUT } = await import("@/app/api/settings/general/route");
    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preferences: {
            conversationRetention: "forever",
            mcpTimeout: 120000,
            maxAssistantToolSteps: 25
          },
          webSearch: {
            providerId: "disabled",
            configuration: {},
            credentialAction: "clear"
          },
          speechTranscription: {
            providerId: "elevenlabs",
            configuration: { language: "zho" },
            credential: "xi-route-secret",
            credentialAction: "replace"
          }
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          speechTranscription: {
            providerId: "elevenlabs",
            configuration: { language: "zho" },
            configured: true,
            scope: "user"
          }
        })
      })
    );
  });
});
