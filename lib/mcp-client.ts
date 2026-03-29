import { ChildProcess, spawn } from "node:child_process";

import type { McpServer } from "@/lib/types";

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

type McpToolCallResult = {
  content: Array<{ type: string; text?: string }>;
};

// ─── Stdio transport process registry ────────────────────────────────────

type StdioProcess = {
  process: ChildProcess;
  messageId: number;
  pending: Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }
  >;
  buffer: string;
  initialized: boolean;
  initPromise: Promise<void> | null;
};

const stdioProcesses = new Map<string, StdioProcess>();

function getOrCreateStdioProcess(server: McpServer): StdioProcess {
  const existing = stdioProcesses.get(server.id);
  if (existing && existing.process.exitCode === null) return existing;

  // Clean up old entry if process exited
  if (existing) {
    stdioProcesses.delete(server.id);
  }

  const command = server.command!;
  const args = server.args ?? [];
  const envVars = server.env ?? {};

  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...envVars },
    // Give child processes a PATH that includes common locations
  });

  const proc: StdioProcess = {
    process: child,
    messageId: 1,
    pending: new Map(),
    buffer: "",
    initialized: false,
    initPromise: null
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    proc.buffer += chunk.toString();
    const lines = proc.buffer.split("\n");
    proc.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as { id?: number; error?: { message?: string }; result?: unknown };
        if (msg.id !== undefined && proc.pending.has(msg.id)) {
          const { resolve, reject } = proc.pending.get(msg.id)!;
          proc.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message ?? "MCP stdio error"));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // Ignore non-JSON lines (server stderr/log output may leak into stdout)
      }
    }
  });

  child.stderr?.on("data", () => {
    // Silently ignore stderr from child process
  });

  child.on("exit", () => {
    // Reject all pending requests
    for (const [, { reject }] of proc.pending) {
      reject(new Error("MCP stdio process exited"));
    }
    proc.pending.clear();
  });

  stdioProcesses.set(server.id, proc);
  return proc;
}

async function sendStdioRequest<T = unknown>(proc: StdioProcess, method: string, params?: unknown): Promise<T> {
  const id = proc.messageId++;
  const message: Record<string, unknown> = {
    jsonrpc: "2.0",
    id,
    method
  };
  if (params !== undefined) {
    message.params = params;
  }

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.pending.delete(id);
      reject(new Error(`MCP stdio request timed out: ${method}`));
    }, 30_000);

    proc.pending.set(id, {
      resolve: (value: unknown) => {
        clearTimeout(timeout);
        resolve(value as T);
      },
      reject: (reason: unknown) => {
        clearTimeout(timeout);
        reject(reason);
      }
    });

    proc.process.stdin?.write(JSON.stringify(message) + "\n");
  });
}

async function ensureInitialized(proc: StdioProcess): Promise<void> {
  if (proc.initialized) return;
  if (proc.initPromise) return proc.initPromise;

  proc.initPromise = (async () => {
    await sendStdioRequest(proc, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "hermes", version: "0.1.0" }
    });

    // Send initialized notification (no id — fire-and-forget)
    proc.process.stdin?.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
    );

    proc.initialized = true;
  })();

  return proc.initPromise;
}

export function shutdownAllProcesses(): void {
  for (const [id, proc] of stdioProcesses) {
    try {
      proc.process.kill();
    } catch {
      // Ignore errors during shutdown
    }
    stdioProcesses.delete(id);
  }
}

// ─── HTTP transport ──────────────────────────────────────────────────────

async function discoverMcpToolsHttp(server: McpServer): Promise<McpTool[]> {
  try {
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...server.headers
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list"
      })
    });

    if (!response.ok) return [];

    const data = await response.json() as { result?: { tools?: McpTool[] } };
    return data.result?.tools ?? [];
  } catch {
    return [];
  }
}

async function callMcpToolHttp(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  const response = await fetch(server.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...server.headers
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    })
  });

  if (!response.ok) {
    return {
      content: [
        { type: "text", text: `MCP tool call failed: ${response.status} ${response.statusText}` }
      ]
    };
  }

  const data = await response.json() as {
    result?: McpToolCallResult;
    error?: { message?: string };
  };

  if (data.error) {
    return {
      content: [{ type: "text", text: `MCP error: ${data.error.message ?? "Unknown error"}` }]
    };
  }

  return (
    data.result ?? {
      content: [{ type: "text", text: "No result from MCP tool" }]
    }
  );
}

// ─── Stdio transport ─────────────────────────────────────────────────────

async function discoverMcpToolsStdio(server: McpServer): Promise<McpTool[]> {
  try {
    const proc = getOrCreateStdioProcess(server);
    await ensureInitialized(proc);
    const result = await sendStdioRequest<{ tools?: McpTool[] }>(proc, "tools/list");
    return result?.tools ?? [];
  } catch {
    return [];
  }
}

async function callMcpToolStdio(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  try {
    const proc = getOrCreateStdioProcess(server);
    await ensureInitialized(proc);
    const result = await sendStdioRequest<McpToolCallResult>(proc, "tools/call", {
      name: toolName,
      arguments: args
    });
    return (
      result ?? {
        content: [{ type: "text", text: "No result from MCP tool" }]
      }
    );
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `MCP stdio error: ${err instanceof Error ? err.message : String(err)}`
        }
      ]
    };
  }
}

// ─── Unified API (routes by server.transport) ────────────────────────────

export async function discoverMcpTools(server: McpServer): Promise<McpTool[]> {
  if (server.transport === "stdio") {
    return discoverMcpToolsStdio(server);
  }
  return discoverMcpToolsHttp(server);
}

export async function callMcpTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  if (server.transport === "stdio") {
    return callMcpToolStdio(server, toolName, args);
  }
  return callMcpToolHttp(server, toolName, args);
}

export async function gatherAllMcpTools(servers: McpServer[]): Promise<
  Array<{
    server: McpServer;
    tools: McpTool[];
  }>
> {
  const results = await Promise.all(
    servers.map(async (server) => {
      const tools = await discoverMcpTools(server);
      return { server, tools };
    })
  );

  return results;
}

export function buildMcpToolsDescription(
  mcpToolSets: Array<{ server: McpServer; tools: McpTool[] }>
): string {
  const parts: string[] = [];

  for (const { server, tools } of mcpToolSets) {
    if (!tools.length) continue;

    parts.push(`## MCP Server: ${server.name}`);
    for (const tool of tools) {
      parts.push(`### ${tool.name}`);
      if (tool.description) parts.push(tool.description);
      if (tool.inputSchema?.properties) {
        parts.push(
          `Parameters: ${JSON.stringify(tool.inputSchema.properties)}`
        );
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}
