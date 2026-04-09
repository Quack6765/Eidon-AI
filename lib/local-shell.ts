import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 8_000;

export type ShellCallPayload = {
  command: string;
  timeoutMs?: number;
};

export type ShellExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  isError: boolean;
};

function truncateOutput(value: string) {
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_CHARS - 12)}\n...[truncated]`;
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
  timeoutMs?: number;
}) {
  const command = validateCommand(input.command);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise<ShellExecutionResult>((resolve) => {
    const child = spawn(resolveShellPath(), ["-lc", command], {
      cwd: input.cwd ?? process.cwd(),
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (result: ShellExecutionResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish({
        stdout: truncateOutput(stdout.trim()),
        stderr: truncateOutput((stderr ? `${stderr}\n` : "") + error.message),
        exitCode: null,
        timedOut,
        isError: true
      });
    });

    child.on("close", (exitCode) => {
      finish({
        stdout: truncateOutput(stdout.trim()),
        stderr: truncateOutput(stderr.trim()),
        exitCode,
        timedOut,
        isError: timedOut || exitCode !== 0
      });
    });
  });
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
