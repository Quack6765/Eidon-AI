import { spawnSync } from "node:child_process";
import { lstatSync, readlinkSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { env } from "@/lib/env";
import { isPathInsideRoot } from "@/lib/local-shell";

const REGISTRY_KEY = Symbol.for("eidon.shell-isolation");
const PROBE_TIMEOUT_MS = 5_000;
const SYSTEM_READ_PATHS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt", "/proc", "/sys"];
const KERNEL_PATHS = ["/proc", "/dev"];
const BUBBLEWRAP_NAMESPACES = ["--unshare-user", "--unshare-pid", "--unshare-ipc", "--disable-userns", "--new-session"];

export type IsolationRules = { readWrite: string[]; readOnly?: string[]; connectPorts?: number[]; keepDaemons?: boolean };
export type IsolationStatus = "active" | "filesystem" | "unavailable";
export type IsolationBackend = "landlock" | "bubblewrap" | "none";

type Probe = { backend: IsolationBackend; landlockAbi: number };
type Registry = { probe: Probe | null };

function getRegistry() {
  const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  scope[REGISTRY_KEY] ??= { probe: null };
  return scope[REGISTRY_KEY];
}

function launcherPath() {
  return join(process.cwd(), "scripts", "landlock-exec.py");
}

function probeLandlockAbi() {
  const probe = spawnSync("python3", [launcherPath(), "--probe"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  const abi = Number.parseInt(probe.stdout?.trim() ?? "", 10);
  return probe.status === 0 && Number.isInteger(abi) && abi > 0 ? abi : 0;
}

function probeBubblewrapError() {
  const probe = spawnSync(
    "bwrap",
    [...BUBBLEWRAP_NAMESPACES, "--die-with-parent", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--remount-ro", "/", "--", "true"],
    { encoding: "utf8", timeout: PROBE_TIMEOUT_MS }
  );
  if (probe.status === 0) return null;
  return probe.stderr?.trim().split("\n")[0] || probe.error?.message || `exit code ${probe.status}`;
}

function probeIsolation(): Probe {
  if (process.platform !== "linux") return { backend: "none", landlockAbi: 0 };
  const landlockAbi = probeLandlockAbi();
  if (landlockAbi > 0) return { backend: "landlock", landlockAbi };
  const bubblewrapError = probeBubblewrapError();
  if (!bubblewrapError) {
    console.info("[isolation] Landlock is not available here, so bot shells and the browser are sandboxed with bubblewrap.");
    return { backend: "bubblewrap", landlockAbi: 0 };
  }
  console.warn(
    `[isolation] Neither Landlock nor bubblewrap is available here (bubblewrap: ${bubblewrapError}), so bot shells and the browser run without a filesystem and network sandbox. See "Bot sandbox" in docs/configuration.md.`
  );
  return { backend: "none", landlockAbi: 0 };
}

function getProbe() {
  const registry = getRegistry();
  registry.probe ??= probeIsolation();
  return registry.probe;
}

export function getLandlockAbi() {
  return getProbe().landlockAbi;
}

export function getIsolationBackend() {
  return getProbe().backend;
}

export function getIsolationStatus(): IsolationStatus {
  const { backend, landlockAbi } = getProbe();
  if (backend === "landlock") return landlockAbi >= 4 ? "active" : "filesystem";
  return backend === "bubblewrap" ? "filesystem" : "unavailable";
}

function readablePaths() {
  const dataDir = resolve(env.EIDON_DATA_DIR);
  const candidates = [
    ...SYSTEM_READ_PATHS,
    ...(process.env.PATH ?? "").split(delimiter),
    dirname(dirname(process.execPath))
  ];
  return [...new Set(candidates)].filter(
    (path) => isAbsolute(path) && path !== "/" && !isPathInsideRoot(path, dataDir) && !isPathInsideRoot(dataDir, path)
  );
}

function landlockArgs(command: string, args: string[], rules: IsolationRules) {
  return [
    launcherPath(),
    ...[...readablePaths(), ...(rules.readOnly ?? [])].flatMap((path) => ["--ro", path]),
    "--dev",
    "/dev",
    "--rw",
    "/dev/shm",
    ...[...new Set(rules.readWrite)].flatMap((path) => ["--rw", path]),
    ...(rules.connectPorts ?? []).flatMap((port) => ["--connect", String(port)]),
    "--",
    command,
    ...args
  ];
}

function isKernelPath(path: string) {
  return KERNEL_PATHS.some((root) => isPathInsideRoot(path, root));
}

function bubblewrapSystemBinds() {
  const paths = readablePaths().filter((path) => !isKernelPath(path));
  return paths
    .filter((path) => !paths.some((root) => root !== path && isPathInsideRoot(path, root)))
    .flatMap((path) => {
      try {
        return lstatSync(path).isSymbolicLink() ? ["--symlink", readlinkSync(path), path] : ["--ro-bind-try", path, path];
      } catch {
        return [];
      }
    });
}

function bubblewrapBinds(flag: string, paths: string[]) {
  return [...new Set(paths)].filter((path) => !isKernelPath(path)).flatMap((path) => [flag, path, path]);
}

function bubblewrapArgs(command: string, args: string[], rules: IsolationRules) {
  return [
    ...BUBBLEWRAP_NAMESPACES,
    ...(rules.keepDaemons ? [] : ["--die-with-parent"]),
    ...bubblewrapSystemBinds(),
    ...bubblewrapBinds("--ro-bind-try", rules.readOnly ?? []),
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    ...bubblewrapBinds("--bind-try", rules.readWrite),
    "--remount-ro",
    "/",
    "--",
    command,
    ...args
  ];
}

export function isolateCommand(command: string, args: string[], rules: IsolationRules) {
  const backend = getIsolationBackend();
  if (backend === "landlock") return { command: "python3", args: landlockArgs(command, args, rules) };
  if (backend === "bubblewrap") return { command: "bwrap", args: bubblewrapArgs(command, args, rules) };
  return { command, args };
}

export function resetShellIsolationForTests(state: number | "bubblewrap" | null = null) {
  getRegistry().probe =
    state === null
      ? null
      : state === "bubblewrap"
        ? { backend: "bubblewrap", landlockAbi: 0 }
        : { backend: state > 0 ? "landlock" : "none", landlockAbi: state };
}
