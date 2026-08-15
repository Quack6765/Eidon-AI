import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();

  return {
    ...actual,
    requireUser: requireUserMock
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined
  }))
}));

function putAccount(payload: unknown) {
  return new Request("http://localhost/api/auth/account", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

describe("PUT /api/auth/account — current password verification", () => {
  let userId: string;

  beforeEach(async () => {
    requireUserMock.mockReset();
    const { createLocalUser } = await import("@/lib/users");
    const user = await createLocalUser({
      username: "account-user",
      password: "CurrentPass123!",
      role: "user"
    });
    userId = user.id;
    requireUserMock.mockResolvedValue(user);
  });

  it("rejects a wrong current password without applying changes", async () => {
    const { PUT } = await import("@/app/api/auth/account/route");
    const response = await PUT(
      putAccount({
        username: "renamed-user",
        password: "NewSecret123!",
        currentPassword: "wrong-password"
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Current password is incorrect"
    });

    const { authenticateUser, findUserByUsername } = await import("@/lib/auth");
    expect(await findUserByUsername("renamed-user")).toBeNull();
    expect(await findUserByUsername("account-user")).not.toBeNull();
    expect(await authenticateUser("account-user", "CurrentPass123!")).not.toBeNull();
  });

  it("rejects a missing current password", async () => {
    const { PUT } = await import("@/app/api/auth/account/route");
    const response = await PUT(
      putAccount({
        username: "renamed-user",
        password: "NewSecret123!"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid account payload"
    });

    const { findUserByUsername } = await import("@/lib/auth");
    expect(await findUserByUsername("renamed-user")).toBeNull();
  });

  it("applies changes and invalidates sessions with the correct current password", async () => {
    const auth = await import("@/lib/auth");
    await auth.createSession(userId);

    const sessionRows = getDb()
      .prepare("SELECT id FROM auth_sessions")
      .all() as Array<{ id: string }>;
    expect(sessionRows).toHaveLength(1);

    const { PUT } = await import("@/app/api/auth/account/route");
    const response = await PUT(
      putAccount({
        username: "renamed-user",
        password: "NewSecret123!",
        currentPassword: "CurrentPass123!"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });

    expect(await auth.findUserByUsername("renamed-user")).not.toBeNull();
    expect(await auth.authenticateUser("renamed-user", "NewSecret123!")).not.toBeNull();

    const remaining = getDb()
      .prepare("SELECT COUNT(*) as count FROM auth_sessions WHERE user_id = ?")
      .get(userId) as { count: number };
    expect(remaining.count).toBe(0);
  });
});
