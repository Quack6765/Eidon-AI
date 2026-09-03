import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));

const USER = {
  id: "user_admin",
  username: "admin",
  role: "admin" as const,
  authSource: "env_super_admin" as const,
  passwordManagedBy: "env" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function put(body: unknown) {
  return new Request("http://localhost/api/onboarding", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function seedUser() {
  const { getDb } = await import("@/lib/db");
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, username, role, auth_source, password_hash, created_at, updated_at)
       VALUES (?, ?, 'admin', 'local', '', ?, ?)`
    )
    .run(USER.id, USER.username, USER.createdAt, USER.updatedAt);
}

async function readPreferences() {
  const { getGlobalPreferences } = await import("@/lib/global-preferences");
  const { getUserPreferences } = await import("@/lib/user-preferences");
  return getUserPreferences(USER.id, getGlobalPreferences());
}

describe("onboarding route", () => {
  beforeEach(async () => {
    vi.resetModules();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue(USER);
    await seedUser();
  });

  it("starts out incomplete for a new user", async () => {
    expect((await readPreferences()).hasCompletedOnboarding).toBe(false);
  });

  it("writes both preferences and marks onboarding complete", async () => {
    const { PUT } = await import("@/app/api/onboarding/route");
    const response = await PUT(
      put({ defaultView: "agents", toolCallDisplay: "status_line", completed: true })
    );

    expect(response.status).toBe(200);
    const preferences = await readPreferences();
    expect(preferences.defaultView).toBe("agents");
    expect(preferences.toolCallDisplay).toBe("status_line");
    expect(preferences.hasCompletedOnboarding).toBe(true);
  });

  it("applies one preference at a time without disturbing the others", async () => {
    const { PUT } = await import("@/app/api/onboarding/route");
    await PUT(put({ toolCallDisplay: "status_line" }));

    const preferences = await readPreferences();
    expect(preferences.toolCallDisplay).toBe("status_line");
    // Untouched, so it keeps its default rather than being overwritten.
    expect(preferences.defaultView).toBe("chat");
    expect(preferences.hasCompletedOnboarding).toBe(false);
  });

  it("rejects values outside the allowed enums", async () => {
    const { PUT } = await import("@/app/api/onboarding/route");
    const response = await PUT(put({ defaultView: "inbox" }));

    expect(response.status).toBe(400);
    expect((await readPreferences()).defaultView).toBe("chat");
  });

  it("rejects a malformed body", async () => {
    const { PUT } = await import("@/app/api/onboarding/route");
    const response = await PUT(
      new Request("http://localhost/api/onboarding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "not json"
      })
    );

    expect(response.status).toBe(400);
  });

  it("clears the flag on DELETE so setup can be replayed", async () => {
    const { PUT, DELETE } = await import("@/app/api/onboarding/route");
    await PUT(put({ completed: true }));
    expect((await readPreferences()).hasCompletedOnboarding).toBe(true);

    const response = await DELETE();
    expect(response.status).toBe(200);
    expect((await readPreferences()).hasCompletedOnboarding).toBe(false);
  });

  it("lets a non-admin complete their own onboarding", async () => {
    requireUserMock.mockResolvedValue({ ...USER, role: "user" });
    const { PUT } = await import("@/app/api/onboarding/route");
    const response = await PUT(put({ defaultView: "chat", completed: true }));

    expect(response.status).toBe(200);
    expect((await readPreferences()).hasCompletedOnboarding).toBe(true);
  });
});
