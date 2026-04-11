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

  it("accepts speech-to-text fields on the general settings endpoint", async () => {
    const user = await createLocalUser({
      username: "settings-route-user",
      password: "Password123!",
      role: "user"
    });

    requireUserMock.mockResolvedValue(user);

    const { PUT } = await import("@/app/api/settings/route");
    const response = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sttEngine: "embedded",
          sttLanguage: "fr"
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          sttEngine: "embedded",
          sttLanguage: "fr"
        })
      })
    );
  });
});
