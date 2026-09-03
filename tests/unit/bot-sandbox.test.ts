import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, afterAll } from "vitest";

import { executeLocalShellCommand } from "@/lib/local-shell";
import { listBotWorkspaceTree, resolveBotSandbox } from "@/lib/bot-sandbox";

const sandboxBot = { id: "bot_sandbox_probe", userId: "user_sandbox_probe" };
const tempDirs: string[] = [];

describe("bot-sandbox", () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves a per-bot workspace, socket dir, cwd and env", () => {
    const sandbox = resolveBotSandbox(sandboxBot);

    expect(sandbox.cwd).toBe(sandbox.workspaceDir);
    expect(sandbox.workspaceDir).toContain(join("bot-workspaces"));
    expect(sandbox.browserSocketDir).toContain(join("agent-browser", "bots"));
    expect(sandbox.env.AGENT_BROWSER_SOCKET_DIR).toBe(sandbox.browserSocketDir);
    expect(sandbox.env.AGENT_BROWSER_SESSION).toBe("bot");
    expect(sandbox.env.AGENT_BROWSER_SESSION_NAME).toBe("bot");
  });

  it("gives different bots different sandbox paths", () => {
    const left = resolveBotSandbox({ id: "bot_left", userId: "user_x" });
    const right = resolveBotSandbox({ id: "bot_right", userId: "user_x" });
    expect(left.workspaceDir).not.toBe(right.workspaceDir);
    expect(left.browserSocketDir).not.toBe(right.browserSocketDir);
  });

  it("returns an empty tree when the workspace does not exist", () => {
    const tree = listBotWorkspaceTree({ id: "bot_never_created", userId: "user_none" });
    expect(tree.children).toEqual([]);
  });

  it("resets the browser session directory", async () => {
    const { resetBotBrowserSession, getBotBrowserSocketDir } = await import("@/lib/bot-sandbox");
    const sandbox = resolveBotSandbox(sandboxBot);
    writeFileSync(join(sandbox.browserSocketDir, "stale-daemon.sock"), "junk");

    await resetBotBrowserSession(sandboxBot);

    expect(getBotBrowserSocketDir(sandboxBot)).toBe(sandbox.browserSocketDir);
    expect(existsSync(sandbox.browserSocketDir)).toBe(true);
    expect(readdirSync(sandbox.browserSocketDir)).toEqual([]);
  }, 30_000);

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

  it("executeLocalShellCommand honors injected cwd and env", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "eidon-shell-test-"));
    tempDirs.push(cwd);
    const result = await executeLocalShellCommand({
      command: "pwd && echo \"$BOT_MARKER\"",
      cwd,
      env: { ...process.env, BOT_MARKER: "isolated" }
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(cwd);
    expect(result.stdout).toContain("isolated");
  });
});
