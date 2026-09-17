import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const SEEDED_VERSION = "v4.0.1";

async function seedUser() {
  const { getDb } = await import("@/lib/db");
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, username, role, auth_source, password_hash, created_at, updated_at)
       VALUES (?, ?, 'admin', 'local', '', ?, ?)`
    )
    .run(USER.id, USER.username, USER.createdAt, USER.updatedAt);
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_preferences (user_id, last_seen_release, created_at, updated_at)
       VALUES (?, '', ?, ?)`
    )
    .run(USER.id, USER.createdAt, USER.updatedAt);
}

async function readPreference(userId = USER.id) {
  const { getDb } = await import("@/lib/db");
  return getDb()
    .prepare("SELECT last_seen_release FROM user_preferences WHERE user_id = ?")
    .get(userId) as { last_seen_release: string } | undefined;
}

async function readBody<T>(response: Response) {
  return (await response.json()) as T;
}

async function newestReleaseVersion() {
  const { getNewestReleaseNote } = await import("@/lib/release-highlights");

  return getNewestReleaseNote()?.version;
}

describe("whats-new route", () => {
  beforeEach(async () => {
    vi.resetModules();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue(USER);
    process.env.NEXT_PUBLIC_APP_VERSION = SEEDED_VERSION;
    await seedUser();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  });

  it("announces the running release to a user who has never seen it", async () => {
    const { getUserPreferences } = await import("@/lib/user-preferences");
    const { getGlobalPreferences } = await import("@/lib/global-preferences");
    const { RELEASE_NOTES } = await import("@/lib/release-notes");
    const runningRelease = RELEASE_NOTES.find((note) => note.version === SEEDED_VERSION);

    expect(getUserPreferences(USER.id, getGlobalPreferences()).lastSeenRelease).toBe("");
    expect(runningRelease).toBeDefined();

    const { GET } = await import("@/app/api/whats-new/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await readBody<{ whatsNew: { version: string; autoOpen: boolean; bullets: string[] } }>(
      response
    );
    expect(body.whatsNew).toEqual({
      version: SEEDED_VERSION,
      autoOpen: true,
      bullets: runningRelease!.bullets
    });
  });

  it("does not mark anything seen just by reading", async () => {
    const { GET } = await import("@/app/api/whats-new/route");
    await GET();

    expect((await readPreference())?.last_seen_release).toBe("");
  });

  it("records the running version and stays quiet afterwards", async () => {
    const { GET, POST } = await import("@/app/api/whats-new/route");

    const postResponse = await POST();
    expect(postResponse.status).toBe(200);
    expect(await readBody<{ seenReleaseVersion: string }>(postResponse)).toEqual({
      seenReleaseVersion: SEEDED_VERSION
    });
    expect((await readPreference())?.last_seen_release).toBe(SEEDED_VERSION);

    const body = await readBody<{ whatsNew: { autoOpen: boolean } }>(await GET());
    expect(body.whatsNew.autoOpen).toBe(false);
  });

  it("is idempotent when acknowledged twice", async () => {
    const { POST } = await import("@/app/api/whats-new/route");
    await POST();
    const response = await POST();

    expect(response.status).toBe(200);
    expect((await readPreference())?.last_seen_release).toBe(SEEDED_VERSION);
  });

  it("never auto-opens on a dev build", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "dev-abc1234";

    const { GET } = await import("@/app/api/whats-new/route");
    const body = await readBody<{ whatsNew: { version: string; autoOpen: boolean } }>(await GET());

    expect(body.whatsNew.autoOpen).toBe(false);
    expect(body.whatsNew.version).toBe(await newestReleaseVersion());
  });

  it("falls back to the newest authored entry for a release with no highlights", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "v9.9.9";

    const { GET } = await import("@/app/api/whats-new/route");
    const body = await readBody<{ whatsNew: { version: string; autoOpen: boolean } }>(await GET());

    expect(body.whatsNew).toMatchObject({
      version: await newestReleaseVersion(),
      autoOpen: false
    });
  });

  it("does not announce to a second user who already saw the release", async () => {
    const { getDb } = await import("@/lib/db");
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO users (id, username, role, auth_source, password_hash, created_at, updated_at)
         VALUES ('user_two', 'two', 'user', 'local', '', ?, ?)`
      )
      .run(USER.createdAt, USER.updatedAt);
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO user_preferences (user_id, last_seen_release, created_at, updated_at)
         VALUES ('user_two', ?, ?, ?)`
      )
      .run(SEEDED_VERSION, USER.createdAt, USER.updatedAt);

    requireUserMock.mockResolvedValue({ ...USER, id: "user_two", username: "two" });

    const { GET } = await import("@/app/api/whats-new/route");
    const body = await readBody<{ whatsNew: { autoOpen: boolean } }>(await GET());

    expect(body.whatsNew.autoOpen).toBe(false);
  });
});
