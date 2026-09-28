import { spawnSync } from "node:child_process";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { env } from "@/lib/env";
import { isPathInsideRoot } from "@/lib/local-shell";

const REGISTRY_KEY = Symbol.for("eidon.shell-isolation");
const PROBE_TIMEOUT_MS = 5_000;
const SYSTEM_READ_PATHS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt", "/proc", "/sys"];

export type IsolationRules = { readWrite: string[]; connectPorts?: number[] };
export type IsolationStatus = "active" | "filesystem" | "unavailable";

type Registry = { abi: number | null };

function getRegistry() {
  const scope = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };
  scope[REGISTRY_KEY] ??= { abi: null };
  return scope[REGISTRY_KEY];
}

function launcherPath() {
  return join(process.cwd(), "scripts", "landlock-exec.py");
}

function probeLandlockAbi() {
  if (process.platform !== "linux") return 0;
  const probe = spawnSync("python3", [launcherPath(), "--probe"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  const abi = Number.parseInt(probe.stdout?.trim() ?? "", 10);
  if (probe.status === 0 && Number.isInteger(abi) && abi > 0) return abi;
  console.warn(
    "[isolation] Landlock is not available here, so bot shells and the browser run without a filesystem and network sandbox."
  );
  return 0;
}

export function getLandlockAbi() {
  const registry = getRegistry();
  registry.abi ??= probeLandlockAbi();
  return registry.abi;
}

export function getIsolationStatus(): IsolationStatus {
  const abi = getLandlockAbi();
  return abi >= 4 ? "active" : abi >= 1 ? "filesystem" : "unavailable";
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

export function isolateCommand(command: string, args: string[], rules: IsolationRules) {
  if (getLandlockAbi() < 1) return { command, args };
  return {
    command: "python3",
    args: [
      launcherPath(),
      ...readablePaths().flatMap((path) => ["--ro", path]),
      "--dev",
      "/dev",
      "--rw",
      "/dev/shm",
      ...[...new Set(rules.readWrite)].flatMap((path) => ["--rw", path]),
      ...(rules.connectPorts ?? []).flatMap((port) => ["--connect", String(port)]),
      "--",
      command,
      ...args
    ]
  };
}

export function resetShellIsolationForTests(abi: number | null = null) {
  getRegistry().abi = abi;
}
