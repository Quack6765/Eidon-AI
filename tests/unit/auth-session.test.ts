const cookieState = new Map<string, string>();
let lastCookieOptions: Record<string, unknown> | null = null;

vi.mock("next/headers", () => {
  return {
    cookies: vi.fn(async () => ({
      get: (name: string) => {
        const value = cookieState.get(name);
        return value ? { value } : undefined;
      },
      set: (name: string, value: string, options: Record<string, unknown>) => {
        cookieState.set(name, value);
        lastCookieOptions = options;
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
    lastCookieOptions = null;
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

  it("uses secure session cookies only for https requests in production", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    vi.resetModules();

    try {
      const auth = await import("@/lib/auth");

      await auth.setSessionCookie(
        "http-token",
        new Date("2030-01-01T00:00:00.000Z"),
        new Request("http://example.com/api/auth/login")
      );
      expect(lastCookieOptions?.secure).toBe(false);

      await auth.setSessionCookie(
        "https-token",
        new Date("2030-01-01T00:00:00.000Z"),
        new Request("https://example.com/api/auth/login")
      );
      expect(lastCookieOptions?.secure).toBe(true);

      await auth.setSessionCookie(
        "forwarded-token",
        new Date("2030-01-01T00:00:00.000Z"),
        new Request("http://internal/api/auth/login", {
          headers: {
            "x-forwarded-proto": "https"
          }
        })
      );
      expect(lastCookieOptions?.secure).toBe(true);
    } finally {
      if (previous === undefined) {
        delete env.NODE_ENV;
      } else {
        env.NODE_ENV = previous;
      }

      vi.resetModules();
    }
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

    cookieState.set("eidon_session", "invalid");
    expect(await auth.getSessionPayload()).toBeNull();
    expect(await auth.getCurrentUser()).toBeNull();
    await expect(auth.requireUser()).rejects.toThrow("redirect:/login");
  });

  it("returns null when the session exists but the backing user is gone without mutating cookies", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/db");
    await auth.ensureAdminBootstrap();
    const found = await auth.findUserByUsername("admin");
    const session = await auth.createSession(found!.user.id);
    await auth.setSessionCookie(session.token, session.expiresAt);

    getDb().prepare("DELETE FROM admin_users WHERE id = ?").run(found!.user.id);

    expect(await auth.getCurrentUser()).toBeNull();
    expect(cookieState.get("eidon_session")).toBe(session.token);
    await auth.invalidateSession(session.sessionId);
    await auth.clearSessionCookie();
    expect(cookieState.has("eidon_session")).toBe(false);
  });

  it("returns the bootstrap user when username/password login is disabled", async () => {
    const previous = process.env.EIDON_PASSWORD_LOGIN_ENABLED;
    process.env.EIDON_PASSWORD_LOGIN_ENABLED = "false";
    vi.resetModules();

    try {
      const auth = await import("@/lib/auth");
      const currentUser = await auth.getCurrentUser();

      expect(currentUser?.username).toBe("admin");
      await expect(auth.requireUser(false)).resolves.toEqual(currentUser);
    } finally {
      if (previous === undefined) {
        delete process.env.EIDON_PASSWORD_LOGIN_ENABLED;
      } else {
        process.env.EIDON_PASSWORD_LOGIN_ENABLED = previous;
      }

      vi.resetModules();
    }
  });

  it("rejects login requests when username/password login is disabled", async () => {
    const previous = process.env.EIDON_PASSWORD_LOGIN_ENABLED;
    process.env.EIDON_PASSWORD_LOGIN_ENABLED = "false";
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
        delete process.env.EIDON_PASSWORD_LOGIN_ENABLED;
      } else {
        process.env.EIDON_PASSWORD_LOGIN_ENABLED = previous;
      }

      vi.resetModules();
    }
  });

  it("allows importing auth in production before sensitive env is accessed", async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      EIDON_PASSWORD_LOGIN_ENABLED: process.env.EIDON_PASSWORD_LOGIN_ENABLED,
      EIDON_ADMIN_USERNAME: process.env.EIDON_ADMIN_USERNAME,
      EIDON_ADMIN_PASSWORD: process.env.EIDON_ADMIN_PASSWORD,
      EIDON_SESSION_SECRET: process.env.EIDON_SESSION_SECRET,
      EIDON_ENCRYPTION_SECRET: process.env.EIDON_ENCRYPTION_SECRET
    };

    Object.assign(process.env, {
      NODE_ENV: "production",
      EIDON_PASSWORD_LOGIN_ENABLED: "true",
      EIDON_ADMIN_USERNAME: "admin"
    });
    delete process.env.EIDON_ADMIN_PASSWORD;
    delete process.env.EIDON_SESSION_SECRET;
    delete process.env.EIDON_ENCRYPTION_SECRET;
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

  it("returns null in production without a session cookie before bootstrap secrets are accessed", async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      EIDON_PASSWORD_LOGIN_ENABLED: process.env.EIDON_PASSWORD_LOGIN_ENABLED,
      EIDON_ADMIN_USERNAME: process.env.EIDON_ADMIN_USERNAME,
      EIDON_ADMIN_PASSWORD: process.env.EIDON_ADMIN_PASSWORD,
      EIDON_SESSION_SECRET: process.env.EIDON_SESSION_SECRET,
      EIDON_ENCRYPTION_SECRET: process.env.EIDON_ENCRYPTION_SECRET
    };

    Object.assign(process.env, {
      NODE_ENV: "production",
      EIDON_PASSWORD_LOGIN_ENABLED: "true",
      EIDON_ADMIN_USERNAME: "admin"
    });
    delete process.env.EIDON_ADMIN_PASSWORD;
    delete process.env.EIDON_SESSION_SECRET;
    delete process.env.EIDON_ENCRYPTION_SECRET;
    cookieState.clear();
    vi.resetModules();

    try {
      const auth = await import("@/lib/auth");

      await expect(auth.getCurrentUser()).resolves.toBeNull();
      await expect(auth.requireUser()).rejects.toThrow("redirect:/login");
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
