import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { homedir, hostname, tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import { getBotHomeDir, getBotWorkspaceDir, getSharedBotWorkspaceDir } from "@/lib/bot-sandbox";
import { egressProxyEnv, ensureEgressProxy } from "@/lib/egress-proxy";
import { env } from "@/lib/env";
import { buildShellEnv, toPosixSegment } from "@/lib/local-shell";
import { isolateCommand } from "@/lib/shell-isolation";

const REGISTRY_KEY = Symbol.for("eidon.agent-computer");
const MB = 1024 * 1024;
const BROWSER_MEMORY_MB = 500;
const TAB_MEMORY_MB = 120;
const RESERVED_SYSTEM_MB = 1200;
const SESSION_IDLE_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
const BUDGET_WAIT_MS = 60_000;
const LAUNCH_TIMEOUT_MS = 15_000;
const AGENT_BROWSER_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 5_000;
const DISK_CACHE_BYTES = 64 * MB;
const SESSION_NAME = "tab";
const PROFILE_LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

const BROWSER_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
];

export const BROWSER_BUSY_MESSAGE =
  "The shared browser is at its memory limit because other bots are using it. Try again in a minute.";

export class BrowserBusyError extends Error {
  constructor() {
    super(BROWSER_BUSY_MESSAGE);
    this.name = "BrowserBusyError";
  }
}

export type BrowserSessionTarget = {
  ownerKey: string;
  sessionName: string;
  socketDir: string;
  sandbox?: { homeDir: string; readWrite: string[] };
};

type BrowserSession = {
  generation: number;
  lastUsedAt: number;
};

type BrowserHost = {
  profileDir: string;
  child: ChildProcess | null;
  port: number | null;
  wsPath: string | null;
  generation: number;
  sessions: Map<string, BrowserSession>;
  queue: Promise<unknown>;
};

type Registry = {
  hosts: Map<string, BrowserHost>;
  waiters: Set<() => void>;
  sweep: ReturnType<typeof setInterval> | null;
  socketKey: string;
};

function getRegistry() {
  const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  scope[REGISTRY_KEY] ??= { hosts: new Map(), waiters: new Set(), sweep: null, socketKey: randomBytes(32).toString("hex") };
  return scope[REGISTRY_KEY];
}

function socketSegment(value: string) {
  return createHmac("sha256", getRegistry().socketKey).update(value).digest("hex").slice(0, 16);
}

function socketRoot() {
  return join(env.EIDON_DATA_DIR, "runtime", "agent-browser");
}

export function getAgentComputerProfileDir(ownerKey: string) {
  return join(env.EIDON_DATA_DIR, "agent-computer", ownerKey, "profile");
}

export function getBrowserOwnerKey(userId: string | null | undefined) {
  return userId ? toPosixSegment(userId, "user") : "shared";
}

export function getBotBrowserSocketDir(bot: { id: string }) {
  return join(socketRoot(), "bots", socketSegment(`bot:${bot.id}`));
}

export function botBrowserTarget(bot: { id: string; userId: string | null }): BrowserSessionTarget {
  const homeDir = getBotHomeDir(bot);
  return {
    ownerKey: getBrowserOwnerKey(bot.userId),
    sessionName: SESSION_NAME,
    socketDir: getBotBrowserSocketDir(bot),
    sandbox: { homeDir, readWrite: [getBotWorkspaceDir(bot), getSharedBotWorkspaceDir(bot), homeDir] }
  };
}

export function userBrowserTarget(userId: string | null | undefined): BrowserSessionTarget {
  const ownerKey = getBrowserOwnerKey(userId);
  return {
    ownerKey,
    sessionName: SESSION_NAME,
    socketDir: join(socketRoot(), "users", socketSegment(`user:${ownerKey}`))
  };
}

export function sandboxScratchDirs() {
  return [...new Set([process.env.TMPDIR || tmpdir(), "/tmp"])];
}

