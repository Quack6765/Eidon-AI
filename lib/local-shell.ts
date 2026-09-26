import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { appendBoundedText, truncateText } from "@/lib/bounded-text";
import { env } from "@/lib/env";

export const SHELL_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TZ",
  "TMPDIR",
  "USER",
  "LOGNAME"
] as const;

export const SHELL_ENV_EXTRA_ALLOWLIST = [
  "AGENT_BROWSER_SOCKET_DIR",
  "AGENT_BROWSER_SESSION",
  "AGENT_BROWSER_SESSION_NAME"
] as const;

export function buildShellEnv(extraEnv?: Record<string, string>) {
  const shellEnv: Record<string, string> = {};

  for (const name of SHELL_ENV_ALLOWLIST) {
    const value = process.env[name];
    if (value !== undefined) {
      shellEnv[name] = value;
    }
  }

  for (const name of SHELL_ENV_EXTRA_ALLOWLIST) {
    const value = extraEnv?.[name];
    if (value !== undefined) {
      shellEnv[name] = value;
    }
  }

  return shellEnv as NodeJS.ProcessEnv;
}

export function toPosixSegment(value: string, fallback: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function resolveExistingPath(target: string) {
  try {
    return realpathSync(target);
  } catch {
    return resolve(target);
  }
}

export function isPathInsideRoot(candidatePath: string, rootPath: string) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function resolveShellWorkspaceDir(conversationId?: string) {
  const requestedRoot = `${resolve(env.EIDON_DATA_DIR)}-workspaces`;
  mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
  if (lstatSync(requestedRoot).isSymbolicLink()) {
    throw new Error("Shell workspace root must not be a symbolic link");
  }

  const root = realpathSync(requestedRoot);
  const dataRoot = resolveExistingPath(env.EIDON_DATA_DIR);
  const envFilePath = resolveExistingPath(join(process.cwd(), ".env"));
  if (
    isPathInsideRoot(dataRoot, root) ||
    isPathInsideRoot(root, dataRoot) ||
    isPathInsideRoot(envFilePath, root)
  ) {
    throw new Error("Shell workspace overlaps application data");
  }

  const workspaceDir = join(root, toPosixSegment(conversationId ?? "", "shared"));
  const relativePath = relative(root, workspaceDir);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Shell workspace path escapes the workspace root");
  }

  mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
  const stats = lstatSync(workspaceDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Shell workspace contains an unsafe directory link");
  }
  if (realpathSync(workspaceDir) !== workspaceDir) {
    throw new Error("Shell workspace resolves outside the workspace root");
  }

  return workspaceDir;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const WEB_BROWSER_TIMEOUT_MS = 120_000;
export const MAX_SHELL_TIMEOUT_MS = 600_000;
const FORCE_KILL_DELAY_MS = 2_000;
const MAX_OUTPUT_CHARS = 8_000;
const SHELL_SEGMENT_SEPARATOR_PATTERN = /&&|\|\||[;|\n]/;
const WEB_BROWSER_COMMAND_SEGMENT_PATTERN =
  /^(?:(?:env)\s+)?(?:(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+))\s+)*(?:(?:npx|bunx)\s+|pnpm\s+(?:exec|dlx)\s+|yarn\s+dlx\s+)?(?:(?:\.{1,2}\/|\/)?(?:[^\s/]+\/)*agent-browser)(?:\s|$)/i;

export type ShellExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  isError: boolean;
};

function getDefaultTimeoutMs(command: string) {
  return getShellCommandLabel(command) === "Web browser" ? WEB_BROWSER_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function truncateOutput(value: string) {
  return truncateText(value, MAX_OUTPUT_CHARS);
}

function formatCapturedOutput(value: string, wasTruncated: boolean) {
  const trimmed = value.trim();
  return wasTruncated ? truncateOutput(`${trimmed} `) : trimmed;
}

function createAbortError() {
  const error = new Error("Shell command aborted");
  error.name = "AbortError";
  return error;
}

function terminateProcessGroup(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals
) {
  if (process.platform !== "win32" && typeof child.pid === "number") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      child.kill(signal);
      return;
    }
  }

  child.kill(signal);
}

