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
});
