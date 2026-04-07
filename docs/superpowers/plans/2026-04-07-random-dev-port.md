# Random Dev Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Randomize the dev server port to allow multiple worktrees to run simultaneously, writing URL and PID to a `.dev-server` file for discovery.

**Architecture:** Modify `server.ts` to find an available port in the 3000-4000 range, write `.dev-server` file on startup, and clean it up on exit. Update `.gitignore` and `CLAUDE.md` accordingly.

**Tech Stack:** Node.js HTTP server, fs operations, process signals

---

## File Structure

| File | Responsibility |
|------|----------------|
| `server.ts` | Port randomization, `.dev-server` file creation/cleanup |
| `.gitignore` | Ignore `.dev-server` file |
| `CLAUDE.md` | Instructions for agents to read `.dev-server` file |

---

### Task 1: Add `.dev-server` to `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add `.dev-server` entry to `.gitignore`**

```gitignore
node_modules
.next
coverage
playwright-report
test-results
ws-handler-compiled.cjs
.playwright-cli
.data
.test-data
.e2e-data
.env*.local
tsconfig.tsbuildinfo
.superpowers/
.worktrees/
.env
.dev-server
```

- [ ] **Step 2: Commit the change**

```bash
git add .gitignore
git commit -m "chore: add .dev-server to gitignore"
```

---

### Task 2: Implement port randomization in `server.ts`

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Add imports and constants at top of `server.ts`**

```typescript
import { createServer } from "node:http";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import next from "next";
import { WebSocketServer } from "ws";
import { setupWebSocketHandler } from "@/lib/ws-handler";

const DEV_SERVER_FILE = ".dev-server";
const PORT_MIN = 3000;
const PORT_MAX = 4000;
const MAX_ATTEMPTS = 10;
```

- [ ] **Step 2: Add port-finding utility function before the main logic**

```typescript
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
```

- [ ] **Step 3: Update the main server startup logic to use random port**

Replace the existing startup code:

```typescript
const port = parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev: process.env.NODE_ENV !== "production" });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  setupWebSocketHandler(wss);

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
```

With:

```typescript
const preferredPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
const app = next({ dev: process.env.NODE_ENV !== "production" });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  setupWebSocketHandler(wss);

  // Handle stale .dev-server file
  const existing = parseDevServerFile();
  if (existing && !isProcessRunning(existing.pid)) {
    cleanupDevServerFile();
  }

  let port: number;
  if (preferredPort !== null) {
    // Use explicit PORT from environment
    await findAvailablePort(server, preferredPort);
    port = preferredPort;
  } else {
    // Find random available port
    port = await findRandomPort(server);
  }

  // Write .dev-server file
  writeDevServerFile(port);

  // Cleanup on exit
  process.on("exit", cleanupDevServerFile);
  process.on("SIGINT", () => {
    cleanupDevServerFile();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanupDevServerFile();
    process.exit(0);
  });

  console.log(`> Ready on http://localhost:${port}`);
});
```

- [ ] **Step 4: Verify the TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 5: Commit the server changes**

```bash
git add server.ts
git commit -m "feat: randomize dev server port and write .dev-server file

- Random port selection in 3000-4000 range
- Writes .dev-server file with URL and PID
- Cleans up file on server exit
- Handles stale files from crashed servers"
```

---

### Task 3: Update CLAUDE.md instructions

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update dev server instructions**

Replace the current "### Dev Server" section:

```markdown
### Dev Server

- You may start the dev server (`npm run dev`) when needed.
- **Before starting**, check if something is already running on port 3000 (`lsof -i :3000`). If a process is found, kill it first, then start fresh.
- After starting, wait for the server to be ready before proceeding with validation.
```

With:

```markdown
### Dev Server

- You may start the dev server (`npm run dev`) when needed.
- The dev server uses a random port in the 3000-4000 range to support multiple worktrees.
- **Before starting**, check if a `.dev-server` file exists in the project root.
  - If it exists, read the URL from it (first line) and use that for testing.
  - If the file exists but the server is not running (cannot connect), delete it and start fresh.
- After starting `npm run dev`, wait for the `.dev-server` file to appear, then read the URL from it.
- The `.dev-server` file format is:
  ```
  http://localhost:3127
  PID: 12345
  ```
```

- [ ] **Step 2: Commit the CLAUDE.md update**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for random dev port

Instructs agents to read .dev-server file for dev server URL"
```

---

### Task 4: Manual testing

- [ ] **Step 1: Start the dev server and verify `.dev-server` file is created**

```bash
npm run dev
```

Expected: Server starts, `.dev-server` file appears with URL and PID

- [ ] **Step 2: Verify the URL in `.dev-server` works**

```bash
curl $(head -1 .dev-server)
```

Expected: HTML response from the Next.js app

- [ ] **Step 3: Stop the server and verify `.dev-server` file is cleaned up**

Press Ctrl+C to stop server.

Expected: `.dev-server` file is deleted

- [ ] **Step 4: Test port collision handling (manual)**

1. Start dev server in one terminal
2. Note the port from `.dev-server`
3. In another terminal, manually bind to that same port (e.g., `python -m http.server 3127`)
4. Start another dev server — it should pick a different port

---

## Summary

This plan implements random port allocation for the dev server with four tasks:

1. Add `.dev-server` to `.gitignore`
2. Implement port randomization in `server.ts`
3. Update `CLAUDE.md` instructions
4. Manual testing