import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  boundShellResultSummary,
  executeLocalShellCommand,
  MAX_OUTPUT_CHARS,
  removeToolOutputDir,
  resolveShellWorkspaceDir,
  resolveToolOutputDir,
  summarizeShellResult
} from "@/lib/local-shell";

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
      command: "printenv; echo \"extra=$AGENT_BROWSER_SESSION\"; echo \"leak=[$LEAKED_SECRET]\"",
      env: {
        AGENT_BROWSER_SESSION: "probe-extra",
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

  it("force-kills leftover group members that ignore SIGTERM after a timeout", async () => {
    const workspaceDir = resolveShellWorkspaceDir("conv_timeout_stubborn");

    const result = await executeLocalShellCommand({
      command: "sh -c \"trap '' TERM; echo \\$\\$ > stubborn.pid; exec sleep 30\" >/dev/null 2>&1 & sleep 30",
      cwd: workspaceDir,
      timeoutMs: 300
    });
    expect(result.timedOut).toBe(true);

    const stubbornPid = Number(readFileSync(join(workspaceDir, "stubborn.pid"), "utf8"));
    await vi.waitFor(() => expect(() => process.kill(stubbornPid, 0)).toThrow(), { timeout: 5_000, interval: 100 });
  }, 10_000);
});

describe("long tool output files", () => {
  const outputRoot = join(dataDir, "tool-output");

  afterEach(() => {
    rmSync(outputRoot, { recursive: true, force: true });
  });

  it("returns short output unchanged and writes nothing", () => {
    expect(boundShellResultSummary("short", { conversationId: "conv_short" })).toBe("short");
    expect(existsSync(outputRoot)).toBe(false);
  });

  it("saves long output and returns the note first with the start and end within the inline budget", () => {
    const summary = `${"a".repeat(6_000)}${"b".repeat(6_000)}`;

    const bounded = boundShellResultSummary(summary, { conversationId: "conv_long" });
    const savedPath = /saved to (\S+\.txt)\./.exec(bounded)?.[1] ?? "";

    expect(bounded.startsWith("[Output was 12,000 characters; the full output is saved to ")).toBe(true);
    expect(bounded.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(bounded).toContain("...[truncated]...");
    expect(bounded.endsWith("b")).toBe(true);
    expect(savedPath.startsWith(join(realpathSync(outputRoot), "conv_long"))).toBe(true);
    expect(readFileSync(savedPath, "utf8")).toBe(summary);
  });

  it("says when the capture limit cut the saved output", () => {
    const bounded = boundShellResultSummary("x".repeat(9_000), { conversationId: "conv_cap", captureTruncated: true });

    expect(bounded).toMatch(/^\[Output exceeded 1,000,000 characters per stream; the captured part is saved to /);
  });

  it("keeps the 20 newest output files and leaves other files alone", () => {
    const outputDir = resolveToolOutputDir("conv_prune", true)!;
    for (let index = 0; index < 22; index += 1) {
      writeFileSync(join(outputDir, `${String(1_700_000_000_000 + index)}-0000000${index % 10}.txt`), "old");
    }
    writeFileSync(join(outputDir, "notes.txt"), "keep");

    boundShellResultSummary("y".repeat(9_000), { conversationId: "conv_prune" });

    const files = readdirSync(outputDir).filter((name) => name !== "notes.txt");
    expect(files).toHaveLength(20);
    expect(files).not.toContain("1700000000000-00000000.txt");
    expect(readdirSync(outputDir)).toContain("notes.txt");
  });

  it("refuses a symlinked output folder and falls back to an inline note", () => {
    const outside = mkdtempSync(join(tmpdir(), "eidon-tool-output-"));
    tempDirs.push(outside);
    mkdirSync(outputRoot, { recursive: true });
    symlinkSync(outside, join(outputRoot, "conv_link"));

    expect(() => resolveToolOutputDir("conv_link", true)).toThrow("Tool output directory is not a plain directory");
    const bounded = boundShellResultSummary("z".repeat(9_000), { conversationId: "conv_link" });

    expect(bounded.startsWith("[Output was 9,000 characters; only its start and end are shown.]")).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("removes a conversation's output folder and ignores one that was never created", () => {
    const outputDir = resolveToolOutputDir("conv_remove", true)!;
    writeFileSync(join(outputDir, "1700000000000-00000000.txt"), "saved");

    removeToolOutputDir("conv_remove");
    removeToolOutputDir("conv_never");

    expect(existsSync(outputDir)).toBe(false);
    expect(resolveToolOutputDir("conv_never", false)).toBeNull();
  });
});
