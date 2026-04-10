import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:3117",
    trace: "on-first-retry"
  },
  webServer: {
    command: "rm -rf .e2e-data test-results && PORT=3117 npm run dev",
    url: "http://localhost:3117",
    reuseExistingServer: false,
    env: {
      NODE_ENV: "test",
      EIDON_DATA_DIR: ".e2e-data",
      EIDON_PASSWORD_LOGIN_ENABLED: "true",
      EIDON_ADMIN_USERNAME: "admin",
      EIDON_ADMIN_PASSWORD: "changeme123",
      EIDON_SESSION_SECRET: "e2e-session-secret-which-is-long-enough",
      EIDON_ENCRYPTION_SECRET: "e2e-encryption-secret-which-is-long-enough"
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
