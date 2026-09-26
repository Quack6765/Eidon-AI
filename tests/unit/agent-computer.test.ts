import { EventEmitter } from "node:events";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

const { spawnMock, spawnSyncMock, sockets, fetchMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
  sockets: [] as Array<{ url: string; sent: string[] }>,
  fetchMock: vi.fn(async (_url: string) => new Response("Target is closing"))
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock, spawnSync: spawnSyncMock }));

vi.mock("ws", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class FakeSocket extends Emitter {
    sent: string[] = [];
    constructor(public url: string) {
      super();
      sockets.push(this);
      queueMicrotask(() => this.emit("open"));
    }
    send(data: string) {
      this.sent.push(data);
      browserByUrl.get(this.url)?.exitNow();
      queueMicrotask(() => this.emit("close"));
    }
    terminate() {}
  }
  return { default: FakeSocket };
});

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  pid = Math.floor(Math.random() * 10_000) + 1_000;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.signalCode = signal ?? "SIGTERM";
    queueMicrotask(() => this.emit("exit", null, this.signalCode));
    return true;
  });
  exitNow() {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    queueMicrotask(() => this.emit("exit", 0, null));
  }
}

const browserByUrl = new Map<string, FakeProcess>();
const browsers: Array<{ child: FakeProcess; args: string[]; port: number }> = [];
const agentBrowserCalls: Array<{ args: string[]; env: Record<string, string> }> = [];
let nextPort = 41_000;
let agentBrowserFailure: string | null = null;

function fakeSpawn(command: string, args: string[], options: { env?: Record<string, string> }) {
  const child = new FakeProcess();
  if (command === "agent-browser") {
    agentBrowserCalls.push({ args, env: options.env ?? {} });
    const failure = agentBrowserFailure && args[0] === "open" ? agentBrowserFailure : null;
    const socketDir = options.env?.AGENT_BROWSER_SOCKET_DIR;
    if (!failure && socketDir && args[0] === "open") {
      writeFileSync(join(socketDir, "tab.pid"), "999999");
      writeFileSync(join(socketDir, "tab.target"), JSON.stringify({ targetId: `T-${agentBrowserCalls.length}`, pinned: true }));
    }
    queueMicrotask(() => {
      if (failure) child.stderr.emit("data", Buffer.from(failure));
      child.exitCode = failure ? 1 : 0;
      child.emit("exit", child.exitCode, null);
    });
    return child;
  }
  const profileDir = String(args.find((arg) => arg.startsWith("--user-data-dir="))).slice("--user-data-dir=".length);
  const port = nextPort++;
  const wsPath = `/devtools/browser/${port}`;
  browsers.push({ child, args, port });
  browserByUrl.set(`ws://127.0.0.1:${port}${wsPath}`, child);
  setTimeout(() => writeFileSync(join(profileDir, "DevToolsActivePort"), `${port}\n${wsPath}\n`), 5);
  return child;
}

function hasLock(profileDir: string) {
  try {
    lstatSync(join(profileDir, "SingletonLock"));
    return true;
  } catch {
    return false;
  }
}

async function loadModule() {
  return import("@/lib/agent-computer");
}

