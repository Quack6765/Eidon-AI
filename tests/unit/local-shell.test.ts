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

  it("rejects empty commands", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");

    await expect(
      executeLocalShellCommand({
        command: "   "
      })
    ).rejects.toThrow("Shell command is required");
  });

  it("runs unrestricted commands and truncates long output", async () => {
    const { executeLocalShellCommand, summarizeShellResult } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "curl https://example.com && git diff",
      cwd: "/tmp/eidon"
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expectedInitialShell,
      ["-lc", "curl https://example.com && git diff"],
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

  it("allows shell redirection and compound commands", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: 'echo "hello" > /tmp/temp_hello.txt && echo "File created successfully"'
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expectedInitialShell,
      ["-lc", 'echo "hello" > /tmp/temp_hello.txt && echo "File created successfully"'],
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

  it("falls back to /bin/sh when SHELL is unavailable", async () => {
    delete process.env.SHELL;

    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "git status"
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
      command: "git status"
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

  it("uses a relative SHELL command name as-is", async () => {
    process.env.SHELL = "zsh";

    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "git status"
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "zsh",
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
      command: "git status"
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

  it("preserves prior stderr output when spawn fails", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "git status"
    });

    child.stderr.emit("data", "permission warning");
    child.emit("error", new Error("spawn zsh ENOENT"));

    await expect(resultPromise).resolves.toMatchObject({
      stderr: "permission warning\nspawn zsh ENOENT",
      exitCode: null,
      timedOut: false,
      isError: true
    });
  });

  it("ignores duplicate completion events after the command has already settled", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "git status"
    });

    child.emit("error", new Error("spawn zsh ENOENT"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toMatchObject({
      stdout: "",
      stderr: "spawn zsh ENOENT",
      exitCode: null,
      timedOut: false,
      isError: true
    });
  });

  it("marks timed out commands as errors and summarizes empty output states", async () => {
    vi.useFakeTimers();
    const { executeLocalShellCommand, summarizeShellResult } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const timedOutPromise = executeLocalShellCommand({
      command: "git status",
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
