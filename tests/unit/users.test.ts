import {
  createLocalUser,
  deleteManagedUser,
  ensureEnvSuperAdminUser,
  findPersistedUserByUsername,
  getUserById,
  getUserRecordById,
  listUsers,
  updateManagedUser
} from "@/lib/users";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";

describe("users", () => {
  it("bootstraps and syncs the env super-admin row", async () => {
    const first = await ensureEnvSuperAdminUser();
    const second = await ensureEnvSuperAdminUser();

    expect(first.id).toBe(second.id);
    expect(first.authSource).toBe("env_super_admin");
    expect(first.role).toBe("admin");
  });

  it("creates and updates local users", async () => {
    const created = await createLocalUser({
      username: "alice",
      password: "correct-horse-battery-staple",
      role: "user"
    });

    const updated = await updateManagedUser(created.id, {
      role: "admin",
      username: "alice-admin"
    });

    expect(updated?.username).toBe("alice-admin");
    expect(updated?.role).toBe("admin");
    expect(listUsers().some((user) => user.id === created.id)).toBe(true);
  });

  it("reuses the legacy admin row when bootstrapping the env super-admin", async () => {
    getDb()
      .prepare(
        `INSERT INTO admin_users (id, username, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        "legacy-admin",
        "legacy-admin",
        "legacy-password-hash",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z"
      );

    const user = await ensureEnvSuperAdminUser();

    expect(user.id).toBe("legacy-admin");
    expect(user.username).toBe("admin");
    expect(user.authSource).toBe("env_super_admin");
  });

  it("returns null or false for missing user lookups and mutations", async () => {
    expect(getUserById("missing")).toBeNull();
    expect(getUserRecordById("missing")).toBeNull();
    expect(findPersistedUserByUsername("missing")).toBeNull();
    await expect(updateManagedUser("missing", { username: "nobody" })).resolves.toBeNull();
    expect(deleteManagedUser("missing")).toBe(false);
  });

  it("rejects reserved usernames and protects env-managed users from manager mutations", async () => {
    const envAdmin = await ensureEnvSuperAdminUser();
    const created = await createLocalUser({
      username: "bob",
      password: "correct-horse-battery-staple",
      role: "user"
    });

    await expect(
      createLocalUser({
        username: "admin",
        password: "another-secret-123",
        role: "user"
      })
    ).rejects.toThrow('Username "admin" is reserved for the env super-admin');

    await expect(updateManagedUser(created.id, { username: "admin" })).rejects.toThrow(
      'Username "admin" is reserved for the env super-admin'
    );

    await expect(updateManagedUser(envAdmin.id, { role: "user" })).rejects.toThrow(
      "Env-managed users cannot be updated by the manager"
    );

    expect(() => deleteManagedUser(envAdmin.id)).toThrow(
      "Env-managed users cannot be deleted by the manager"
    );
  });

  it("updates password hashes for local users and deletes them", async () => {
    const created = await createLocalUser({
      username: "carol",
      password: "initial-password-123",
      role: "user"
    });
    const original = getUserRecordById(created.id);

    await updateManagedUser(created.id, {
      password: "updated-password-123"
    });

    const updated = getUserRecordById(created.id);

    expect(updated?.passwordHash).not.toBe(original?.passwordHash);
    await expect(verifyPassword("updated-password-123", updated!.passwordHash!)).resolves.toBe(true);
    expect(deleteManagedUser(created.id)).toBe(true);
    expect(getUserById(created.id)).toBeNull();
  });
});
