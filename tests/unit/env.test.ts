import { env, parseEnv } from "@/lib/env";

describe("env validation", () => {
  it("falls back to local defaults outside production", async () => {
    const env = parseEnv({
      NODE_ENV: "development",
      EIDON_PASSWORD_LOGIN_ENABLED: "true",
      EIDON_ADMIN_USERNAME: "admin",
      EIDON_DATA_DIR: ".test-data"
    });
    
    expect(env.NODE_ENV).toBe("development");
    expect(env.EIDON_ADMIN_PASSWORD).toBe("changeme123");
    expect(env.EIDON_SESSION_SECRET).toBe("development-session-secret-please-change");
    expect(env.EIDON_ENCRYPTION_SECRET).toBe("development-encryption-secret-please-change");
  });

  it("fails startup when the admin password is missing in production", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        EIDON_PASSWORD_LOGIN_ENABLED: "true",
        EIDON_ADMIN_USERNAME: "admin",
        EIDON_SESSION_SECRET: "production-session-secret-with-32-chars",
        EIDON_ENCRYPTION_SECRET: "production-encryption-secret-32-chars",
        EIDON_DATA_DIR: ".test-data"
      })
    ).toThrow(
      "Environment variable EIDON_ADMIN_PASSWORD is required in production"
    );
  });

  it("fails startup when the production session secret is still a placeholder", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        EIDON_PASSWORD_LOGIN_ENABLED: "true",
        EIDON_ADMIN_USERNAME: "admin",
        EIDON_ADMIN_PASSWORD: "production-password",
        EIDON_SESSION_SECRET: "replace-with-a-random-32-char-string-here",
        EIDON_ENCRYPTION_SECRET: "production-encryption-secret-32-chars",
        EIDON_DATA_DIR: ".test-data"
      })
    ).toThrow(
      "Environment variable EIDON_SESSION_SECRET must be changed from its default or placeholder value before production startup"
    );
  });

  it("accepts explicit production secrets", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      EIDON_ADMIN_PASSWORD: "production-password",
      EIDON_SESSION_SECRET: "production-session-secret-with-32-chars",
      EIDON_ENCRYPTION_SECRET: "production-encryption-secret-32-chars",
      EIDON_PASSWORD_LOGIN_ENABLED: "true",
      EIDON_ADMIN_USERNAME: "admin",
      EIDON_DATA_DIR: ".test-data"
    });

    expect(env.NODE_ENV).toBe("production");
    expect(env.EIDON_ADMIN_PASSWORD).toBe("production-password");
    expect(env.EIDON_SESSION_SECRET).toBe("production-session-secret-with-32-chars");
    expect(env.EIDON_ENCRYPTION_SECRET).toBe("production-encryption-secret-32-chars");
  });

  it("reads GitHub Copilot OAuth environment variables when provided", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      EIDON_ADMIN_PASSWORD: "production-admin-password-32-chars",
      EIDON_SESSION_SECRET: "production-session-secret-with-32-chars",
      EIDON_ENCRYPTION_SECRET: "production-encryption-secret-32-chars",
      EIDON_GITHUB_APP_CLIENT_ID: "Iv23exampleclientid",
      EIDON_GITHUB_APP_CLIENT_SECRET: "github-app-client-secret-value",
      EIDON_GITHUB_APP_CALLBACK_URL: "https://eidon.example.com/api/providers/github/callback"
    });

    expect(env.EIDON_GITHUB_APP_CLIENT_ID).toBe("Iv23exampleclientid");
    expect(env.EIDON_GITHUB_APP_CLIENT_SECRET).toBe("github-app-client-secret-value");
    expect(env.EIDON_GITHUB_APP_CALLBACK_URL).toBe(
      "https://eidon.example.com/api/providers/github/callback"
    );
  });

  it("parses the timezone env and exposes it", async () => {
    const { parseEnv } = await import("@/lib/env");

    const env = parseEnv({
      NODE_ENV: "development",
      EIDON_PASSWORD_LOGIN_ENABLED: "true",
      EIDON_ADMIN_USERNAME: "admin",
      EIDON_DATA_DIR: ".test-data",
      TZ: "America/Toronto"
    });

    expect(env.TZ).toBe("America/Toronto");
  });

  it("defaults the timezone env to the current system timezone", () => {
    const env = parseEnv({
      NODE_ENV: "development",
      EIDON_PASSWORD_LOGIN_ENABLED: "true",
      EIDON_ADMIN_USERNAME: "admin",
      EIDON_DATA_DIR: ".test-data"
    });

    expect(env.TZ).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("returns undefined for non-string env proxy keys", () => {
    expect(Reflect.get(env, Symbol.toStringTag)).toBeUndefined();
  });

  it("rejects invalid timezones", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "development",
        EIDON_PASSWORD_LOGIN_ENABLED: "true",
        EIDON_ADMIN_USERNAME: "admin",
        EIDON_DATA_DIR: ".test-data",
        TZ: "Mars/Olympus"
      })
    ).toThrow();
  });

  it("rejects fixed-offset timezone forms", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "development",
        EIDON_PASSWORD_LOGIN_ENABLED: "true",
        EIDON_ADMIN_USERNAME: "admin",
        EIDON_DATA_DIR: ".test-data",
        TZ: "+01:00"
      })
    ).toThrow();

    expect(() =>
      parseEnv({
        NODE_ENV: "development",
        EIDON_PASSWORD_LOGIN_ENABLED: "true",
        EIDON_ADMIN_USERNAME: "admin",
        EIDON_DATA_DIR: ".test-data",
        TZ: "-2359"
      })
    ).toThrow();
  });

  it("defers production secret validation until a sensitive value is accessed", async () => {
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
      const envModule = await import("@/lib/env");

      expect(envModule.isPasswordLoginEnabled()).toBe(true);
      expect(envModule.env.EIDON_ADMIN_USERNAME).toBe("admin");
      expect(() => envModule.env.EIDON_ADMIN_PASSWORD).toThrow(
        "Environment variable EIDON_ADMIN_PASSWORD is required in production"
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
