import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const dockerfile = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");

describe("Dockerfile", () => {
  it("provisions writable browser runtime directories for the non-root user", () => {
    expect(dockerfile).toContain("ENV HOME=/app/data/home");
    expect(dockerfile).toContain("ENV TMPDIR=/app/data/tmp");
    expect(dockerfile).toContain("ENV XDG_RUNTIME_DIR=/app/data/runtime");
    expect(dockerfile).toContain("ENV AGENT_BROWSER_SOCKET_DIR=/app/data/runtime/agent-browser");
    expect(dockerfile).toContain(
      "install -d -m 700 /app/data /app/data/home /app/data/tmp /app/data/runtime /app/data/runtime/agent-browser"
    );
    expect(dockerfile).toContain("chown -R eidon:eidon /app");
  });
});
