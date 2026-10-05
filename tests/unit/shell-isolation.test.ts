import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: spawnSyncMock };
});

import {
  getIsolationStatus,
  getLandlockAbi,
  isolateCommand,
  resetShellIsolationForTests
} from "@/lib/shell-isolation";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

function onLinux() {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
}

describe("shell isolation", () => {
  beforeEach(() => {
    resetShellIsolationForTests();
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", platform);
    vi.unstubAllEnvs();
  });

  it("probes the kernel once and reports how much of the sandbox it supports", () => {
    onLinux();
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "4\n" });

    expect(getLandlockAbi()).toBe(4);
    expect(getIsolationStatus()).toBe("active");
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0][1]).toEqual([join(process.cwd(), "scripts", "landlock-exec.py"), "--probe"]);

    resetShellIsolationForTests(2);
    expect(getIsolationStatus()).toBe("filesystem");
  });

  it("warns and runs unsandboxed when Landlock or Python is missing", () => {
    onLinux();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "0\n" });
    expect(getIsolationStatus()).toBe("unavailable");

    resetShellIsolationForTests();
    spawnSyncMock.mockReturnValue({ status: null, stdout: null, error: new Error("ENOENT") });
    expect(getLandlockAbi()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(isolateCommand("/bin/sh", ["-lc", "ls"], { readWrite: ["/work"] })).toEqual({ command: "/bin/sh", args: ["-lc", "ls"] });
    warn.mockRestore();
  });

  it("never probes outside Linux", () => {
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });

    expect(getIsolationStatus()).toBe("unavailable");
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("wraps a command with read-only system paths and only the folders and ports it may use", () => {
    resetShellIsolationForTests(4);
    vi.stubEnv("PATH", ["/usr/local/bin", "relative/bin", "/", join(process.env.EIDON_DATA_DIR!, "bin"), "/usr/local/bin"].join(":"));

    const wrapped = isolateCommand("/bin/sh", ["-lc", "ls"], {
      readWrite: ["/work/bot", "/tmp", "/work/bot"],
      connectPorts: [4100]
    });

    expect(wrapped.command).toBe("python3");
    const args = wrapped.args;
    expect(args[0]).toBe(join(process.cwd(), "scripts", "landlock-exec.py"));
    const readOnly = args.flatMap((arg, index) => (args[index - 1] === "--ro" ? [arg] : []));
    expect(readOnly).toEqual(expect.arrayContaining(["/usr", "/etc", "/proc", "/usr/local/bin"]));
    expect(readOnly.filter((path) => path === "/usr/local/bin")).toHaveLength(1);
    expect(readOnly).not.toContain("/");
    expect(readOnly).not.toContain("relative/bin");
    expect(readOnly.some((path) => path.startsWith(process.env.EIDON_DATA_DIR!))).toBe(false);
    expect(args.slice(args.indexOf("--dev"), args.indexOf("--dev") + 4)).toEqual(["--dev", "/dev", "--rw", "/dev/shm"]);
    expect(args.slice(args.indexOf("/dev/shm") + 1)).toEqual([
      "--rw",
      "/work/bot",
      "--rw",
      "/tmp",
      "--connect",
      "4100",
      "--",
      "/bin/sh",
      "-lc",
      "ls"
    ]);
  });
});
