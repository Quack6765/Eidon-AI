import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { appendBoundedText, truncateMiddle } from "@/lib/bounded-text";
import { env } from "@/lib/env";
import { isolateCommand, type IsolationRules } from "@/lib/shell-isolation";

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
  "LOGNAME",
  "AGENT_BROWSER_EXECUTABLE_PATH"
] as const;

export const SHELL_ENV_EXTRA_ALLOWLIST = [
  "AGENT_BROWSER_ARGS",
  "AGENT_BROWSER_SOCKET_DIR",
  "AGENT_BROWSER_SESSION",
  "AGENT_BROWSER_CDP",
  "AGENT_BROWSER_PIN_TAB",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NODE_USE_ENV_PROXY"
] as const;

export function buildShellEnv(extraEnv?: Record<string, string>, secretEnv?: Record<string, string>) {
  const shellEnv: Record<string, string> = { ...secretEnv };

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

export const DEFAULT_SHELL_TIMEOUT_MS = 120_000;
export const MAX_SHELL_TIMEOUT_MS = 600_000;
const FORCE_KILL_DELAY_MS = 2_000;
export const MAX_OUTPUT_CHARS = 8_000;
const MAX_CAPTURE_CHARS = 1_000_000;
const SHELL_SEGMENT_SEPARATOR_PATTERN = /&&|\|\||[;|\n]/;
const WEB_BROWSER_COMMAND_SEGMENT_PATTERN =
  /^(?:(?:env)\s+)?(?:(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+))\s+)*(?:(?:npx|bunx)\s+|pnpm\s+(?:exec|dlx)\s+|yarn\s+dlx\s+)?(?:(?:\.{1,2}\/|\/)?(?:[^\s/]+\/)*agent-browser)(?:\s|$)/i;
const TOOL_OUTPUT_FILE_PATTERN = /^\d{13}-[0-9a-f]{8}\.txt$/;
const MAX_TOOL_OUTPUT_FILES = 20;

export function resolveToolOutputDir(conversationId: string | undefined, create: boolean) {
  const requestedRoot = join(resolve(env.EIDON_DATA_DIR), "tool-output");
  if (create) {
    mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
  } else if (!existsSync(requestedRoot)) {
    return null;
  }
  if (lstatSync(requestedRoot).isSymbolicLink()) {
    throw new Error("Tool output root must not be a symbolic link");
  }

  const outputDir = join(realpathSync(requestedRoot), toPosixSegment(conversationId ?? "", "shared"));
  if (create) {
    mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  } else if (!existsSync(outputDir)) {
    return null;
  }
  const stats = lstatSync(outputDir);
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(outputDir) !== outputDir) {
    throw new Error("Tool output directory is not a plain directory");
  }

  return outputDir;
}

export function removeToolOutputDir(conversationId: string) {
  const outputDir = resolveToolOutputDir(conversationId, false);
  if (outputDir) {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function pruneToolOutputFiles(outputDir: string) {
  const files = readdirSync(outputDir).filter((name) => TOOL_OUTPUT_FILE_PATTERN.test(name)).sort();
  for (const name of files.slice(0, -MAX_TOOL_OUTPUT_FILES)) {
    const filePath = join(outputDir, name);
    try {
      if (lstatSync(filePath).isFile()) {
        unlinkSync(filePath);
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
}

function saveToolOutput(conversationId: string | undefined, content: string) {
  const outputDir = resolveToolOutputDir(conversationId, true);
  if (!outputDir) {
    throw new Error("Tool output directory is unavailable");
  }
  const filePath = join(outputDir, `${Date.now()}-${randomBytes(4).toString("hex")}.txt`);
  writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, { mode: 0o600, flag: "wx" });
  pruneToolOutputFiles(outputDir);
  return filePath;
}

export function boundShellResultSummary(
  summary: string,
  options: { conversationId?: string; captureTruncated?: boolean }
) {
  if (summary.length <= MAX_OUTPUT_CHARS) {
    return summary;
  }

  let note: string;
  try {
    const filePath = saveToolOutput(options.conversationId, summary);
    note = options.captureTruncated
      ? `[Output exceeded ${MAX_CAPTURE_CHARS.toLocaleString("en-US")} characters per stream; the captured part is saved to ${filePath}. Read parts of it with execute_shell_command or run_python instead of re-running the command.]`
      : `[Output was ${summary.length.toLocaleString("en-US")} characters; the full output is saved to ${filePath}. Read parts of it with execute_shell_command or run_python instead of re-running the command.]`;
  } catch {
    note = `[Output was ${summary.length.toLocaleString("en-US")} characters; only its start and end are shown.]`;
  }

  return `${note}\n\n${truncateMiddle(summary, Math.max(MAX_OUTPUT_CHARS - note.length - 2, 0))}`;
}

export type ShellExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  isError: boolean;
  captureTruncated?: boolean;
};

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

export function resolveShellPath() {
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
  secretEnv?: Record<string, string>;
  isolation?: IsolationRules;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  stdin?: string;
}) {
  const command = validateCommand(input.command);
  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS, MAX_SHELL_TIMEOUT_MS);
  const cwd = input.cwd ?? resolveShellWorkspaceDir();
  const shellEnv = buildShellEnv(input.env, input.secretEnv);

  if (input.abortSignal?.aborted) {
    throw createAbortError();
  }

  return await new Promise<ShellExecutionResult>((resolve, reject) => {
    const shell = input.isolation
      ? isolateCommand(resolveShellPath(), ["-lc", command], input.isolation)
      : { command: resolveShellPath(), args: ["-lc", command] };
    const child = spawn(shell.command, shell.args, {
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

    child.stdin.on("error", () => {});
    child.stdin.end(input.stdin ?? "");

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const appended = appendBoundedText(stdout, chunk, MAX_CAPTURE_CHARS);
      stdout = appended.value;
      stdoutTruncated ||= appended.truncated;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const appended = appendBoundedText(stderr, chunk, MAX_CAPTURE_CHARS);
      stderr = appended.value;
      stderrTruncated ||= appended.truncated;
    });

    child.on("error", (error) => {
      finish({
        stdout: stdout.trim(),
        stderr: [stderr.trim(), error.message].filter(Boolean).join("\n"),
        exitCode: null,
        timedOut,
        isError: true,
        captureTruncated: stdoutTruncated || stderrTruncated
      });
    });

    child.on("close", (exitCode) => {
      finish({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        timedOut,
        isError: timedOut || exitCode !== 0,
        captureTruncated: stdoutTruncated || stderrTruncated
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
