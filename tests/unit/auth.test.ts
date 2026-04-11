import {
  ensureAdminBootstrap,
  findUserByUsername,
  hashPassword,
  verifyPassword
} from "@/lib/auth";

describe("auth bootstrap", () => {
  it("creates the initial admin only once", async () => {
    await ensureAdminBootstrap();
    await ensureAdminBootstrap();

    const user = await findUserByUsername("admin");

    expect(user?.user.username).toBe("admin");
  });

  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("topsecret123");

    await expect(verifyPassword("topsecret123", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("authenticates the env super-admin against env credentials and local users against password hashes", async () => {
    const { createLocalUser } = await import("@/lib/users");
    const auth = await import("@/lib/auth");

    await auth.ensureAdminBootstrap();
    await createLocalUser({
      username: "member",
      password: "member-secret-123",
      role: "user"
    });

    await expect(auth.authenticateUser("admin", "changeme123")).resolves.toMatchObject({
      username: "admin",
      authSource: "env_super_admin"
    });
    await expect(auth.authenticateUser("member", "member-secret-123")).resolves.toMatchObject({
      username: "member",
      authSource: "local"
    });
  });
});
