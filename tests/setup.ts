import fs from "node:fs";
import path from "node:path";

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";

const dataDir = path.resolve(".test-data");

Object.assign(process.env, {
  NODE_ENV: "test",
  HERMES_DATA_DIR: dataDir,
  HERMES_PASSWORD_LOGIN_ENABLED: "true",
  HERMES_ADMIN_USERNAME: "admin",
  HERMES_ADMIN_PASSWORD: "changeme123",
  HERMES_SESSION_SECRET: "test-session-secret-which-is-long-enough",
  HERMES_ENCRYPTION_SECRET: "test-encryption-secret-which-is-long-enough"
});

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
