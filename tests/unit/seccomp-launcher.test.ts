import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const launcher = join(process.cwd(), "scripts", "seccomp-exec.py");
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const hasSeccomp = hasPython && spawnSync("python3", ["-c", "import seccomp"]).status === 0;

function run(args: string[]) {
  return spawnSync("python3", [launcher, ...args], { encoding: "utf8" });
}

function syscallResult(name: string, args: string) {
  const probe = [
    "import ctypes, seccomp",
    "libc = ctypes.CDLL(None, use_errno=True)",
    `number = seccomp.resolve_syscall(seccomp.Arch.NATIVE, "${name}")`,
    `print(libc.syscall(number, ${args}), ctypes.get_errno())`
  ].join("\n");
  return run(["--", "python3", "-c", probe]);
}

describe.skipIf(!hasPython)("system-call filter launcher", () => {
  it("refuses to run without a command", () => {
    expect(run([])).toMatchObject({ status: 126, stderr: expect.stringContaining("usage") });
    expect(run(["true"])).toMatchObject({ status: 126, stderr: expect.stringContaining("usage") });
    expect(run(["--"])).toMatchObject({ status: 126, stderr: expect.stringContaining("usage") });
  });

  it.skipIf(hasSeccomp)("fails closed when the python3-seccomp package is missing", () => {
    expect(run(["--", "true"])).toMatchObject({ status: 126, stderr: expect.stringContaining("python3-seccomp") });
  });

  it.runIf(hasSeccomp)("blocks kernel keyrings, io_uring and new namespaces, then runs the command", () => {
    expect(run(["--", "sh", "-c", "echo ran"])).toMatchObject({ status: 0, stdout: "ran\n" });
    expect(syscallResult("keyctl", "0, 0, 0, 0, 0").stdout.trim()).toBe("-1 1");
    expect(syscallResult("io_uring_setup", "1, 0").stdout.trim()).toBe("-1 1");
    expect(syscallResult("unshare", "0x10000000").stdout.trim()).toBe("-1 1");
    expect(syscallResult("clone3", "0, 0").stdout.trim()).toBe("-1 38");
    expect(run(["--", "/nonexistent"])).toMatchObject({ status: 126, stderr: expect.stringContaining("cannot run /nonexistent") });
  });
});