export function browserSessionEnv(target: BrowserSessionTarget, port?: number | null): Record<string, string> {
  return {
    AGENT_BROWSER_SOCKET_DIR: target.socketDir,
    AGENT_BROWSER_SESSION: target.sessionName,
    ...(port ? { AGENT_BROWSER_CDP: String(port), AGENT_BROWSER_PIN_TAB: "1" } : {})
  };
}

function getHost(ownerKey: string) {
  const registry = getRegistry();
  let host = registry.hosts.get(ownerKey);
  if (!host) {
    host = {
      profileDir: getAgentComputerProfileDir(ownerKey),
      child: null,
      port: null,
      wsPath: null,
      generation: 0,
      sessions: new Map(),
      queue: Promise.resolve()
    };
    registry.hosts.set(ownerKey, host);
  }
  return host;
}

function runExclusive<T>(host: BrowserHost, task: () => Promise<T>): Promise<T> {
  const run = host.queue.catch(() => undefined).then(task);
  host.queue = run.catch(() => undefined);
  return run;
}

function isExecutable(path: string) {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBrowserExecutable() {
  const configured = process.env.AGENT_BROWSER_EXECUTABLE_PATH?.trim();
  if (configured) return isExecutable(configured) ? configured : null;
  return BROWSER_CANDIDATES.find(isExecutable) ?? null;
}

function capacityMb() {
  const configured = env.EIDON_BROWSER_MEMORY_BUDGET_MB;
  if (configured) return configured;
  return Math.max(BROWSER_MEMORY_MB, Math.floor(totalmem() / MB) - RESERVED_SYSTEM_MB);
}

function hostCostMb(host: BrowserHost) {
  if (!host.child) return 0;
  return BROWSER_MEMORY_MB + TAB_MEMORY_MB * Math.max(0, host.sessions.size - 1);
}

function usedMb() {
  let total = 0;
  for (const host of getRegistry().hosts.values()) total += hostCostMb(host);
  return total;
}

function notifyBudget() {
  for (const waiter of [...getRegistry().waiters]) waiter();
}

function fitsBudget(deltaMb: number) {
  return usedMb() + deltaMb <= capacityMb();
}

function waitForBudgetChange(deadline: number) {
  const registry = getRegistry();
  return new Promise<void>((resolve, reject) => {
    const wake = () => {
      finish();
      resolve();
    };
    const timer = setTimeout(() => {
      finish();
      reject(new BrowserBusyError());
    }, Math.max(0, deadline - Date.now()));
    timer.unref?.();
    const finish = () => {
      clearTimeout(timer);
      registry.waiters.delete(wake);
    };
    registry.waiters.add(wake);
  });
}

function readProcess(pid: number) {
  try {
    const command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const parentPid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return { command, parentPid };
  } catch {
    const result = spawnSync("ps", ["-p", String(pid), "-o", "ppid=,command="], { encoding: "utf8" });
    const match = result.status === 0 ? /^\s*(\d+)\s+(.*)$/s.exec(result.stdout) : null;
    return match ? { command: match[2], parentPid: Number(match[1]) } : null;
  }
}

function waitForProcessExit(pid: number, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    const started = Date.now();
    const poll = () => {
      try {
        process.kill(pid, 0);
      } catch {
        return resolve();
      }
      if (Date.now() - started > timeoutMs) return resolve();
      setTimeout(poll, 50);
    };
    poll();
  });
}

async function releaseStaleProfileLock(profileDir: string) {
  let lock: string;
  try {
    lock = readlinkSync(join(profileDir, "SingletonLock"));
  } catch {
    return;
  }
  const separator = lock.lastIndexOf("-");
  const pid = Number(lock.slice(separator + 1));
  if (lock.slice(0, separator) === hostname() && Number.isInteger(pid) && pid > 0) {
    const holder = readProcess(pid);
    if (holder?.command.includes(`--user-data-dir=${profileDir}`)) {
      if (holder.parentPid !== 1) return;
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
      await waitForProcessExit(pid, STOP_GRACE_MS);
    }
  }
  for (const name of PROFILE_LOCK_FILES) rmSync(join(profileDir, name), { force: true });
}

