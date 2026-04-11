import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalUser, getUserById, listUsers } from "@/lib/users";

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

describe("users routes", () => {
  beforeEach(() => {
    vi.doUnmock("@/lib/env");
    requireAdminUserMock.mockReset();
    requireAdminUserMock.mockResolvedValue(buildAdminUser());
  });

  it("creates a local user", async () => {
    const { POST } = await import("@/app/api/users/route");

    const response = await POST(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "member-create",
          password: "member-secret-123",
          role: "user"
        })
      })
    );

    expect(response.status).toBe(201);
    expect(
      listUsers().some((user) => user.username === "member-create" && user.role === "user")
    ).toBe(true);
  });

  it("updates a managed user", async () => {
    const member = await createLocalUser({
      username: "member-update",
      password: "member-secret-123",
      role: "user"
    });

    const { PATCH } = await import("@/app/api/users/[userId]/route");
    const response = await PATCH(
      new Request(`http://localhost/api/users/${member.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "member-admin",
          role: "admin"
        })
      }),
      { params: Promise.resolve({ userId: member.id }) }
    );

    expect(response.status).toBe(200);
    expect(getUserById(member.id)).toEqual(
      expect.objectContaining({
        id: member.id,
        username: "member-admin",
        role: "admin"
      })
    );
  });

  it("rejects deleting the current admin user", async () => {
    const { DELETE } = await import("@/app/api/users/[userId]/route");

    const response = await DELETE(
      new Request("http://localhost/api/users/user_admin", {
        method: "DELETE"
      }),
      { params: Promise.resolve({ userId: "user_admin" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "You cannot delete your own account"
    });
  });

  it("deletes a managed user", async () => {
    const member = await createLocalUser({
      username: "member-delete",
      password: "member-secret-123",
      role: "user"
    });

    const { DELETE } = await import("@/app/api/users/[userId]/route");
    const response = await DELETE(
      new Request(`http://localhost/api/users/${member.id}`, {
        method: "DELETE"
      }),
      { params: Promise.resolve({ userId: member.id }) }
    );

    expect(response.status).toBe(200);
    expect(getUserById(member.id)).toBeNull();
  });

  it("returns 404 when password login is disabled", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", async () => {
      const actual = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
      return {
        ...actual,
        isPasswordLoginEnabled: () => false
      };
    });

    const { GET } = await import("@/app/api/users/route");
    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });
});
