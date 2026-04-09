import { EventEmitter } from "node:events";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

class MockChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe("local shell", () => {
  const originalShell = process.env.SHELL;
  const expectedInitialShell = originalShell?.trim() || "/bin/sh";
  const restoreShellEnv = () => {
    if (originalShell === undefined) {
      delete process.env.SHELL;
      return;
    }

    process.env.SHELL = originalShell;
  };

  beforeEach(() => {
    spawnMock.mockReset();
    vi.useRealTimers();
    restoreShellEnv();
  });

  afterAll(() => {
    restoreShellEnv();
  });

  it("rejects empty, unsafe, and disallowed commands", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");

    await expect(
      executeLocalShellCommand({
        command: "   ",
        allowedPrefixes: ["git"]
      })
    ).rejects.toThrow("Shell command is required");

    await expect(
      executeLocalShellCommand({
        command: "git status | cat",
        allowedPrefixes: ["git"]
      })
    ).rejects.toThrow("Shell command contains unsupported operators");

    await expect(
      executeLocalShellCommand({
        command: "git status && npm test",
        allowedPrefixes: ["git"]
      })
    ).rejects.toThrow("Shell command is not permitted for the loaded skills");
  });

  it("runs allowed commands and truncates long output", async () => {
    const { executeLocalShellCommand, summarizeShellResult } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "git status && git diff",
      allowedPrefixes: ["git"],
      cwd: "/tmp/eidon"
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expectedInitialShell,
      ["-lc", "git status && git diff"],
      expect.objectContaining({
        cwd: "/tmp/eidon",
        env: process.env
      })
    );

    child.stdout.emit("data", `${"x".repeat(8_050)}\n`);
    child.stderr.emit("data", "warning");
    child.emit("close", 0);

    const result = await resultPromise;

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.isError).toBe(false);
    expect(result.stdout.endsWith("...[truncated]")).toBe(true);
    expect(result.stderr).toBe("warning");
    expect(summarizeShellResult(result)).toContain("warning");
  });

  it("falls back to /bin/sh when SHELL is unavailable", async () => {
    delete process.env.SHELL;

    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "git status",
      allowedPrefixes: ["git"]
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "/bin/sh",
      ["-lc", "git status"],
      expect.objectContaining({
        cwd: process.cwd(),
        env: process.env
      })
    );

    child.emit("close", 0);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 0,
      timedOut: false,
      isError: false
    });
  });

  it("falls back to /bin/sh when SHELL points to a missing binary", async () => {
    process.env.SHELL = "/missing/zsh";

    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "git status",
      allowedPrefixes: ["git"]
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "/bin/sh",
      ["-lc", "git status"],
      expect.objectContaining({
        cwd: process.cwd(),
        env: process.env
      })
    );

    child.emit("close", 0);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 0,
      timedOut: false,
      isError: false
    });
  });

  it("returns a structured error when spawn fails before close", async () => {
    const { executeLocalShellCommand, summarizeShellResult } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "git status",
      allowedPrefixes: ["git"]
    });

    child.emit("error", new Error("spawn zsh ENOENT"));

    await expect(resultPromise).resolves.toMatchObject({
      stdout: "",
      stderr: "spawn zsh ENOENT",
      exitCode: null,
      timedOut: false,
      isError: true
    });
    expect(
      summarizeShellResult({
        stdout: "",
        stderr: "spawn zsh ENOENT",
        exitCode: null,
        timedOut: false,
        isError: true
      })
    ).toBe("spawn zsh ENOENT");
  });

  it("marks timed out commands as errors and summarizes empty output states", async () => {
    vi.useFakeTimers();
    const { executeLocalShellCommand, summarizeShellResult } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const timedOutPromise = executeLocalShellCommand({
      command: "git status",
      allowedPrefixes: ["git"],
      timeoutMs: 5
    });

    await vi.advanceTimersByTimeAsync(5);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);

    const timedOut = await timedOutPromise;

    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.isError).toBe(true);
    expect(summarizeShellResult(timedOut)).toBe("Command timed out");

    expect(
      summarizeShellResult({
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        isError: false
      })
    ).toBe("Command completed with no output");

    expect(
      summarizeShellResult({
        stdout: "",
        stderr: "",
        exitCode: 1,
        timedOut: false,
        isError: true
      })
    ).toBe("Command failed with no output");
  });
});