describe("agent computer browser host", () => {
  let fakeBrowser: string;

  beforeEach(async () => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(fakeSpawn);
    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "" });
    browsers.length = 0;
    agentBrowserCalls.length = 0;
    sockets.length = 0;
    browserByUrl.clear();
    agentBrowserFailure = null;
    const dir = mkdtempSync(join(tmpdir(), "eidon-fake-browser-"));
    fakeBrowser = join(dir, "chromium");
    writeFileSync(fakeBrowser, "#!/bin/sh\n");
    chmodSync(fakeBrowser, 0o755);
    vi.stubEnv("AGENT_BROWSER_EXECUTABLE_PATH", fakeBrowser);
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    (await loadModule()).resetAgentComputerForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(join(fakeBrowser, ".."), { recursive: true, force: true });
  });

  it("shares one browser per user and pins each bot to its own tab", async () => {
    const { botBrowserTarget, getAgentComputerProfileDir, openBrowserSession } = await loadModule();
    const research = botBrowserTarget({ id: "bot-research", userId: "user_a" });
    const writer = botBrowserTarget({ id: "bot-writer", userId: "user_a" });

    const first = await openBrowserSession(research);
    const second = await openBrowserSession(writer);
    const again = await openBrowserSession(research);

    expect(browsers).toHaveLength(1);
    expect(browsers[0].args).toContain(`--user-data-dir=${getAgentComputerProfileDir("user_a")}`);
    expect(browsers[0].args).toContain("--remote-debugging-port=0");
    expect(first).toEqual({
      AGENT_BROWSER_SOCKET_DIR: research.socketDir,
      AGENT_BROWSER_SESSION: "tab",
      AGENT_BROWSER_CDP: String(browsers[0].port),
      AGENT_BROWSER_PIN_TAB: "1"
    });
    expect(second.AGENT_BROWSER_CDP).toBe(first.AGENT_BROWSER_CDP);
    expect(second.AGENT_BROWSER_SOCKET_DIR).toBe(writer.socketDir);
    expect(again).toEqual(first);
    expect(agentBrowserCalls.map((call) => [call.env.AGENT_BROWSER_SOCKET_DIR, ...call.args])).toEqual([
      [research.socketDir, "open", "about:blank"],
      [writer.socketDir, "open", "about:blank"]
    ]);
    expect(agentBrowserCalls.every((call) => call.env.AGENT_BROWSER_CDP === String(browsers[0].port))).toBe(true);
    expect(agentBrowserCalls[0].env.AGENT_BROWSER_PIN_TAB).toBe("1");
  });

  it("keeps different users in different browsers and profiles", async () => {
    const { botBrowserTarget, openBrowserSession, userBrowserTarget } = await loadModule();

    const alice = await openBrowserSession(botBrowserTarget({ id: "bot-a", userId: "user_alice" }));
    const bob = await openBrowserSession(userBrowserTarget("user_bob"));

    expect(browsers).toHaveLength(2);
    expect(alice.AGENT_BROWSER_CDP).not.toBe(bob.AGENT_BROWSER_CDP);
    expect(bob.AGENT_BROWSER_SESSION).toBe("tab");
    expect(browsers[1].args.join(" ")).toContain(join("agent-computer", "user_bob", "profile"));
  });

  it("keeps regular-chat socket paths short however long the user id is", async () => {
    const { userBrowserTarget } = await loadModule();
    const short = userBrowserTarget("u1");
    const long = userBrowserTarget("user_432c1a69-311f-4e66-b18e-22abc05960f3");

    expect(long.socketDir.length).toBe(short.socketDir.length);
    expect(long.socketDir).not.toBe(short.socketDir);
    expect(long.socketDir).toMatch(/users\/[0-9a-f]{12}$/);
  });

  it("rebinds a bot's tab after the browser restarts", async () => {
    const { botBrowserTarget, openBrowserSession } = await loadModule();
    const target = botBrowserTarget({ id: "bot-a", userId: "user_a" });

    await openBrowserSession(target);
    writeFileSync(join(target.socketDir, "tab.stream"), "stale");
    browsers[0].child.exitNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reopened = await openBrowserSession(target);

    expect(browsers).toHaveLength(2);
    expect(reopened.AGENT_BROWSER_CDP).toBe(String(browsers[1].port));
    expect(existsSync(join(target.socketDir, "tab.stream"))).toBe(false);
    expect(JSON.parse(readFileSync(join(target.socketDir, "tab.target"), "utf8")).targetId).toBe("T-2");
    expect(agentBrowserCalls.filter((call) => call.args[0] === "open")).toHaveLength(2);
  });

  it("falls back to agent-browser's own browser when no Chromium is installed", async () => {
    vi.stubEnv("AGENT_BROWSER_EXECUTABLE_PATH", join(tmpdir(), "missing-chromium"));
    const { botBrowserTarget, openBrowserSession, resolveBrowserExecutable } = await loadModule();
    const target = botBrowserTarget({ id: "bot-a", userId: null });

    const opened = await openBrowserSession(target);

    expect(resolveBrowserExecutable()).toBeNull();
    expect(browsers).toHaveLength(0);
    expect(opened).toEqual({ AGENT_BROWSER_SOCKET_DIR: target.socketDir, AGENT_BROWSER_SESSION: "tab" });
    expect(target.ownerKey).toBe("shared");
  });

  it("finds a well-known Chromium when no path is configured", async () => {
    vi.stubEnv("AGENT_BROWSER_EXECUTABLE_PATH", "");
    const { resolveBrowserExecutable } = await loadModule();
    const found = resolveBrowserExecutable();
    expect(found === null || typeof found === "string").toBe(true);
  });

  it("reports a tab that could not be opened", async () => {
    agentBrowserFailure = "net::ERR_FAILED";
    const { botBrowserTarget, openBrowserSession } = await loadModule();

    await expect(openBrowserSession(botBrowserTarget({ id: "bot-a", userId: "user_a" }))).rejects.toThrow(
      "The browser tab could not be opened: net::ERR_FAILED"
    );
  });

  it("only passes the shared browser to non-browser commands once the tab is bound", async () => {
    const { botBrowserTarget, prepareBrowserEnv } = await loadModule();
    const target = botBrowserTarget({ id: "bot-a", userId: "user_a" });

    const before = await prepareBrowserEnv(target, false);
    const launched = await prepareBrowserEnv(target, true);
    const after = await prepareBrowserEnv(target, false);

    expect(before.AGENT_BROWSER_CDP).toBeUndefined();
    expect(existsSync(target.socketDir)).toBe(true);
    expect(after).toEqual(launched);
    expect(browsers).toHaveLength(1);
  });

  it("waits for memory to free up, then gives up with a busy message", async () => {
    vi.stubEnv("EIDON_BROWSER_MEMORY_BUDGET_MB", "600");
    const { BROWSER_BUSY_MESSAGE, botBrowserTarget, closeBrowserSession, openBrowserSession } = await loadModule();
    const first = botBrowserTarget({ id: "bot-a", userId: "user_a" });
    const second = botBrowserTarget({ id: "bot-b", userId: "user_a" });

    await openBrowserSession(first);
    const waiting = openBrowserSession(second);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentBrowserCalls.some((call) => call.env.AGENT_BROWSER_SOCKET_DIR === second.socketDir)).toBe(false);

    await closeBrowserSession(first);
    const opened = await waiting;
    expect(opened.AGENT_BROWSER_SOCKET_DIR).toBe(second.socketDir);
    expect(browsers).toHaveLength(2);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const third = openBrowserSession(botBrowserTarget({ id: "bot-c", userId: "user_a" }));
      const rejection = expect(third).rejects.toThrow(BROWSER_BUSY_MESSAGE);
      await vi.advanceTimersByTimeAsync(61_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes idle tabs and stops the browser gracefully once none are left", async () => {
    const { botBrowserTarget, openBrowserSession, sweepIdleBrowserSessions } = await loadModule();
    const busy = botBrowserTarget({ id: "bot-busy", userId: "user_a" });
    const idle = botBrowserTarget({ id: "bot-idle", userId: "user_a" });
    await openBrowserSession(idle);
    await openBrowserSession(busy);

    const port = browsers[0].port;

    await sweepIdleBrowserSessions(Date.now() + 5 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();

    await sweepIdleBrowserSessions(Date.now() + 11 * 60_000);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      `http://127.0.0.1:${port}/json/close/T-1`,
      `http://127.0.0.1:${port}/json/close/T-2`
    ]);
    expect(agentBrowserCalls.filter((call) => call.args[0] !== "open")).toHaveLength(0);
    expect(sockets).toHaveLength(1);
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ id: 1, method: "Browser.close" });
    expect(browsers[0].child.exitCode).toBe(0);
    expect(browsers[0].child.kill).not.toHaveBeenCalled();
  });

  it("signs a user out everywhere by wiping their profile", async () => {
    const { botBrowserTarget, getAgentComputerProfileDir, openBrowserSession, resetUserBrowser } = await loadModule();
    await openBrowserSession(botBrowserTarget({ id: "bot-a", userId: "user_a" }));
    writeFileSync(join(getAgentComputerProfileDir("user_a"), "Cookies"), "session");

    await resetUserBrowser("user_a");

    expect(existsSync(getAgentComputerProfileDir("user_a"))).toBe(false);
    expect(browsers[0].child.exitCode).toBe(0);
    const reopened = await openBrowserSession(botBrowserTarget({ id: "bot-a", userId: "user_a" }));
    expect(reopened.AGENT_BROWSER_CDP).toBe(String(browsers[1].port));
  });

  it("closes a deleted bot's tab and removes its socket directory", async () => {
    const { botBrowserTarget, closeBrowserSession, openBrowserSession } = await loadModule();
    const target = botBrowserTarget({ id: "bot-a", userId: "user_a" });
    await openBrowserSession(target);

    await closeBrowserSession(target);

    expect(existsSync(target.socketDir)).toBe(false);
    expect(browsers[0].child.exitCode).toBe(0);
  });

  it("stops every browser on shutdown, forcing ones that ignore the close request", async () => {
    const { botBrowserTarget, openBrowserSession, shutdownAgentComputer } = await loadModule();
    await openBrowserSession(botBrowserTarget({ id: "bot-a", userId: "user_a" }));
    browserByUrl.clear();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const stopping = shutdownAgentComputer();
      await vi.advanceTimersByTimeAsync(6_000);
      await stopping;
    } finally {
      vi.useRealTimers();
    }

    expect(browsers[0].child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("kills an orphaned browser still holding the user's profile", async () => {
    const { getAgentComputerProfileDir, botBrowserTarget, openBrowserSession } = await loadModule();
    const profileDir = getAgentComputerProfileDir("user_a");
    mkdirSync(profileDir, { recursive: true });
    symlinkSync(`${hostname()}-424242`, join(profileDir, "SingletonLock"));
    spawnSyncMock.mockReturnValue({ status: 0, stdout: `    1 chromium --user-data-dir=${profileDir} --headless=new` });
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0) throw new Error("ESRCH");
      return true;
    });
    let calls: unknown[][] = [];

    try {
      await openBrowserSession(botBrowserTarget({ id: "bot-a", userId: "user_a" }));
      calls = [...kill.mock.calls];
    } finally {
      kill.mockRestore();
    }

    expect(calls).toContainEqual([424242, "SIGKILL"]);
    expect(hasLock(profileDir)).toBe(false);
  });

  it("leaves an unrelated process alone when the lock's pid was reused", async () => {
    const { getAgentComputerProfileDir, botBrowserTarget, openBrowserSession } = await loadModule();
    const profileDir = getAgentComputerProfileDir("user_a");
    mkdirSync(profileDir, { recursive: true });
    symlinkSync(`${hostname()}-424243`, join(profileDir, "SingletonLock"));
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "node server.cjs" });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let calls: unknown[][] = [];

    try {
      await openBrowserSession(botBrowserTarget({ id: "bot-a", userId: "user_a" }));
      calls = [...kill.mock.calls];
    } finally {
      kill.mockRestore();
    }

    expect(calls).not.toContainEqual([424243, "SIGKILL"]);
    expect(spawnSyncMock).toHaveBeenCalledWith("ps", ["-p", "424243", "-o", "ppid=,command="], { encoding: "utf8" });
    expect(hasLock(profileDir)).toBe(false);
  });

  it("never kills a browser another running server still owns", async () => {
    const { getAgentComputerProfileDir, botBrowserTarget, openBrowserSession } = await loadModule();
    const profileDir = getAgentComputerProfileDir("user_a");
    mkdirSync(profileDir, { recursive: true });
    symlinkSync(`${hostname()}-424244`, join(profileDir, "SingletonLock"));
    spawnSyncMock.mockReturnValue({ status: 0, stdout: `  5123 chromium --user-data-dir=${profileDir} --headless=new` });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let calls: unknown[][] = [];

    try {
      await openBrowserSession(botBrowserTarget({ id: "bot-a", userId: "user_a" }));
      calls = [...kill.mock.calls];
    } finally {
      kill.mockRestore();
    }

    expect(calls).not.toContainEqual([424244, "SIGKILL"]);
    expect(hasLock(profileDir)).toBe(true);
  });

  it("clears a lock left by a container that no longer exists", async () => {
    const { getAgentComputerProfileDir, botBrowserTarget, openBrowserSession } = await loadModule();
    const profileDir = getAgentComputerProfileDir("user_a");
    mkdirSync(profileDir, { recursive: true });
    symlinkSync("21394c2996cf-36", join(profileDir, "SingletonLock"));
    writeFileSync(join(profileDir, "SingletonCookie"), "");

    await openBrowserSession(botBrowserTarget({ id: "bot-a", userId: "user_a" }));

    expect(hasLock(profileDir)).toBe(false);
    expect(existsSync(join(profileDir, "SingletonCookie"))).toBe(false);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("stops a session's daemon by its pid instead of spawning agent-browser", async () => {
    const { botBrowserTarget, closeBrowserSession, openBrowserSession } = await loadModule();
    const target = botBrowserTarget({ id: "bot-a", userId: "user_a" });
    await openBrowserSession(target);
    writeFileSync(join(target.socketDir, "tab.pid"), "424250");
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "    1 /usr/local/bin/agent-browser-linux-arm64" });
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0) throw new Error("ESRCH");
      return true;
    });
    let calls: unknown[][] = [];

    try {
      await closeBrowserSession(target);
      calls = [...kill.mock.calls];
    } finally {
      kill.mockRestore();
    }

    expect(calls).toContainEqual([424250, "SIGTERM"]);
    expect(agentBrowserCalls.filter((call) => call.args[0] !== "open")).toHaveLength(0);
  });

  it("deletes the cookie file every bot used to share", async () => {
    const home = mkdtempSync(join(tmpdir(), "eidon-home-"));
    vi.stubEnv("HOME", home);
    const sessions = join(home, ".agent-browser", "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "bot-bot.json"), "{\"cookies\":[]}");
    writeFileSync(join(sessions, "mine-default.json"), "{}");
    const { removeLegacyBrowserState } = await loadModule();

    removeLegacyBrowserState();

    expect(existsSync(join(sessions, "bot-bot.json"))).toBe(false);
    expect(readFileSync(join(sessions, "mine-default.json"), "utf8")).toBe("{}");
    rmSync(home, { recursive: true, force: true });
  });
});