function readDevToolsActivePort(profileDir: string) {
  try {
    const [port, path] = readFileSync(join(profileDir, "DevToolsActivePort"), "utf8").split("\n");
    const parsed = Number(port);
    return Number.isInteger(parsed) && parsed > 0 && path ? { port: parsed, path: path.trim() } : null;
  } catch {
    return null;
  }
}

function waitForDevTools(host: BrowserHost, child: ChildProcess) {
  return new Promise<{ port: number; path: string } | null>((resolve) => {
    const started = Date.now();
    const poll = () => {
      const active = readDevToolsActivePort(host.profileDir);
      if (active) return resolve(active);
      if (child.exitCode !== null || child.signalCode !== null || Date.now() - started > LAUNCH_TIMEOUT_MS) {
        return resolve(null);
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

function browserArgs(profileDir: string, proxyPort: number) {
  return [
    `--proxy-server=http://127.0.0.1:${proxyPort}`,
    "--proxy-bypass-list=<-loopback>",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--headless=new",
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,800",
    `--disk-cache-size=${DISK_CACHE_BYTES}`,
    ...(process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
    "about:blank"
  ];
}

async function launchBrowser(host: BrowserHost) {
  const executable = resolveBrowserExecutable();
  if (!executable) return null;

  mkdirSync(host.profileDir, { recursive: true, mode: 0o700 });
  await releaseStaleProfileLock(host.profileDir);
  rmSync(join(host.profileDir, "DevToolsActivePort"), { force: true });

  const proxyPort = await ensureEgressProxy();
  const homeDir = join(dirname(host.profileDir), "home");
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  const browser = isolateCommand(executable, browserArgs(host.profileDir, proxyPort), {
    readWrite: [host.profileDir, homeDir, ...sandboxScratchDirs()],
    connectPorts: [proxyPort]
  });
  const child = spawn(browser.command, browser.args, { stdio: "ignore", env: buildShellEnv({ HOME: homeDir }) });
  host.child = child;
  host.generation += 1;
  child.on("error", () => undefined);
  child.on("exit", () => {
    if (host.child !== child) return;
    host.child = null;
    host.port = null;
    host.wsPath = null;
    notifyBudget();
  });

  const active = await waitForDevTools(host, child);
  if (!active) {
    child.kill("SIGKILL");
    throw new Error("The browser did not start.");
  }
  host.port = active.port;
  host.wsPath = active.path;
  ensureSweep();
  return active.port;
}

type AgentBrowserResult = { ok: boolean; output: string };

function runAgentBrowser(target: BrowserSessionTarget, args: string[], port?: number | null) {
  mkdirSync(target.socketDir, { recursive: true });
  return new Promise<AgentBrowserResult>((resolve) => {
    let output = "";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, output: output.trim() });
    };
    const daemon =
      target.sandbox && port
        ? isolateCommand("agent-browser", args, {
            readWrite: [...target.sandbox.readWrite, target.socketDir, ...sandboxScratchDirs()],
            connectPorts: [port]
          })
        : { command: "agent-browser", args };
    const child = spawn(daemon.command, daemon.args, {
      env: buildShellEnv({ ...browserSessionEnv(target, port), ...(target.sandbox ? { HOME: target.sandbox.homeDir } : {}) }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-4_000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => {
      output = error.message;
      finish(false);
    });
    child.on("exit", (code) => finish(code === 0));
    const timer = setTimeout(() => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
      finish(false);
    }, AGENT_BROWSER_TIMEOUT_MS);
    timer.unref?.();
  });
}

export function runBrowserSessionCommand(target: BrowserSessionTarget, args: string[]) {
  return runAgentBrowser(target, args, getRegistry().hosts.get(target.ownerKey)?.port ?? null);
}

async function stopSessionDaemon(target: BrowserSessionTarget) {
  let pid = 0;
  try {
    pid = Number(readFileSync(join(target.socketDir, `${target.sessionName}.pid`), "utf8").trim());
  } catch {}
  if (Number.isInteger(pid) && pid > 0 && readProcess(pid)?.command.includes("agent-browser")) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
    await waitForProcessExit(pid, STOP_GRACE_MS);
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  rmSync(target.socketDir, { recursive: true, force: true });
  mkdirSync(target.socketDir, { recursive: true });
}

function readBoundTargetId(target: BrowserSessionTarget) {
  try {
    const bound = JSON.parse(readFileSync(join(target.socketDir, `${target.sessionName}.target`), "utf8")) as {
      targetId?: unknown;
    };
    return typeof bound.targetId === "string" ? bound.targetId : null;
  } catch {
    return null;
  }
}

async function openSessionWindow(host: BrowserHost, target: BrowserSessionTarget, port: number) {
  if (!host.wsPath) return;
  const created = await sendBrowserCommand(port, host.wsPath, "Target.createTarget", { url: "about:blank", newWindow: true });
  if (typeof created?.targetId !== "string") return;
  writeFileSync(
    join(target.socketDir, `${target.sessionName}.target`),
    JSON.stringify({ targetId: created.targetId, url: "about:blank", pinned: true }),
    { mode: 0o600 }
  );
}

async function bindSession(host: BrowserHost, target: BrowserSessionTarget, port: number) {
  const previousTargetId = readBoundTargetId(target);
  if (previousTargetId) {
    await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(previousTargetId)}`).catch(() => undefined);
  }
  await stopSessionDaemon(target);
  await openSessionWindow(host, target, port);
  const result = await runAgentBrowser(target, ["open", "about:blank"], port);
  if (!result.ok) {
    throw new Error(`The browser tab could not be opened: ${result.output || "unknown error"}`);
  }
}

async function tryOpenSession(host: BrowserHost, target: BrowserSessionTarget) {
  if (!host.port) {
    if (!resolveBrowserExecutable()) return browserSessionEnv(target);
    if (!fitsBudget(BROWSER_MEMORY_MB)) return null;
  }
  const port = host.port ?? (await launchBrowser(host));
  if (!port) return browserSessionEnv(target);

  const session = host.sessions.get(target.socketDir);
  if (session && session.generation === host.generation && isDaemonRunning(target.socketDir)) {
    session.lastUsedAt = Date.now();
    return browserSessionEnv(target, port);
  }
  if (!session && host.sessions.size > 0 && !fitsBudget(TAB_MEMORY_MB)) return null;
  await bindSession(host, target, port);
  host.sessions.set(target.socketDir, { generation: host.generation, lastUsedAt: Date.now() });
  return browserSessionEnv(target, port);
}

export async function openBrowserSession(target: BrowserSessionTarget) {
  const host = getHost(target.ownerKey);
  const deadline = Date.now() + BUDGET_WAIT_MS;
  for (;;) {
    const opened = await runExclusive(host, () => tryOpenSession(host, target));
    if (opened) return opened;
    await waitForBudgetChange(deadline);
  }
}

export function touchBrowserSession(target: BrowserSessionTarget) {
  const session = getRegistry().hosts.get(target.ownerKey)?.sessions.get(target.socketDir);
  if (session) session.lastUsedAt = Date.now();
}

export async function prepareBrowserEnv(target: BrowserSessionTarget, launch: boolean) {
  mkdirSync(target.socketDir, { recursive: true });
  if (launch) return openBrowserSession(target);
  const host = getHost(target.ownerKey);
  const session = host.sessions.get(target.socketDir);
  const bound = host.port && session?.generation === host.generation;
  return browserSessionEnv(target, bound ? host.port : null);
}

async function closeSession(host: BrowserHost, target: BrowserSessionTarget) {
  const targetId = readBoundTargetId(target);
  if (host.port && targetId) {
    await fetch(`http://127.0.0.1:${host.port}/json/close/${encodeURIComponent(targetId)}`).catch(() => undefined);
  }
  await stopSessionDaemon(target);
  host.sessions.delete(target.socketDir);
  notifyBudget();
}

function sendBrowserCommand(port: number, wsPath: string, method: string, params?: Record<string, unknown>) {
  return new Promise<Record<string, unknown> | null>((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    let result: Record<string, unknown> | null = null;
    const done = () => {
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      socket.terminate();
      done();
    }, STOP_GRACE_MS);
    timer.unref?.();
    socket.on("open", () => socket.send(JSON.stringify({ id: 1, method, ...(params ? { params } : {}) })));
    socket.on("message", (raw: WebSocket.RawData) => {
      try {
        const reply = JSON.parse(raw.toString()) as { id?: number; result?: Record<string, unknown> };
        if (reply.id !== 1) return;
        result = reply.result ?? null;
      } catch {
        return;
      }
      socket.close();
    });
    socket.on("close", done);
    socket.on("error", done);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopBrowser(host: BrowserHost) {
  const child = host.child;
  if (!child) return;
  if (host.port && host.wsPath) await sendBrowserCommand(host.port, host.wsPath, "Browser.close");
  if (!(await waitForExit(child, STOP_GRACE_MS))) {
    child.kill("SIGTERM");
    if (!(await waitForExit(child, STOP_GRACE_MS))) child.kill("SIGKILL");
  }
}

export async function closeBrowserSession(target: BrowserSessionTarget) {
  const host = getHost(target.ownerKey);
  await runExclusive(host, async () => {
    await closeSession(host, target);
    if (host.sessions.size === 0) await stopBrowser(host);
  });
  rmSync(target.socketDir, { recursive: true, force: true });
}

export async function resetUserBrowser(ownerKey: string) {
  const host = getHost(ownerKey);
  await runExclusive(host, async () => {
    for (const socketDir of [...host.sessions.keys()]) {
      await closeSession(host, { ownerKey, sessionName: SESSION_NAME, socketDir });
    }
    await stopBrowser(host);
    rmSync(join(env.EIDON_DATA_DIR, "agent-computer", ownerKey), { recursive: true, force: true });
  });
}

export async function sweepIdleBrowserSessions(now = Date.now()) {
  for (const [ownerKey, host] of getRegistry().hosts) {
    await runExclusive(host, async () => {
      for (const [socketDir, session] of [...host.sessions]) {
        if (now - session.lastUsedAt < SESSION_IDLE_MS) continue;
        await closeSession(host, { ownerKey, sessionName: SESSION_NAME, socketDir });
      }
      if (host.sessions.size === 0) await stopBrowser(host);
    });
  }
}

function ensureSweep() {
  const registry = getRegistry();
  if (registry.sweep) return;
  registry.sweep = setInterval(() => void sweepIdleBrowserSessions().catch(() => undefined), SWEEP_INTERVAL_MS);
  registry.sweep.unref?.();
}

export async function shutdownAgentComputer() {
  const registry = getRegistry();
  if (registry.sweep) clearInterval(registry.sweep);
  registry.sweep = null;
  await Promise.all([...registry.hosts.values()].map((host) => runExclusive(host, () => stopBrowser(host))));
}

function isDaemonRunning(socketDir: string) {
  try {
    const pid = Number(readFileSync(join(socketDir, `${SESSION_NAME}.pid`), "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function removeLegacyBrowserState() {
  for (const name of ["bot-bot.json", "bot-bot.json.enc"]) {
    rmSync(join(homedir(), ".agent-browser", "sessions", name), { force: true });
  }
  for (const group of ["bots", "users"]) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(socketRoot(), group));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const socketDir = join(socketRoot(), group, entry);
      if (!isDaemonRunning(socketDir)) rmSync(socketDir, { recursive: true, force: true });
    }
  }
}

export function resetAgentComputerForTests() {
  const registry = getRegistry();
  if (registry.sweep) clearInterval(registry.sweep);
  registry.hosts.clear();
  registry.waiters.clear();
  registry.sweep = null;
}
