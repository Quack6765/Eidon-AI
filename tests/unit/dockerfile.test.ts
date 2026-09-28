import fs from "node:fs";
import path from "node:path";

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
      "install -d -m 700 -o eidon -g eidon /app/data /app/data/home /app/data/tmp /app/data/runtime /app/data/runtime/agent-browser /app/data-workspaces"
    );
    expect(dockerfile).toContain("--chown=eidon:eidon");
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
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--"]');
    expect(dockerfile).toContain('CMD ["node", "server.cjs"]');
  });

  it("ships the sandbox launcher owned by root so the app user cannot rewrite it", () => {
    expect(dockerfile).toContain("COPY --from=builder /app/scripts/landlock-exec.py ./scripts/landlock-exec.py");
  });

  it("installs Python 3 and symlinks the python command to python3", () => {
    expect(dockerfile).toContain("apt-get install -y --no-install-recommends chromium python3 tini");
    expect(dockerfile).toContain("ln -s /usr/bin/python3 /usr/local/bin/python");
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
