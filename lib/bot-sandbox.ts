import { lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { normalizeAttachmentKind } from "@/lib/attachments";
import { isPathInsideRoot, toPosixSegment } from "@/lib/local-shell";
import { env } from "@/lib/env";
import type { AttachmentKind, Bot } from "@/lib/types";

export type BotSandbox = {
  botId: string;
  workspaceDir: string;
  cwd: string;
};

export type BotWorkspaceScope = "bot" | "shared";

export function getBotTeamWorkspacesDir(bot: Pick<Bot, "userId">) {
  const ownerSegment = bot.userId ? toPosixSegment(bot.userId, "bot") : "shared";
  return join(env.EIDON_DATA_DIR, "bot-workspaces", ownerSegment);
}

export function getBotWorkspaceDir(bot: Pick<Bot, "id" | "userId">) {
  return join(getBotTeamWorkspacesDir(bot), toPosixSegment(bot.id, "bot"));
}

export function getSharedBotWorkspaceDir(bot: Pick<Bot, "userId">) {
  return join(getBotTeamWorkspacesDir(bot), "shared");
}

function getBotWorkspaceScopeDir(bot: Pick<Bot, "id" | "userId">, scope: BotWorkspaceScope) {
  return scope === "shared" ? getSharedBotWorkspaceDir(bot) : getBotWorkspaceDir(bot);
}

export function ensureBotWorkspace(bot: Pick<Bot, "id" | "userId">) {
  const workspaceDir = getBotWorkspaceDir(bot);
  mkdirSync(workspaceDir, { recursive: true });
  return workspaceDir;
}

export function removeBotWorkspace(bot: Pick<Bot, "id" | "userId">) {
  rmSync(getBotWorkspaceDir(bot), { recursive: true, force: true });
}

export function resolveBotSandbox(bot: Pick<Bot, "id" | "userId">): BotSandbox {
  const workspaceDir = getBotWorkspaceDir(bot);

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(getSharedBotWorkspaceDir(bot), { recursive: true });

  return {
    botId: bot.id,
    workspaceDir,
    cwd: workspaceDir
  };
}

export type BotWorkspaceNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  byteSize: number;
  kind?: AttachmentKind;
  mimeType?: string;
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
      const stats = lstatSync(join(absoluteDir, entry.name));
      if (stats.isSymbolicLink()) {
        continue;
      }
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
      ...(isDirectory ? {} : normalizeAttachmentKind(entry.name, "")),
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

export function resolveBotWorkspaceFile(
  bot: Pick<Bot, "id" | "userId">,
  scope: BotWorkspaceScope,
  relativePath: string
) {
  if (!relativePath || relativePath.includes("\0") || isAbsolute(relativePath)) {
    return null;
  }

  try {
    const root = realpathSync(getBotWorkspaceScopeDir(bot, scope));
    const candidate = realpathSync(join(root, relativePath));
    if (candidate === root || !isPathInsideRoot(candidate, root) || !statSync(candidate).isFile()) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export function listBotWorkspaceTree(
  bot: Pick<Bot, "id" | "userId">,
  scope: BotWorkspaceScope = "bot"
): BotWorkspaceNode {
  const workspaceDir = getBotWorkspaceScopeDir(bot, scope);
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
