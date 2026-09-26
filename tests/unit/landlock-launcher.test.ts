import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const launcher = join(process.cwd(), "scripts", "landlock-exec.py");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

function run(args: string[]) {
  return spawnSync("python3", [launcher, ...args], { encoding: "utf8" });
}

describe.skipIf(!hasPython)("Landlock launcher", () => {
  it("reports the kernel's Landlock version", () => {
    const probe = run(["--probe"]);

    expect(probe.status).toBe(0);
    expect(Number.isInteger(Number(probe.stdout.trim()))).toBe(true);
    if (process.platform !== "linux") expect(probe.stdout.trim()).toBe("0");
  });

  it("refuses to run anything when its rules are malformed", () => {
    expect(run(["--bogus", "/tmp", "--", "true"])).toMatchObject({ status: 126, stderr: expect.stringContaining("unexpected argument --bogus") });
    expect(run(["--ro", "/usr", "--"])).toMatchObject({ status: 126, stderr: expect.stringContaining("missing command") });
    expect(run(["--ro"])).toMatchObject({ status: 126 });
  });

  it.skipIf(process.platform === "linux")("fails closed where Landlock does not exist", () => {
    expect(run(["--rw", "/tmp", "--", "true"])).toMatchObject({ status: 126, stderr: expect.stringContaining("not available") });
  });
});