function validateCommand(command: string) {
  const trimmed = command.trim();

  if (!trimmed) {
    throw new Error("Shell command is required");
  }

  return trimmed;
}

function resolveShellPath() {
  const shellPath = process.env.SHELL?.trim();

  if (!shellPath) {
    return "/bin/sh";
  }

  if (!shellPath.includes("/")) {
    return shellPath;
  }

  try {
    accessSync(shellPath, fsConstants.X_OK);
    return shellPath;
  } catch {
    return "/bin/sh";
  }
}

export async function executeLocalShellCommand(input: {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}) {
  const command = validateCommand(input.command);
  const timeoutMs = Math.min(input.timeoutMs ?? getDefaultTimeoutMs(command), MAX_SHELL_TIMEOUT_MS);
  const cwd = input.cwd ?? resolveShellWorkspaceDir();
  const shellEnv = buildShellEnv(input.env);

  if (input.abortSignal?.aborted) {
    throw createAbortError();
  }

  return await new Promise<ShellExecutionResult>((resolve, reject) => {
    const child = spawn(resolveShellPath(), ["-lc", command], {
      cwd,
      env: shellEnv,
      detached: process.platform !== "win32"
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;
    let terminating = false;

    const cleanup = () => {
      clearTimeout(timer);
      input.abortSignal?.removeEventListener("abort", handleAbort);
    };

    const finish = (result: ShellExecutionResult) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(result);
    };

    const rejectAborted = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(createAbortError());
    };

    const terminate = () => {
      if (terminating) {
        return;
      }
      terminating = true;
      terminateProcessGroup(child, "SIGTERM");
      setTimeout(() => terminateProcessGroup(child, "SIGKILL"), FORCE_KILL_DELAY_MS).unref();
    };

    const handleAbort = () => {
      terminate();
      rejectAborted();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref();
    input.abortSignal?.addEventListener("abort", handleAbort, { once: true });
    if (input.abortSignal?.aborted) {
      handleAbort();
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      const appended = appendBoundedText(stdout, chunk.toString(), MAX_OUTPUT_CHARS);
      stdout = appended.value;
      stdoutTruncated ||= appended.truncated;
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const appended = appendBoundedText(stderr, chunk.toString(), MAX_OUTPUT_CHARS);
      stderr = appended.value;
      stderrTruncated ||= appended.truncated;
    });

    child.on("error", (error) => {
      finish({
        stdout: formatCapturedOutput(stdout, stdoutTruncated),
        stderr: truncateOutput(`${formatCapturedOutput(stderr, stderrTruncated)}${stderr ? "\n" : ""}${error.message}`),
        exitCode: null,
        timedOut,
        isError: true
      });
    });

    child.on("close", (exitCode) => {
      finish({
        stdout: formatCapturedOutput(stdout, stdoutTruncated),
        stderr: formatCapturedOutput(stderr, stderrTruncated),
        exitCode,
        timedOut,
        isError: timedOut || exitCode !== 0
      });
    });
  });
}

export function getShellCommandLabel(command: string) {
  const invokesWebBrowser = command
    .split(SHELL_SEGMENT_SEPARATOR_PATTERN)
    .map((segment) => segment.trim())
    .some((segment) => WEB_BROWSER_COMMAND_SEGMENT_PATTERN.test(segment));

  return invokesWebBrowser ? "Web browser" : "Local command";
}

export function summarizeShellResult(result: ShellExecutionResult) {
  const sections = result.timedOut ? ["Command timed out"] : [];

  if (result.stdout) {
    sections.push(result.stdout);
  }

  if (result.stderr) {
    sections.push(result.stderr);
  }

  if (!sections.length) {
    sections.push(result.exitCode === 0 ? "Command completed with no output" : "Command failed with no output");
  }

  return sections.join("\n\n");
}
