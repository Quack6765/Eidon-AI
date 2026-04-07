# Random Dev Server Port

## Problem

Multiple git worktrees running `npm run dev` cannot coexist because they all try to use port 3000. The custom server (`server.ts`) hardcodes port 3000 as the default. When an agent starts a dev server in one worktree, it kills any process on port 3000, breaking other worktrees' servers.

## Solution

Randomize the port used by `npm run dev` within the 3000-4000 range. When the server starts, write a `.dev-server` file containing the URL and PID. Clean up this file on server exit. Update CLAUDE.md to instruct agents to read this file.

## Design

### Port Selection

The server will:
1. Generate a random port in the 3000-4000 range
2. Attempt to listen on that port
3. If EADDRINUSE, retry with a new random port (max 10 attempts)
4. On success, write `.dev-server` file

### `.dev-server` File

**Location:** Project root (worktree directory)

**Format:**
```
http://localhost:3127
PID: 12345
```

**Lifecycle:**
- Created after successful server bind
- Deleted on clean server exit (SIGINT, SIGTERM, normal exit)
- Stale files handled: on startup, check if PID is still running; if not, overwrite

### Edge Cases

| Scenario | Handling |
|----------|----------|
| All 10 attempts fail | Fall back to random port in range, let OS return error |
| Server crash without cleanup | Stale `.dev-server` file detected on next startup |
| Multiple worktrees start simultaneously | Random ports reduce collision probability; retry handles remaining conflicts |

### Files Changed

1. **`server.ts`** — Add port randomization and `.dev-server` file management
2. **`.gitignore`** — Add `.dev-server` entry
3. **`CLAUDE.md`** — Update dev server instructions to read `.dev-server` file

### CLAUDE.md Instructions

Replace the current port 3000 checking/killing logic with:

1. Check if `.dev-server` file exists
2. If exists, read URL from file
3. If not, run `npm run dev` and wait for `.dev-server` to appear
4. Use the URL for testing