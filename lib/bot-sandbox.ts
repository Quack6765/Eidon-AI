import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { env } from "@/lib/env";
import type { Bot } from "@/lib/types";

export type BotSandbox = {
  botId: string;
  workspaceDir: string;
  browserSocketDir: string;
  cwd: string;
  env: Record<string, string>;
};

function toPosixSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "bot";
}

export function getBotWorkspaceDir(bot: Pick<Bot, "id" | "userId">) {
  const ownerSegment = bot.userId ? toPosixSegment(bot.userId) : "shared";
  return join(env.EIDON_DATA_DIR, "bot-workspaces", ownerSegment, toPosixSegment(bot.id));
}

export function getBotBrowserSocketDir(bot: Pick<Bot, "id">) {
  return join(env.EIDON_DATA_DIR, "runtime", "agent-browser", "bots", toPosixSegment(bot.id));
}

export function ensureBotWorkspace(bot: Pick<Bot, "id" | "userId">) {
  const workspaceDir = getBotWorkspaceDir(bot);
  mkdirSync(workspaceDir, { recursive: true });
  return workspaceDir;
}

export function resolveBotSandbox(bot: Pick<Bot, "id" | "userId">): BotSandbox {
  const workspaceDir = getBotWorkspaceDir(bot);
  const browserSocketDir = getBotBrowserSocketDir(bot);

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(browserSocketDir, { recursive: true });

  return {
    botId: bot.id,
    workspaceDir,
    browserSocketDir,
    cwd: workspaceDir,
    env: {
      AGENT_BROWSER_SOCKET_DIR: browserSocketDir,
      AGENT_BROWSER_SESSION: "bot",
      AGENT_BROWSER_SESSION_NAME: "bot"
    }
  };
}

export type BotWorkspaceNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  byteSize: number;
  children: BotWorkspaceNode[];
};

const WORKSPACE_TREE_MAX_DEPTH = 8;
const WORKSPACE_TREE_MAX_ENTRIES = 500;

function readWorkspaceNodes(
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  budget: { remaining: number }
): BotWorkspaceNode[] {
  if (depth > WORKSPACE_TREE_MAX_DEPTH || budget.remaining <= 0) {
    return [];
  }
  let entries;
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const directories: BotWorkspaceNode[] = [];
  const files: BotWorkspaceNode[] = [];
  for (const entry of entries) {
    if (budget.remaining <= 0) {
      break;
    }
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    let isDirectory = entry.isDirectory();
    let byteSize = 0;
    try {
      const stats = statSync(join(absoluteDir, entry.name));
      isDirectory = stats.isDirectory();
      byteSize = stats.isFile() ? stats.size : 0;
    } catch {
      continue;
    }
    budget.remaining -= 1;
    const node: BotWorkspaceNode = {
      name: entry.name,
      path: relativePath,
      isDirectory,
      byteSize,
      children: []
    };
    if (isDirectory) {
      directories.push(node);
    } else {
      files.push(node);
    }
  }

  directories.sort((left, right) => left.name.localeCompare(right.name));
  files.sort((left, right) => left.name.localeCompare(right.name));

  for (const directory of directories) {
    directory.children = readWorkspaceNodes(
      join(absoluteDir, directory.name),
      directory.path,
      depth + 1,
      budget
    );
  }

  return [...directories, ...files];
}

export function listBotWorkspaceTree(bot: Pick<Bot, "id" | "userId">): BotWorkspaceNode {
  const workspaceDir = getBotWorkspaceDir(bot);
  const budget = { remaining: WORKSPACE_TREE_MAX_ENTRIES };
  const children = readWorkspaceNodes(workspaceDir, "", 1, budget);
  return {
    name: basename(workspaceDir),
    path: "",
    isDirectory: true,
    byteSize: 0,
    children
  };
}

function runAgentBrowserCloseAll(socketDir: string) {
  return new Promise<void>((resolve) => {
    try {
      const child = spawn("agent-browser", ["close", "--all"], {
        env: {
          ...process.env,
          AGENT_BROWSER_SOCKET_DIR: socketDir,
          AGENT_BROWSER_SESSION: "bot",
          AGENT_BROWSER_SESSION_NAME: "bot"
        },
        stdio: "ignore",
        detached: process.platform !== "win32"
      });
      child.on("error", () => resolve());
      child.on("close", () => resolve());
      setTimeout(() => {
        try {
          if (child.pid && process.platform !== "win32") {
            process.kill(-child.pid, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        } catch {}
        resolve();
      }, 10_000).unref();
    } catch {
      resolve();
    }
  });
}

export async function resetBotBrowserSession(bot: Pick<Bot, "id">) {
  const socketDir = getBotBrowserSocketDir(bot);
  await runAgentBrowserCloseAll(socketDir);
  try {
    rmSync(socketDir, { recursive: true, force: true });
  } catch {}
  mkdirSync(socketDir, { recursive: true });
}
