import {
  createLocalUser,
  ensureEnvSuperAdminUser,
  listUsers,
  updateManagedUser
} from "@/lib/users";

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
});
