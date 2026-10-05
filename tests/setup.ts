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
  EIDON_ENCRYPTION_SECRET: "test-encryption-secret-which-is-long-enough",
  EIDON_EMBEDDING_DISABLED: "1",
  AGENT_BROWSER_EXECUTABLE_PATH: path.join(dataDir, "no-browser")
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: () => undefined
  });

  if (!window.IntersectionObserver) {
    class IntersectionObserver {
      readonly root: Element | null = null;
      readonly rootMargin: string = "";
      readonly thresholds: ReadonlyArray<number> = [];
      constructor(
        private callback: IntersectionObserverCallback,
        _options?: IntersectionObserverInit
      ) {}
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: IntersectionObserver
    });
  }
}

beforeEach(async () => {
  (globalThis as Record<symbol, unknown>)[Symbol.for("eidon.shell-isolation")] = { abi: 0 };
  const { resetDbForTests } = await import("@/lib/db");
  resetDbForTests();
  for (const dir of [dataDir, `${dataDir}-workspaces`]) {
    // A test that leaks a timer or a child process can recreate a file inside the
    // directory while it is being removed, so retry the whole wipe a few times.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        if (!fs.existsSync(dir)) break;
      } catch {
        // ENOTEMPTY from a concurrent write — try again
      }
    }
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "skill-curator-config.json"),
    `${JSON.stringify({ backgroundReview: { enabled: false } }, null, 2)}\n`,
    "utf8"
  );
});

afterEach(async () => {
  const { resetDbForTests } = await import("@/lib/db");
  resetDbForTests();
});
