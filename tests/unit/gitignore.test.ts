import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe(".gitignore", () => {
  it("ignores generated README demo context data", () => {
    const gitignore = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");

    expect(gitignore).toContain(".context/");
  });
});
