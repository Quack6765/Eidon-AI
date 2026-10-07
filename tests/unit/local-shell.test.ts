import { EventEmitter } from "node:events";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

class MockStream extends EventEmitter {
  setEncoding = vi.fn();
}

class MockChild extends EventEmitter {
  stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  stdout = new MockStream();
  stderr = new MockStream();
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

  it("runs unrestricted commands and keeps long output for the caller to bound", async () => {
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
    expect(result.stdout).toBe("x".repeat(8_050));
    expect(result.captureTruncated).toBe(false);
    expect(result.stderr).toBe("warning");
    expect(summarizeShellResult(result)).toContain("warning");
  });

  it("caps the captured output of each stream and flags the cut", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({ command: "yes", cwd: "/tmp/eidon" });
    child.stdout.emit("data", "y".repeat(600_000));
    child.stdout.emit("data", "y".repeat(600_000));
    child.emit("close", 0);

    const result = await resultPromise;
    expect(result.stdout).toHaveLength(1_000_000);
    expect(result.captureTruncated).toBe(true);
    expect(child.stdout.setEncoding).toHaveBeenCalledWith("utf8");
    expect(child.stderr.setEncoding).toHaveBeenCalledWith("utf8");
  });

  it("closes stdin, writing the given input first", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const plain = new MockChild();
    spawnMock.mockReturnValueOnce(plain);
    const plainPromise = executeLocalShellCommand({ command: "cat", cwd: "/tmp/eidon" });
    expect(plain.stdin.end).toHaveBeenCalledWith("");
    plain.emit("close", 0);
    await plainPromise;

    const piped = new MockChild();
    spawnMock.mockReturnValueOnce(piped);
    const pipedPromise = executeLocalShellCommand({ command: "python3 -u -", cwd: "/tmp/eidon", stdin: "print(1)" });
    expect(piped.stdin.end).toHaveBeenCalledWith("print(1)");
    piped.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    piped.emit("close", 1);
    await expect(pipedPromise).resolves.toMatchObject({ exitCode: 1, isError: true });
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

  it("gives every command a two-minute default timeout", async () => {
    vi.useFakeTimers();
    const { executeLocalShellCommand, DEFAULT_SHELL_TIMEOUT_MS } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "npm test"
    });

    expect(DEFAULT_SHELL_TIMEOUT_MS).toBe(120_000);
    await vi.advanceTimersByTimeAsync(DEFAULT_SHELL_TIMEOUT_MS - 1);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
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

  it("adds vault secrets to the child environment without letting them replace allowlisted values", async () => {
    const { buildShellEnv } = await import("@/lib/local-shell");
    const shellEnv = buildShellEnv(
      { HOME: "/workspace/home" },
      { GITHUB_TOKEN: "ghp_secret", PATH: "/evil/bin", HOME: "/evil/home" }
    );

    expect(shellEnv.GITHUB_TOKEN).toBe("ghp_secret");
    expect(shellEnv.PATH).toBe(process.env.PATH);
    expect(shellEnv.HOME).toBe("/workspace/home");
    expect(buildShellEnv(undefined, { API_KEY: "key" }).API_KEY).toBe("key");
    expect(buildShellEnv()).not.toHaveProperty("GITHUB_TOKEN");
  });

  it("passes vault secrets to the spawned command", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const resultPromise = executeLocalShellCommand({
      command: "printenv MY_TOKEN",
      env: { AGENT_BROWSER_SESSION: "probe" },
      secretEnv: { MY_TOKEN: "vault-value" }
    });

    const childEnv = spawnMock.mock.calls[0][2].env as Record<string, string>;
    expect(childEnv.MY_TOKEN).toBe("vault-value");
    expect(childEnv.AGENT_BROWSER_SESSION).toBe("probe");
    child.emit("close", 0);
    await resultPromise;
  });

  it("lets a real shell command read a vault secret by its variable", async () => {
    const { executeLocalShellCommand } = await import("@/lib/local-shell");
    const { spawn } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    spawnMock.mockImplementation(spawn);
    vi.stubEnv("SHELL", "/bin/sh");
    try {
      const result = await executeLocalShellCommand({
        command: 'printf %s "$MY_TOKEN"',
        secretEnv: { MY_TOKEN: "s3cr3t value" }
      });

      expect(result).toMatchObject({ exitCode: 0, isError: false });
      expect(result.stdout).toBe("s3cr3t value");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
