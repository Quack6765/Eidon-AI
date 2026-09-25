import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { executeLocalShellCommand, resolveShellWorkspaceDir, summarizeShellResult } from "@/lib/local-shell";

const dataDir = resolve(process.env.EIDON_DATA_DIR ?? "./.test-data");
const workspaceRoot = `${dataDir}-workspaces`;
const tempDirs: string[] = [];

function removeWorkspaceRoot() {
  rmSync(workspaceRoot, { recursive: true, force: true });
}

describe("shell workspace containment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    removeWorkspaceRoot();
  });

  afterAll(() => {
    removeWorkspaceRoot();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves per-conversation workspaces outside the app root and app data", () => {
    const first = resolveShellWorkspaceDir("conv_first");
    const second = resolveShellWorkspaceDir("conv_second");
    const shared = resolveShellWorkspaceDir();

    expect(basename(workspaceRoot)).toBe(`${basename(dataDir)}-workspaces`);
    expect(basename(first)).toBe("conv_first");
    expect(basename(second)).toBe("conv_second");
    expect(first).not.toBe(second);
    expect(basename(shared)).toBe("shared");
    expect(shared).toBe(resolveShellWorkspaceDir(""));
    expect(first).not.toBe(process.cwd());
    expect(relative(first, process.cwd())).toMatch(/^\.\./);
    expect(relative(dataDir, first)).toMatch(/^\.\./);
    expect(relative(first, dataDir)).toMatch(/^\.\./);
  });

  it("defaults command cwd to the shared workspace instead of the app root", async () => {
    const sharedDir = resolveShellWorkspaceDir();

    const result = await executeLocalShellCommand({ command: "pwd" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(realpathSync(sharedDir));
    expect(result.stdout.trim()).not.toBe(process.cwd());
  });

  it("runs commands in the workspace where app data is not reachable", async () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "eidon.db"), "sqlite-bytes");
    const workspaceDir = resolveShellWorkspaceDir("conv_read");

    const result = await executeLocalShellCommand({
      command: [
        'echo "cwd=$(pwd)"',
        "cat .env 2>/dev/null && echo ENV_REACHED || echo ENV_UNREACHABLE",
        "cat eidon.db 2>/dev/null && echo DB_REACHED || echo DB_UNREACHABLE",
        `cat ${basename(dataDir)}/eidon.db 2>/dev/null && echo DB_REL_REACHED || echo DB_REL_UNREACHABLE`
      ].join("; "),
      cwd: workspaceDir
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`cwd=${realpathSync(workspaceDir)}`);
    expect(result.stdout).toContain("ENV_UNREACHABLE");
    expect(result.stdout).toContain("DB_UNREACHABLE");
    expect(result.stdout).toContain("DB_REL_UNREACHABLE");
    expect(result.stdout).not.toContain("ENV_REACHED");
    expect(result.stdout).not.toContain("DB_REACHED");
    expect(result.stdout).not.toContain("DB_REL_REACHED");
    expect(existsSync(join(dataDir, "eidon.db"))).toBe(true);
    expect(readdirSync(workspaceDir)).toEqual([]);
  });

  it("never passes app secrets to the child process", async () => {
    const result = await executeLocalShellCommand({
      command: "printenv; echo \"extra=$AGENT_BROWSER_SESSION_NAME\"; echo \"leak=[$LEAKED_SECRET]\"",
      env: {
        AGENT_BROWSER_SESSION_NAME: "probe-extra",
        LEAKED_SECRET: "leak-me",
        EIDON_ENCRYPTION_SECRET: "leak-me"
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PATH=");
    expect(result.stdout).toContain("extra=probe-extra");
    expect(result.stdout).toContain("leak=[]");
    expect(result.stdout).not.toContain("leak-me");
    expect(result.stdout).not.toContain("test-session-secret-which-is-long-enough");
    expect(result.stdout).not.toContain("test-encryption-secret-which-is-long-enough");
    expect(result.stdout).not.toContain("changeme123");
    expect(result.stdout).not.toMatch(/^EIDON_/m);
  });

  it("rejects symlinked workspace roots and segments", () => {
    const target = mkdtempSync(join(tmpdir(), "eidon-shell-workspace-target-"));
    tempDirs.push(target);

    const workspaceDir = resolveShellWorkspaceDir("conv_link");
    rmSync(workspaceDir, { recursive: true, force: true });
    symlinkSync(target, workspaceDir);
    expect(() => resolveShellWorkspaceDir("conv_link")).toThrow("unsafe directory link");

    removeWorkspaceRoot();
    symlinkSync(target, workspaceRoot);
    expect(() => resolveShellWorkspaceDir("conv_root")).toThrow("symbolic link");
  });

  it("refuses a workspace tree that would contain app data", () => {
    const base = mkdtempSync(join(tmpdir(), "eidon-shell-overlap-"));
    tempDirs.push(base);
    mkdirSync(join(base, "d-workspaces", "inner"), { recursive: true });
    symlinkSync(join(base, "d-workspaces", "inner"), join(base, "d"));
    vi.stubEnv("EIDON_DATA_DIR", join(base, "d"));

    expect(() => resolveShellWorkspaceDir("conv_overlap")).toThrow("overlaps application data");
  });

  it("kills the whole process tree on timeout and keeps the partial output", async () => {
    const workspaceDir = resolveShellWorkspaceDir("conv_timeout");
    const startedAt = Date.now();

    const result = await executeLocalShellCommand({
      command: "echo before-timeout; sh -c 'echo $$ > sleeper.pid; exec sleep 30' | cat",
      cwd: workspaceDir,
      timeoutMs: 300
    });

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(result.timedOut).toBe(true);
    expect(result.isError).toBe(true);
    expect(summarizeShellResult(result)).toContain("before-timeout");

    const sleeperPid = Number(readFileSync(join(workspaceDir, "sleeper.pid"), "utf8"));
    expect(() => process.kill(sleeperPid, 0)).toThrow();
  }, 10_000);
});
