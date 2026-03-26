import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:3117",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev -- --port 3117",
    url: "http://localhost:3117",
    reuseExistingServer: false,
    env: {
      NODE_ENV: "test",
      HERMES_DATA_DIR: ".e2e-data",
      HERMES_ADMIN_USERNAME: "admin",
      HERMES_ADMIN_PASSWORD: "changeme123",
      HERMES_SESSION_SECRET: "e2e-session-secret-which-is-long-enough",
      HERMES_ENCRYPTION_SECRET: "e2e-encryption-secret-which-is-long-enough"
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
