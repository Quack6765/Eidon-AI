import { readFileSync } from "node:fs";
import { totalmem } from "node:os";

const MB = 1024 * 1024;
const UNLIMITED_CGROUP_BYTES = 2 ** 60;

const CGROUP_LIMIT_PATHS = [
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory/memory.limit_in_bytes"
];

function parseCgroupLimitMb(raw: string) {
  const value = raw.trim();
  if (!value || value === "max") return null;
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes >= UNLIMITED_CGROUP_BYTES) return null;
  return Math.floor(bytes / MB);
}

export function cgroupMemoryLimitMb() {
  for (const path of CGROUP_LIMIT_PATHS) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const limitMb = parseCgroupLimitMb(raw);
    if (limitMb !== null) return limitMb;
  }
  return null;
}

export function availableMemoryMb() {
  const hostMb = Math.floor(totalmem() / MB);
  const cgroupMb = cgroupMemoryLimitMb();
  return cgroupMb === null ? hostMb : Math.min(hostMb, cgroupMb);
}