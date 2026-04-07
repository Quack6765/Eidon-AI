import { createServer } from "node:http";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import next from "next";
import { WebSocketServer } from "ws";
import { setupWebSocketHandler } from "@/lib/ws-handler";

const DEV_SERVER_FILE = ".dev-server";
const PORT_MIN = 3000;
const PORT_MAX = 4000;
const MAX_ATTEMPTS = 10;

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseDevServerFile(): { url: string; pid: number } | null {
  if (!existsSync(DEV_SERVER_FILE)) return null;
  try {
    const content = readFileSync(DEV_SERVER_FILE, "utf-8");
    const lines = content.trim().split("\n");
    const url = lines[0];
    const pidMatch = lines[1]?.match(/^PID:\s*(\d+)$/);
    if (!pidMatch) return null;
    return { url, pid: parseInt(pidMatch[1], 10) };
  } catch {
    return null;
  }
}

function writeDevServerFile(port: number): void {
  const content = `http://localhost:${port}\nPID: ${process.pid}`;
  writeFileSync(DEV_SERVER_FILE, content);
}

function cleanupDevServerFile(): void {
  try {
    unlinkSync(DEV_SERVER_FILE);
  } catch {
    // Ignore errors during cleanup
  }
}

async function findAvailablePort(
  server: ReturnType<typeof createServer>,
  preferredPort: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${preferredPort} is in use`));
      } else {
        reject(err);
      }
    });
    server.once("listening", () => {
      resolve(preferredPort);
    });
    server.listen(preferredPort);
  });
}

async function findRandomPort(server: ReturnType<typeof createServer>): Promise<number> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const port = Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1)) + PORT_MIN;
    try {
      await findAvailablePort(server, port);
      return port;
    } catch {
      // Port in use, try another
    }
  }
  // Fallback: let OS assign a port
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      } else {
        reject(new Error("Failed to get assigned port"));
      }
    });
    server.listen(0);
  });
}

const isDev = process.env.NODE_ENV !== "production";
const preferredPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
const app = next({ dev: isDev });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  setupWebSocketHandler(wss);

  let port: number;

  if (isDev) {
    // Development: use random port and write .dev-server file
    const existing = parseDevServerFile();
    if (existing && !isProcessRunning(existing.pid)) {
      cleanupDevServerFile();
    }

    if (preferredPort !== null) {
      await findAvailablePort(server, preferredPort);
      port = preferredPort;
    } else {
      port = await findRandomPort(server);
    }

    writeDevServerFile(port);

    process.on("exit", cleanupDevServerFile);
    process.on("SIGINT", () => {
      cleanupDevServerFile();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      cleanupDevServerFile();
      process.exit(0);
    });
  } else {
    // Production: use PORT or default to 3000, no .dev-server file
    port = preferredPort ?? 3000;
    await findAvailablePort(server, port);
  }

  console.log(`> Ready on http://localhost:${port}`);
});