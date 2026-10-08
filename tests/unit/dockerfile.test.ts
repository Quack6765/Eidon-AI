import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const dockerfile = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
const nativeCompose = fs.readFileSync(
  path.join(process.cwd(), "docker-compose.native-test.yml"),
  "utf8"
);
const nativeSeeder = fs.readFileSync(
  path.join(process.cwd(), "scripts/seed-native-test.ts"),
  "utf8"
);

describe("Dockerfile", () => {
  it("provisions writable browser runtime directories for the non-root user", () => {
    expect(dockerfile).toContain("ENV HOME=/app/data/home");
    expect(dockerfile).toContain("ENV TMPDIR=/app/data/tmp");
    expect(dockerfile).toContain("ENV XDG_RUNTIME_DIR=/app/data/runtime");
    expect(dockerfile).toContain("ENV AGENT_BROWSER_SOCKET_DIR=/app/data/runtime/agent-browser");
    expect(dockerfile).toContain(
      "install -d -m 700 -o eidon -g eidon /app/data /app/data/home /app/data/tmp /app/data/runtime /app/data/runtime/agent-browser /app/data/model-cache /app/data-workspaces"
    );
    expect(dockerfile).toContain("--chown=eidon:eidon");
  });

  it("keeps the downloaded models and the data directory inside the one declared volume", () => {
    expect(dockerfile).toContain("ENV EIDON_DATA_DIR=/app/data");
    expect(dockerfile).toContain("VOLUME [\"/app/data\"]");
    expect(dockerfile).toContain("/app/data/model-cache");
  });

  it("runs on Node 24 with a pinned agent-browser that finds Chromium through its environment", () => {
    expect(dockerfile).toContain("FROM node:24-bookworm-slim AS base");
    expect(dockerfile).toContain("npm install -g agent-browser@0.38.1");
    expect(dockerfile).toContain("ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium");
    expect(dockerfile).toContain(
      `find "$(npm root -g)/agent-browser/bin" -name 'agent-browser-*' ! -name "agent-browser-linux-$(node -p process.arch)" -delete`
    );
    expect(dockerfile).not.toContain("agent-browser-core");
    expect(nativeCompose).toContain("image: node:24-alpine");
  });

  it("runs the server under tini so exited browser and daemon processes are reaped", () => {
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/docker-entrypoint.sh"]');
    expect(dockerfile).toContain('CMD ["node", "server.cjs"]');
  });

  it("starts as root only to prepare the data folder and never fixes the app to a build-time user", () => {
    expect(dockerfile).not.toMatch(/^USER /m);
    expect(dockerfile).toContain(
      "COPY --from=builder /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh"
    );
  });

  it("ships the sandbox launcher owned by root so the app user cannot rewrite it", () => {
    expect(dockerfile).toContain("COPY --from=builder /app/scripts/landlock-exec.py ./scripts/landlock-exec.py");
  });

  it("creates the TMPDIR directory before package postinsts run mktemp", () => {
    expect(dockerfile).toContain("install -d /app/data/tmp \\\n    && apt-get update");
  });

  it("installs Python 3 and symlinks the python command to python3", () => {
    expect(dockerfile).toContain("apt-get install -y --no-install-recommends chromium python3 tini");
    expect(dockerfile).toContain("ln -s /usr/bin/python3 /usr/local/bin/python");
    expect(dockerfile).toContain("--no-install-recommends chromium python3 tini curl ca-certificates");
  });

  it("bundles the scoped native integration seeder in the production image", () => {
    expect(dockerfile).toContain("scripts/seed-native-test.ts");
    expect(dockerfile).toContain("seed-native-test.cjs");
    expect(nativeSeeder).toContain('EIDON_NATIVE_TEST_SEED_ENABLED !== "true"');
    expect(nativeSeeder).toContain('!== "native-test"');
    expect(nativeSeeder).toContain("seedReadmeDemoData");
    expect(nativeSeeder).toContain("native-test-checklist.txt");
    expect(nativeSeeder).toContain("fake-provider:4010");
  });

  it("defines seeded administrator/member data, a fake provider, and local trusted HTTPS", () => {
    expect(nativeCompose).toContain("fake-provider:");
    expect(nativeCompose).toContain("tests/fixtures/native-fake-provider.mjs");
    expect(nativeCompose).toContain("node seed-native-test.cjs && node server.cjs");
    expect(nativeCompose).toContain('EIDON_NATIVE_TEST_SEED_ENABLED: "true"');
    expect(nativeCompose).toContain("tests/native/Caddyfile");
    expect(nativeCompose).toContain('"8443:443"');
    expect(nativeCompose).toContain("native-test-data:/app/data");
  });
});

const entrypointPath = path.join(process.cwd(), "scripts", "docker-entrypoint.sh");

function runEntrypointNonRoot(baseDir: string, extraEnv: Record<string, string>, markerPath: string) {
  const dataDir = path.join(baseDir, "data");
  execFileSync("/bin/sh", [entrypointPath, "sh", "-c", `id -u > ${JSON.stringify(markerPath)}`], {
    env: {
      ...process.env,
      EIDON_DATA_DIR: dataDir,
      HOME: path.join(dataDir, "home"),
      TMPDIR: path.join(dataDir, "tmp"),
      XDG_RUNTIME_DIR: path.join(dataDir, "runtime"),
      AGENT_BROWSER_SOCKET_DIR: path.join(dataDir, "runtime", "agent-browser"),
      ...extraEnv,
    },
  });
  return dataDir;
}

describe("docker-entrypoint non-root path", () => {
  it("creates the runtime folders and executes the command as the current user", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-entrypoint-"));
    const markerPath = path.join(baseDir, "uid.txt");

    const dataDir = runEntrypointNonRoot(baseDir, {}, markerPath);

    for (const dir of ["", "home", "tmp", "runtime", "runtime/agent-browser"]) {
      expect(fs.statSync(path.join(dataDir, dir)).isDirectory()).toBe(true);
    }
    expect(fs.statSync(`${dataDir}-workspaces`).isDirectory()).toBe(true);
    expect(fs.readFileSync(markerPath, "utf8").trim()).toBe(String(process.getuid()));
  });

  it("ignores PUID/PGID with a warning and still runs the command", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-entrypoint-"));
    const markerPath = path.join(baseDir, "uid.txt");

    const dataDir = runEntrypointNonRoot(baseDir, { PUID: "99", PGID: "100" }, markerPath);

    expect(fs.statSync(dataDir).isDirectory()).toBe(true);
    expect(fs.readFileSync(markerPath, "utf8").trim()).toBe(String(process.getuid()));
  });
});
