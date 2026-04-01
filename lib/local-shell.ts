import { spawn } from "node:child_process";

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

function splitCommandSegments(command: string) {
  return command
    .split(/&&|\n/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isAllowedSegment(segment: string, allowedPrefixes: string[]) {
  return allowedPrefixes.some((prefix) => segment === prefix || segment.startsWith(`${prefix} `));
}

function validateCommand(command: string, allowedPrefixes: string[]) {
  const trimmed = command.trim();

  if (!trimmed) {
    throw new Error("Shell command is required");
  }

  if (/[|;<>`]/.test(trimmed) || trimmed.includes("||") || trimmed.includes("$(")) {
    throw new Error("Shell command contains unsupported operators");
  }

  const segments = splitCommandSegments(trimmed);

  if (!segments.length) {
    throw new Error("Shell command is required");
  }

  if (!segments.every((segment) => isAllowedSegment(segment, allowedPrefixes))) {
    throw new Error("Shell command is not permitted for the loaded skills");
  }

  return trimmed;
}

export async function executeLocalShellCommand(input: {
  command: string;
  allowedPrefixes: string[];
  cwd?: string;
  timeoutMs?: number;
}) {
  const command = validateCommand(input.command, input.allowedPrefixes);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise<ShellExecutionResult>((resolve) => {
    const child = spawn("zsh", ["-lc", command], {
      cwd: input.cwd ?? process.cwd(),
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

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

    child.on("close", (exitCode) => {
      clearTimeout(timer);

      resolve({
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
