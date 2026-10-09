import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock, symlinks, fakeEntries } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  symlinks: new Map<string, string>(),
  fakeEntries: new Map<string, "dir" | "file">()
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: spawnSyncMock };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync: ((path: string, options?: never) => {
      if (symlinks.has(path)) return { isSymbolicLink: () => true, isDirectory: () => false };
      if (fakeEntries.has(path)) return { isSymbolicLink: () => false, isDirectory: () => fakeEntries.get(path) === "dir" };
      if (path.startsWith("/proc/") || path.startsWith("/sys/")) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return actual.lstatSync(path, options);
    }) as typeof actual.lstatSync,
    readlinkSync: ((path: string, options?: never) => symlinks.get(path) ?? actual.readlinkSync(path, options)) as typeof actual.readlinkSync
  };
});

import {
  getIsolationBackend,
  getIsolationStatus,
  getLandlockAbi,
  isolateCommand,
  resetShellIsolationForTests
} from "@/lib/shell-isolation";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const seccompLauncher = join(process.cwd(), "scripts", "seccomp-exec.py");

function onLinux() {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
}

function bindSources(args: string[], flag: string) {
  return args.flatMap((arg, index) => (args[index - 1] === flag ? [arg] : []));
}

describe("shell isolation", () => {
  beforeEach(() => {
    resetShellIsolationForTests();
    spawnSyncMock.mockReset();
    symlinks.clear();
    fakeEntries.clear();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", platform);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("probes the kernel once and reports how much of the sandbox it supports", () => {
    onLinux();
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "4\n" });

    expect(getLandlockAbi()).toBe(4);
    expect(getIsolationBackend()).toBe("landlock");
    expect(getIsolationStatus()).toBe("active");
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0][1]).toEqual([join(process.cwd(), "scripts", "landlock-exec.py"), "--probe"]);

    resetShellIsolationForTests(2);
    expect(getIsolationStatus()).toBe("filesystem");
  });

  it("falls back to bubblewrap when Landlock is missing and the exact sandbox bots get can start", () => {
    onLinux();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: "0\n" }).mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    expect(getIsolationBackend()).toBe("bubblewrap");
    expect(getIsolationStatus()).toBe("filesystem");
    expect(getLandlockAbi()).toBe(0);
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    const [command, args] = spawnSyncMock.mock.calls[1];
    expect(command).toBe("bwrap");
    expect(args).toEqual(isolateCommand("true", [], { readWrite: [] }).args);
    expect(args.slice(-7)).toEqual(["--remount-ro", "/", "--", "python3", seccompLauncher, "--", "true"]);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("sandboxed with bubblewrap and a system-call filter"));
  });

  it("warns with bubblewrap's reason and runs unsandboxed when neither sandbox works", () => {
    onLinux();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: "0\n" })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "bwrap: No permissions to create new namespace\nsecond line\n" });
    expect(getIsolationStatus()).toBe("unavailable");
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("(bubblewrap: bwrap: No permissions to create new namespace)"));

    resetShellIsolationForTests();
    spawnSyncMock
      .mockReturnValueOnce({ status: null, stdout: null, error: new Error("ENOENT") })
      .mockReturnValueOnce({ status: null, stdout: null, stderr: null, error: new Error("spawnSync bwrap ENOENT") });
    expect(getLandlockAbi()).toBe(0);
    expect(getIsolationBackend()).toBe("none");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("(bubblewrap: spawnSync bwrap ENOENT)"));
    expect(isolateCommand("/bin/sh", ["-lc", "ls"], { readWrite: ["/work"] })).toEqual({ command: "/bin/sh", args: ["-lc", "ls"] });
  });

  it("never probes outside Linux", () => {
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });

    expect(getIsolationStatus()).toBe("unavailable");
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("adds the extra read-only folders it is given, even inside the data dir", () => {
    resetShellIsolationForTests(4);
    const attachments = join(process.env.EIDON_DATA_DIR!, "attachments", "conv_1");

    const { args } = isolateCommand("/bin/sh", ["-lc", "ls"], { readWrite: ["/work/bot"], readOnly: [attachments] });

    expect(bindSources(args, "--ro")).toContain(attachments);
    expect(bindSources(args, "--rw")).not.toContain(attachments);
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
    const readOnly = bindSources(args, "--ro");
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

  it("builds a bubblewrap sandbox from the same rules, without the host's /proc or a writable root", () => {
    resetShellIsolationForTests("bubblewrap");
    symlinks.set("/bin", "usr/bin");
    fakeEntries.set("/proc/kcore", "file");
    fakeEntries.set("/proc/acpi", "dir");
    fakeEntries.set("/sys/firmware", "dir");
    const dataDir = process.env.EIDON_DATA_DIR!;
    const attachments = join(dataDir, "attachments", "conv_1");
    vi.stubEnv("PATH", ["/usr/local/bin", "/bin", "relative/bin", "/proc/self", join(dataDir, "bin")].join(":"));

    const wrapped = isolateCommand("/bin/sh", ["-lc", "ls"], {
      readWrite: ["/work/bot", "/tmp", "/work/bot", "/dev/shm"],
      readOnly: [attachments],
      connectPorts: [4100]
    });

    expect(wrapped.command).toBe("bwrap");
    const args = wrapped.args;
    expect(args.slice(0, 6)).toEqual([
      "--unshare-user",
      "--unshare-pid",
      "--unshare-ipc",
      "--disable-userns",
      "--new-session",
      "--die-with-parent"
    ]);
    const readOnly = bindSources(args, "--ro-bind-try");
    expect(readOnly).toContain("/usr");
    expect(readOnly).toContain(attachments);
    expect(readOnly).not.toContain("/usr/local/bin");
    expect(readOnly).not.toContain("relative/bin");
    expect(readOnly.filter((path) => path.startsWith(dataDir))).toEqual([attachments]);
    expect(args.join(" ")).toContain("--symlink usr/bin /bin");
    const sources = [...readOnly, ...bindSources(args, "--bind-try")];
    expect(sources.some((path) => path === "/proc" || path.startsWith("/proc/") || path.startsWith("/dev"))).toBe(false);
    expect(args.join(" ")).toContain(
      "--proc /proc --dev /dev --tmpfs /proc/acpi --ro-bind /dev/null /proc/kcore --tmpfs /sys/firmware --bind-try"
    );
    expect(args.lastIndexOf("--ro-bind-try")).toBeLessThan(args.indexOf("--bind-try"));
    expect(args.slice(args.indexOf("--bind-try"))).toEqual([
      "--bind-try",
      "/work/bot",
      "/work/bot",
      "--bind-try",
      "/tmp",
      "/tmp",
      "--ro-bind",
      seccompLauncher,
      seccompLauncher,
      "--remount-ro",
      "/",
      "--",
      "python3",
      seccompLauncher,
      "--",
      "/bin/sh",
      "-lc",
      "ls"
    ]);
    expect(args).not.toContain("4100");
  });

  it("lets a bubblewrap sandbox outlive its launcher when it starts a daemon", () => {
    resetShellIsolationForTests("bubblewrap");

    const { args } = isolateCommand("agent-browser", ["open", "about:blank"], { readWrite: ["/work/bot"], keepDaemons: true });

    expect(args).not.toContain("--die-with-parent");
    expect(args.slice(-4)).toEqual(["--", "agent-browser", "open", "about:blank"]);
    expect(args.slice(-7, -4)).toEqual(["--", "python3", seccompLauncher]);
  });
});
