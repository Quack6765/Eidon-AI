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
      "install -d -m 700 -o eidon -g eidon /app/data /app/data/home /app/data/tmp /app/data/runtime /app/data/runtime/agent-browser"
    );
    expect(dockerfile).toContain("--chown=eidon:eidon");
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
