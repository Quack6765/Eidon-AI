import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { appendBoundedText, truncateText } from "@/lib/bounded-text";

const DEFAULT_TIMEOUT_MS = 30_000;
const WEB_BROWSER_TIMEOUT_MS = 120_000;
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
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}) {
  const command = validateCommand(input.command);
  const timeoutMs = input.timeoutMs ?? getDefaultTimeoutMs(command);

  if (input.abortSignal?.aborted) {
    throw createAbortError();
  }

  return await new Promise<ShellExecutionResult>((resolve, reject) => {
    const child = spawn(resolveShellPath(), ["-lc", command], {
      cwd: input.cwd ?? process.cwd(),
      env: input.env ?? process.env,
      detached: process.platform !== "win32"
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

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

    const terminateForAbort = () => {
      if (forceKillTimer) {
        return;
      }
      terminateProcessGroup(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 2_000);
      forceKillTimer.unref();
    };

    const handleAbort = () => {
      terminateForAbort();
      rejectAborted();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
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
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      finish({
        stdout: formatCapturedOutput(stdout, stdoutTruncated),
        stderr: truncateOutput(`${formatCapturedOutput(stderr, stderrTruncated)}${stderr ? "\n" : ""}${error.message}`),
        exitCode: null,
        timedOut,
        isError: true
      });
    });

    child.on("close", (exitCode) => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
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
  if (result.timedOut) {
    return "Command timed out";
  }

  const sections = [];

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
