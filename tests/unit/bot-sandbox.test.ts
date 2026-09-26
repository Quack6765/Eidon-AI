import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, afterAll } from "vitest";

import { executeLocalShellCommand } from "@/lib/local-shell";
import {
  getBotTeamWorkspacesDir,
  getBotWorkspaceDir,
  getSharedBotWorkspaceDir,
  listBotWorkspaceTree,
  resolveBotSandbox,
  resolveBotWorkspaceFile
} from "@/lib/bot-sandbox";

const sandboxBot = { id: "bot_sandbox_probe", userId: "user_sandbox_probe" };
const tempDirs: string[] = [];

describe("bot-sandbox", () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves a per-bot workspace used as the shell's working directory", () => {
    const sandbox = resolveBotSandbox(sandboxBot);

    expect(sandbox.cwd).toBe(sandbox.workspaceDir);
    expect(sandbox.workspaceDir).toContain(join("bot-workspaces"));
    expect(existsSync(sandbox.workspaceDir)).toBe(true);
  });

  it("gives different bots different workspaces", () => {
    const left = resolveBotSandbox({ id: "bot_left", userId: "user_x" });
    const right = resolveBotSandbox({ id: "bot_right", userId: "user_x" });
    expect(left.workspaceDir).not.toBe(right.workspaceDir);
  });

  it("returns an empty tree when the workspace does not exist", () => {
    const tree = listBotWorkspaceTree({ id: "bot_never_created", userId: "user_none" });
    expect(tree.children).toEqual([]);
  });

  it("lists the workspace as a nested tree rooted at the workspace folder", () => {
    const sandbox = resolveBotSandbox(sandboxBot);
    writeFileSync(join(sandbox.workspaceDir, "notes.txt"), "hello");
    mkdirSync(join(sandbox.workspaceDir, "reports"));
    writeFileSync(join(sandbox.workspaceDir, "reports", "june.md"), "# June");

    const tree = listBotWorkspaceTree(sandboxBot);
    expect(tree.isDirectory).toBe(true);
    expect(tree.path).toBe("");
    expect(tree.name).toBe(basename(sandbox.workspaceDir));
    const names = tree.children.map((node) => node.name);
    expect(names).toEqual(["reports", "notes.txt"]);

    const reports = tree.children[0];
    expect(reports.isDirectory).toBe(true);
    expect(reports.path).toBe("reports");
    expect(reports.children.map((node) => node.name)).toEqual(["june.md"]);

    const notes = tree.children[1];
    expect(notes.byteSize).toBe(5);
    expect(notes.isDirectory).toBe(false);
    expect(notes.path).toBe("notes.txt");
  });

  it("puts every bot of an owner and their shared workspace under one team folder", () => {
    const left = { id: "bot_team_left", userId: "user_team" };
    const right = { id: "bot_team_right", userId: "user_team" };
    const stranger = { id: "bot_team_stranger", userId: "user_other" };

    expect(getBotWorkspaceDir(left).startsWith(`${getBotTeamWorkspacesDir(left)}/`)).toBe(true);
    expect(getSharedBotWorkspaceDir(left)).toBe(join(getBotTeamWorkspacesDir(left), "shared"));
    expect(getSharedBotWorkspaceDir(right)).toBe(getSharedBotWorkspaceDir(left));
    expect(getSharedBotWorkspaceDir(stranger)).not.toBe(getSharedBotWorkspaceDir(left));
    expect(getSharedBotWorkspaceDir({ userId: null })).toBe(join(getBotTeamWorkspacesDir({ userId: null }), "shared"));
  });

  it("creates the shared workspace alongside the bot workspace", () => {
    resolveBotSandbox(sandboxBot);
    expect(existsSync(getSharedBotWorkspaceDir(sandboxBot))).toBe(true);
  });

  it("describes files with their kind and mime type and lists the shared workspace", () => {
    const sandbox = resolveBotSandbox(sandboxBot);
    writeFileSync(join(sandbox.workspaceDir, "chart.png"), "png");
    writeFileSync(join(sandbox.workspaceDir, "data.bin"), "bin");
    writeFileSync(join(getSharedBotWorkspaceDir(sandboxBot), "handoff.md"), "# Handoff");

    const tree = listBotWorkspaceTree(sandboxBot);
    const chart = tree.children.find((node) => node.name === "chart.png");
    const data = tree.children.find((node) => node.name === "data.bin");
    expect(chart).toMatchObject({ kind: "image", mimeType: "image/png" });
    expect(data).toMatchObject({ kind: "file", mimeType: "application/octet-stream" });

    const shared = listBotWorkspaceTree(sandboxBot, "shared");
    expect(shared.name).toBe("shared");
    expect(shared.children).toEqual([
      expect.objectContaining({ name: "handoff.md", path: "handoff.md", kind: "text", mimeType: "text/markdown" })
    ]);
  });

  it("leaves symlinks out of the workspace tree so links cannot reveal outside files", () => {
    const sandbox = resolveBotSandbox(sandboxBot);
    const outsideDir = mkdtempSync(join(tmpdir(), "eidon-tree-escape-"));
    tempDirs.push(outsideDir);
    writeFileSync(join(outsideDir, "eidon.db"), "database");
    writeFileSync(join(sandbox.workspaceDir, "kept.txt"), "kept");
    symlinkSync(outsideDir, join(sandbox.workspaceDir, "data-link"));
    symlinkSync(join(outsideDir, "eidon.db"), join(sandbox.workspaceDir, "db-link.txt"));

    const tree = listBotWorkspaceTree(sandboxBot);
    expect(tree.children.map((node) => node.name)).toEqual(["kept.txt"]);
  });

  it("resolves workspace files only inside the requested workspace", () => {
    const sandbox = resolveBotSandbox(sandboxBot);
    const outsideDir = mkdtempSync(join(tmpdir(), "eidon-workspace-escape-"));
    tempDirs.push(outsideDir);
    writeFileSync(join(outsideDir, "secret.txt"), "secret");
    mkdirSync(join(sandbox.workspaceDir, "docs"), { recursive: true });
    writeFileSync(join(sandbox.workspaceDir, "docs", "brief.md"), "brief");
    writeFileSync(join(getSharedBotWorkspaceDir(sandboxBot), "team.md"), "team");
    symlinkSync(join(outsideDir, "secret.txt"), join(sandbox.workspaceDir, "escape.txt"));

    expect(resolveBotWorkspaceFile(sandboxBot, "bot", "docs/brief.md")).toBe(
      realpathSync(join(sandbox.workspaceDir, "docs", "brief.md"))
    );
    expect(resolveBotWorkspaceFile(sandboxBot, "shared", "team.md")).toBe(
      realpathSync(join(getSharedBotWorkspaceDir(sandboxBot), "team.md"))
    );
    expect(resolveBotWorkspaceFile(sandboxBot, "bot", "team.md")).toBeNull();
    expect(resolveBotWorkspaceFile(sandboxBot, "bot", "docs")).toBeNull();
    expect(resolveBotWorkspaceFile(sandboxBot, "bot", "")).toBeNull();
    expect(resolveBotWorkspaceFile(sandboxBot, "bot", "escape.txt")).toBeNull();
    expect(resolveBotWorkspaceFile(sandboxBot, "bot", "../../../../secret.txt")).toBeNull();
    expect(resolveBotWorkspaceFile(sandboxBot, "shared", `../${basename(sandbox.workspaceDir)}/docs/brief.md`)).toBeNull();
    expect(resolveBotWorkspaceFile(sandboxBot, "bot", join(outsideDir, "secret.txt"))).toBeNull();
    expect(resolveBotWorkspaceFile(sandboxBot, "bot", "docs/brief.md\0")).toBeNull();
    expect(resolveBotWorkspaceFile({ id: "bot_missing_ws", userId: "user_missing" }, "bot", "a.txt")).toBeNull();
  });

  it("executeLocalShellCommand honors injected cwd and allowlisted env extras", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "eidon-shell-test-"));
    tempDirs.push(cwd);
    const result = await executeLocalShellCommand({
      command: "pwd && echo \"$AGENT_BROWSER_SESSION\" && echo \"[$LEAKED_SECRET]\"",
      cwd,
      env: { AGENT_BROWSER_SESSION: "isolated", LEAKED_SECRET: "leak-me", EIDON_ENCRYPTION_SECRET: "leak-me" }
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(cwd);
    expect(result.stdout).toContain("isolated");
    expect(result.stdout).toContain("[]");
    expect(result.stdout).not.toContain("leak-me");
  });
});
