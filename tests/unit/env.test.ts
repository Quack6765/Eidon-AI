import { parseEnv } from "@/lib/env";

describe("env validation", () => {
  it("falls back to local defaults outside production", async () => {
    const env = parseEnv({
      NODE_ENV: "development",
      HERMES_PASSWORD_LOGIN_ENABLED: "true",
      HERMES_ADMIN_USERNAME: "admin",
      HERMES_DATA_DIR: ".test-data"
    });
    
    expect(env.NODE_ENV).toBe("development");
    expect(env.HERMES_ADMIN_PASSWORD).toBe("changeme123");
    expect(env.HERMES_SESSION_SECRET).toBe("development-session-secret-please-change");
    expect(env.HERMES_ENCRYPTION_SECRET).toBe("development-encryption-secret-please-change");
  });

  it("fails startup when the admin password is missing in production", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        HERMES_PASSWORD_LOGIN_ENABLED: "true",
        HERMES_ADMIN_USERNAME: "admin",
        HERMES_SESSION_SECRET: "production-session-secret-with-32-chars",
        HERMES_ENCRYPTION_SECRET: "production-encryption-secret-32-chars",
        HERMES_DATA_DIR: ".test-data"
      })
    ).toThrow(
      "Environment variable HERMES_ADMIN_PASSWORD is required in production"
    );
  });

  it("fails startup when the production session secret is still a placeholder", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        HERMES_PASSWORD_LOGIN_ENABLED: "true",
        HERMES_ADMIN_USERNAME: "admin",
        HERMES_ADMIN_PASSWORD: "production-password",
        HERMES_SESSION_SECRET: "replace-with-a-random-32-char-string-here",
        HERMES_ENCRYPTION_SECRET: "production-encryption-secret-32-chars",
        HERMES_DATA_DIR: ".test-data"
      })
    ).toThrow(
      "Environment variable HERMES_SESSION_SECRET must be changed from its default or placeholder value before production startup"
    );
  });

  it("accepts explicit production secrets", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      HERMES_ADMIN_PASSWORD: "production-password",
      HERMES_SESSION_SECRET: "production-session-secret-with-32-chars",
      HERMES_ENCRYPTION_SECRET: "production-encryption-secret-32-chars",
      HERMES_PASSWORD_LOGIN_ENABLED: "true",
      HERMES_ADMIN_USERNAME: "admin",
      HERMES_DATA_DIR: ".test-data"
    });

    expect(env.NODE_ENV).toBe("production");
    expect(env.HERMES_ADMIN_PASSWORD).toBe("production-password");
    expect(env.HERMES_SESSION_SECRET).toBe("production-session-secret-with-32-chars");
    expect(env.HERMES_ENCRYPTION_SECRET).toBe("production-encryption-secret-32-chars");
  });

  it("defers production secret validation until a sensitive value is accessed", async () => {
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
      const envModule = await import("@/lib/env");

      expect(envModule.isPasswordLoginEnabled()).toBe(true);
      expect(envModule.env.HERMES_ADMIN_USERNAME).toBe("admin");
      expect(() => envModule.env.HERMES_ADMIN_PASSWORD).toThrow(
        "Environment variable HERMES_ADMIN_PASSWORD is required in production"
      );
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
