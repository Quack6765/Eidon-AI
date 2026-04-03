const cookieState = new Map<string, string>();

vi.mock("next/headers", () => {
  return {
    cookies: vi.fn(async () => ({
      get: (name: string) => {
        const value = cookieState.get(name);
        return value ? { value } : undefined;
      },
      set: (name: string, value: string) => {
        cookieState.set(name, value);
      },
      delete: (name: string) => {
        cookieState.delete(name);
      }
    }))
  };
});

vi.mock("next/navigation", () => {
  return {
    redirect: vi.fn((url: string) => {
      throw new Error(`redirect:${url}`);
    })
  };
});

describe("session lifecycle", () => {
  beforeEach(() => {
    cookieState.clear();
  });

  it("creates a session cookie and resolves the current user", async () => {
    const auth = await import("@/lib/auth");
    await auth.ensureAdminBootstrap();
    const found = await auth.findUserByUsername("admin");

    expect(found).not.toBeNull();

    const session = await auth.createSession(found!.user.id);
    await auth.setSessionCookie(session.token, session.expiresAt);

    const currentUser = await auth.getCurrentUser();

    expect(currentUser?.username).toBe("admin");
  });

  it("updates credentials and invalidates sessions", async () => {
    const auth = await import("@/lib/auth");
    await auth.ensureAdminBootstrap();
    const found = await auth.findUserByUsername("admin");
    const user = found!.user;

    const session = await auth.createSession(user.id);
    await auth.setSessionCookie(session.token, session.expiresAt);
    await auth.updateUsername(user.id, "captain");
    await auth.updatePassword(user.id, "supersecret123");

    expect((await auth.findUserByUsername("captain"))?.user.username).toBe("captain");
    expect(await auth.verifyPassword("supersecret123", (await auth.findUserByUsername("captain"))!.passwordHash)).toBe(true);

    await auth.invalidateAllSessionsForUser(user.id);

    expect(await auth.getCurrentUser()).toBeNull();
  });

  it("returns null for invalid or missing session cookies and redirects when required", async () => {
    const auth = await import("@/lib/auth");

    expect(await auth.getSessionPayload()).toBeNull();

    cookieState.set("hermes_session", "invalid");
    expect(await auth.getSessionPayload()).toBeNull();
    expect(await auth.getCurrentUser()).toBeNull();
    await expect(auth.requireUser()).rejects.toThrow("redirect:/login");
  });

  it("clears cookies when the session exists but the backing user is gone", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/db");
    await auth.ensureAdminBootstrap();
    const found = await auth.findUserByUsername("admin");
    const session = await auth.createSession(found!.user.id);
    await auth.setSessionCookie(session.token, session.expiresAt);

    getDb().prepare("DELETE FROM admin_users WHERE id = ?").run(found!.user.id);

    expect(await auth.getCurrentUser()).toBeNull();
    await auth.invalidateSession(session.sessionId);
    await auth.clearSessionCookie();
    expect(cookieState.has("hermes_session")).toBe(false);
  });

  it("returns the bootstrap user when username/password login is disabled", async () => {
    const previous = process.env.HERMES_PASSWORD_LOGIN_ENABLED;
    process.env.HERMES_PASSWORD_LOGIN_ENABLED = "false";
    vi.resetModules();

    try {
      const auth = await import("@/lib/auth");
      const currentUser = await auth.getCurrentUser();

      expect(currentUser?.username).toBe("admin");
      await expect(auth.requireUser(false)).resolves.toEqual(currentUser);
    } finally {
      if (previous === undefined) {
        delete process.env.HERMES_PASSWORD_LOGIN_ENABLED;
      } else {
        process.env.HERMES_PASSWORD_LOGIN_ENABLED = previous;
      }

      vi.resetModules();
    }
  });

  it("rejects login requests when username/password login is disabled", async () => {
    const previous = process.env.HERMES_PASSWORD_LOGIN_ENABLED;
    process.env.HERMES_PASSWORD_LOGIN_ENABLED = "false";
    vi.resetModules();

    try {
      const { POST } = await import("@/app/api/auth/login/route");
      const response = await POST(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            username: "admin",
            password: "changeme123"
          })
        })
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Username/password login is disabled"
      });
    } finally {
      if (previous === undefined) {
        delete process.env.HERMES_PASSWORD_LOGIN_ENABLED;
      } else {
        process.env.HERMES_PASSWORD_LOGIN_ENABLED = previous;
      }

      vi.resetModules();
    }
  });

  it("allows importing auth in production before sensitive env is accessed", async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      HERMES_PASSWORD_LOGIN_ENABLED: process.env.HERMES_PASSWORD_LOGIN_ENABLED,
      HERMES_ADMIN_USERNAME: process.env.HERMES_ADMIN_USERNAME,
      HERMES_ADMIN_PASSWORD: process.env.HERMES_ADMIN_PASSWORD,
      HERMES_SESSION_SECRET: process.env.HERMES_SESSION_SECRET,
      HERMES_ENCRYPTION_SECRET: process.env.HERMES_ENCRYPTION_SECRET
    };

    Object.assign(process.env, {
      NODE_ENV: "production",
      HERMES_PASSWORD_LOGIN_ENABLED: "true",
      HERMES_ADMIN_USERNAME: "admin"
    });
    delete process.env.HERMES_ADMIN_PASSWORD;
    delete process.env.HERMES_SESSION_SECRET;
    delete process.env.HERMES_ENCRYPTION_SECRET;
    vi.resetModules();

    try {
      await expect(import("@/lib/auth")).resolves.toBeDefined();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      vi.resetModules();
    }
  });
});
