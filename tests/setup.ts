import fs from "node:fs";
import path from "node:path";

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";

const dataDir = path.resolve(".test-data");

Object.assign(process.env, {
  NODE_ENV: "test",
  EIDON_DATA_DIR: dataDir,
  EIDON_PASSWORD_LOGIN_ENABLED: "true",
  EIDON_ADMIN_USERNAME: "admin",
  EIDON_ADMIN_PASSWORD: "changeme123",
  EIDON_SESSION_SECRET: "test-session-secret-which-is-long-enough",
  EIDON_ENCRYPTION_SECRET: "test-encryption-secret-which-is-long-enough"
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: () => undefined
  });
}

beforeEach(async () => {
  const { resetDbForTests } = await import("@/lib/db");
  resetDbForTests();
  fs.rmSync(dataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50
  });
});

afterEach(async () => {
  const { resetDbForTests } = await import("@/lib/db");
  resetDbForTests();
});
