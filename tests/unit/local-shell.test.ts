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

  it("starts sandboxed commands through the Landlock launcher in their own process group", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const { resetShellIsolationForTests } = await import("@/lib/shell-isolation");
    resetShellIsolationForTests(4);
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "ls",
      cwd: "/tmp/eidon",
      isolation: { readWrite: ["/tmp/eidon"], connectPorts: [4100] }
    });

    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe("python3");
    expect(args.slice(-8)).toEqual(["--rw", "/tmp/eidon", "--connect", "4100", "--", expectedInitialShell, "-lc", "ls"]);
    expect(options).toEqual(expect.objectContaining({ cwd: "/tmp/eidon", detached: process.platform !== "win32" }));
    child.emit("close", 0);
    await resultPromise;
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
        env: expect.any(Object)
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
        cwd: expect.stringContaining(".test-data-workspaces")
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
        cwd: expect.stringContaining(".test-data-workspaces")
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
        cwd: expect.stringContaining(".test-data-workspaces")
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
        cwd: expect.stringContaining(".test-data-workspaces")
      })
    );

    child.emit("close", 0);

    await expect(resultPromise).resolves.toMatchObject({
      exitCode: 0,
      timedOut: false,
      isError: false
    });
  });

  it("labels direct and wrapped agent-browser commands as Web browser", async () => {
    const { getShellCommandLabel } = await import("@/lib/local-shell");

    expect(getShellCommandLabel("agent-browser open https://example.com")).toBe("Web browser");
    expect(getShellCommandLabel("npx agent-browser open https://example.com")).toBe("Web browser");
    expect(getShellCommandLabel("pnpm exec agent-browser open https://example.com")).toBe("Web browser");
    expect(getShellCommandLabel('FOO="a b" agent-browser open https://example.com')).toBe("Web browser");
    expect(getShellCommandLabel("env FOO=1 agent-browser open https://example.com")).toBe("Web browser");
    expect(getShellCommandLabel("/usr/local/bin/agent-browser open https://example.com")).toBe("Web browser");
    expect(getShellCommandLabel("sleep 3 && agent-browser snapshot")).toBe("Web browser");
    expect(getShellCommandLabel("sleep 3 && ./agent-browser snapshot")).toBe("Web browser");
  });

  it("keeps non-invocation agent-browser text labeled as Local command", async () => {
    const { getShellCommandLabel } = await import("@/lib/local-shell");

    expect(getShellCommandLabel("echo agent-browser open https://example.com")).toBe("Local command");
    expect(getShellCommandLabel("printf 'agent-browser snapshot'")).toBe("Local command");
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

  it("escalates a timed out command to SIGKILL and keeps its partial output", async () => {
    vi.useFakeTimers();
    const { executeLocalShellCommand, summarizeShellResult } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "npm test",
      timeoutMs: 5
    });

    child.stdout.emit("data", "3 passing");
    await vi.advanceTimersByTimeAsync(5);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    const result = await resultPromise;
    expect(summarizeShellResult(result)).toBe("Command timed out\n\n3 passing");
    expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("caps requested timeouts at ten minutes", async () => {
    vi.useFakeTimers();
    const { executeLocalShellCommand, MAX_SHELL_TIMEOUT_MS } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "sleep 99999",
      timeoutMs: 24 * 60 * 60_000
    });

    await vi.advanceTimersByTimeAsync(MAX_SHELL_TIMEOUT_MS - 1);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);
    await expect(resultPromise).resolves.toMatchObject({ timedOut: true });
  });

  it("aborts an active command and terminates its process group", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);
    const controller = new AbortController();

    const resultPromise = executeLocalShellCommand({
      command: "long-running-command",
      abortSignal: controller.signal
    });

    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("close", null);
  });

  it("gives agent-browser commands a longer default timeout", async () => {
    vi.useFakeTimers();
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "agent-browser screenshot /tmp/example.png --full"
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(90_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.emit("close", null);

    await expect(resultPromise).resolves.toMatchObject({
      timedOut: true,
      isError: true
    });
  });
});

describe("shell environment scrubbing", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("spawns with a minimal allowlisted environment and no app secrets", async () => {
    const { SHELL_ENV_ALLOWLIST, SHELL_ENV_EXTRA_ALLOWLIST, executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "printenv",
      env: {
        AGENT_BROWSER_SESSION: "probe",
        EIDON_SESSION_SECRET: "leak",
        EIDON_ENCRYPTION_SECRET: "leak",
        EIDON_ADMIN_PASSWORD: "leak",
        EIDON_GITHUB_APP_CLIENT_SECRET: "leak",
        AWS_SECRET_ACCESS_KEY: "leak"
      }
    });

    const childEnv = spawnMock.mock.calls[0][2].env as Record<string, string>;
    const allowedNames: readonly string[] = [...SHELL_ENV_ALLOWLIST, ...SHELL_ENV_EXTRA_ALLOWLIST];
    for (const name of Object.keys(childEnv)) {
      expect(allowedNames).toContain(name);
    }
    expect(childEnv.AGENT_BROWSER_SESSION).toBe("probe");
    expect(childEnv.PATH).toBe(process.env.PATH);
    for (const name of [
      "EIDON_SESSION_SECRET",
      "EIDON_ENCRYPTION_SECRET",
      "EIDON_ADMIN_PASSWORD",
      "EIDON_GITHUB_APP_CLIENT_SECRET",
      "EIDON_GITHUB_APP_CLIENT_ID",
      "EIDON_GITHUB_APP_CALLBACK_URL",
      "EIDON_DATA_DIR",
      "AWS_SECRET_ACCESS_KEY"
    ]) {
      expect(childEnv).not.toHaveProperty(name);
    }

    child.emit("close", 0);
    await resultPromise;
  });

  it("passes the Chromium path agent-browser needs from the server environment", async () => {
    const { buildShellEnv } = await import("@/lib/local-shell");
    vi.stubEnv("AGENT_BROWSER_EXECUTABLE_PATH", "/usr/bin/chromium");
    try {
      expect(buildShellEnv().AGENT_BROWSER_EXECUTABLE_PATH).toBe("/usr/bin/chromium");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("builds child environments from the allowlist only", async () => {
    const { SHELL_ENV_ALLOWLIST, SHELL_ENV_EXTRA_ALLOWLIST, buildShellEnv } = await import("@/lib/local-shell");
    const shellEnv = buildShellEnv({
      HOME: "/somewhere/else",
      HTTPS_PROXY: "http://127.0.0.1:4100",
      PATH: "/evil/bin",
      EIDON_SESSION_SECRET: "leaked"
    });

    expect(shellEnv.HOME).toBe("/somewhere/else");
    expect(shellEnv.HTTPS_PROXY).toBe("http://127.0.0.1:4100");
    expect(shellEnv.PATH).toBe(process.env.PATH);
    expect(buildShellEnv().HOME).toBe(process.env.HOME);
    for (const name of ["EIDON_SESSION_SECRET", "EIDON_ENCRYPTION_SECRET", "EIDON_ADMIN_PASSWORD", "EIDON_GITHUB_APP_CLIENT_SECRET"]) {
      expect(shellEnv).not.toHaveProperty(name);
    }
    for (const name of Object.keys(shellEnv)) {
      expect([...SHELL_ENV_ALLOWLIST, ...SHELL_ENV_EXTRA_ALLOWLIST] as readonly string[]).toContain(name);
    }
  });
});
