# MCP Tool Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace UUID-based MCP tool names with slug-based names derived from the server's display name.

**Architecture:** Add a `slug` field to `McpServer`, auto-generated from the name. Tool names change from `mcp_{sanitized_serverId}_{toolName}` to `mcp_{slug}_{toolName}`. Routing uses slug lookup instead of UUID matching. The DB gets a `slug TEXT UNIQUE` column.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Zod, Next.js API routes, Vitest

---

### Task 1: Add slugify utility and slug field to McpServer type

**Files:**
- Modify: `lib/types.ts:118-130`
- Modify: `lib/mcp-servers.ts:9-21` (McpServerRow)

- [ ] **Step 1: Add `slug` field to `McpServer` type**

In `lib/types.ts`, add `slug` to the `McpServer` type after `name`:

```typescript
export type McpServer = {
  id: string;
  name: string;
  slug: string;
  url: string;
  headers: Record<string, string>;
  transport: McpTransport;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 2: Add `slug` to `McpServerRow` and `rowToMcpServer`**

In `lib/mcp-servers.ts`, add `slug` to the row type and mapping:

```typescript
type McpServerRow = {
  id: string;
  name: string;
  slug: string;
  url: string;
  headers: string;
  transport: string;
  command: string | null;
  args: string | null;
  env: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

function rowToMcpServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    headers: JSON.parse(row.headers) as Record<string, string>,
    transport: (row.transport ?? "streamable_http") as McpTransport,
    command: row.command,
    args: row.args ? (JSON.parse(row.args) as string[]) : null,
    env: row.env ? (JSON.parse(row.env) as Record<string, string>) : null,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

- [ ] **Step 3: Add `slugify` function and `SELECT_COLUMNS` update**

In `lib/mcp-servers.ts`, add the slugify function and update the SELECT_COLUMNS constant:

```typescript
export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
```

Update SELECT_COLUMNS:

```typescript
const SELECT_COLUMNS = `id, name, slug, url, headers, transport, command, args, env, enabled, created_at, updated_at`;
```

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/mcp-servers.ts
git commit -m "Add slug field to McpServer type and slugify utility"
```

---

### Task 2: Add slug column to DB schema and update CRUD operations

**Files:**
- Modify: `lib/db.ts:227-235` (mcp_servers CREATE TABLE)
- Modify: `lib/db.ts:352-365` (mcp_servers migration)
- Modify: `lib/mcp-servers.ts:39-112` (CRUD operations)

- [ ] **Step 1: Add `slug` column to the CREATE TABLE statement**

In `lib/db.ts`, update the `mcp_servers` CREATE TABLE to include `slug`:

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  headers TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 2: Add migration for existing databases**

In `lib/db.ts`, after the existing `mcp_servers` column migrations (around line 365), add:

```typescript
if (!mcpColNames.includes("slug")) {
  db.exec("ALTER TABLE mcp_servers ADD COLUMN slug TEXT");
  const existingServers = db.prepare("SELECT id, name FROM mcp_servers").all() as Array<{ id: string; name: string }>;
  const updateSlug = db.prepare("UPDATE mcp_servers SET slug = ? WHERE id = ?");
  for (const server of existingServers) {
    const slug = server.name
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    updateSlug.run(slug || "unnamed", server.id);
  }
  // Make slug NOT NULL and UNIQUE after backfill
  try {
    db.exec(`
      CREATE TABLE mcp_servers_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        headers TEXT NOT NULL DEFAULT '{}',
        transport TEXT NOT NULL DEFAULT 'streamable_http',
        command TEXT,
        args TEXT,
        env TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO mcp_servers_new SELECT id, name, slug, url, headers, transport, command, args, env, enabled, created_at, updated_at FROM mcp_servers;
      DROP TABLE mcp_servers;
      ALTER TABLE mcp_servers_new RENAME TO mcp_servers;
    `);
  } catch {
    // Table may already have the new schema if freshly created
  }
}
```

- [ ] **Step 3: Update `createMcpServer` to include slug**

In `lib/mcp-servers.ts`, update `createMcpServer`:

```typescript
export function createMcpServer(input: CreateMcpServerInput) {
  const timestamp = nowIso();
  const transport = input.transport ?? "streamable_http";
  const slug = slugify(input.name);
  const server: McpServer = {
    id: createId("mcp"),
    name: input.name,
    slug,
    url: input.url ?? "",
    headers: input.headers ?? {},
    transport,
    command: input.command ?? null,
    args: input.args ?? null,
    env: input.env ?? null,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO mcp_servers (id, name, slug, url, headers, transport, command, args, env, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      server.id,
      server.name,
      server.slug,
      server.url,
      JSON.stringify(server.headers),
      server.transport,
      server.command,
      server.args ? JSON.stringify(server.args) : null,
      server.env ? JSON.stringify(server.env) : null,
      server.enabled ? 1 : 0,
      server.createdAt,
      server.updatedAt
    );

  return server;
}
```

- [ ] **Step 4: Update `updateMcpServer` to regenerate slug when name changes**

In `lib/mcp-servers.ts`, update `updateMcpServer` to also update the slug when the name changes:

```typescript
export function updateMcpServer(
  serverId: string,
  input: UpdateMcpServerInput
) {
  const current = getMcpServer(serverId);
  if (!current) return null;

  const timestamp = nowIso();
  const name = input.name ?? current.name;
  const slug = input.name ? slugify(input.name) : current.slug;
  const url = input.url ?? current.url;
  const headers = input.headers ?? current.headers;
  const transport = input.transport ?? current.transport;
  const command = input.command !== undefined ? input.command : current.command;
  const args = input.args !== undefined ? input.args : current.args;
  const env = input.env !== undefined ? input.env : current.env;
  const enabled = input.enabled ?? current.enabled;

  getDb()
    .prepare(
      `UPDATE mcp_servers
       SET name = ?, slug = ?, url = ?, headers = ?, transport = ?, command = ?, args = ?, env = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      name,
      slug,
      url,
      JSON.stringify(headers),
      transport,
      command,
      args ? JSON.stringify(args) : null,
      env ? JSON.stringify(env) : null,
      enabled ? 1 : 0,
      timestamp,
      serverId
    );

  return getMcpServer(serverId);
}
```

- [ ] **Step 5: Run existing tests to verify DB changes work**

Run: `npx vitest run tests/unit/mcp-servers.test.ts`
Expected: FAIL (tests don't include `slug` yet, but DB operations should still work)

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts lib/mcp-servers.ts
git commit -m "Add slug column to DB schema and update MCP server CRUD"
```

---

### Task 3: Add slug uniqueness enforcement in API routes

**Files:**
- Modify: `app/api/mcp-servers/route.ts`
- Modify: `app/api/mcp-servers/[serverId]/route.ts`
- Modify: `lib/mcp-servers.ts` (add `getMcpServerBySlug`)

- [ ] **Step 1: Add `getMcpServerBySlug` function**

In `lib/mcp-servers.ts`, add a lookup function:

```typescript
export function getMcpServerBySlug(slug: string) {
  const row = getDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM mcp_servers
       WHERE slug = ?`
    )
    .get(slug) as McpServerRow | undefined;

  return row ? rowToMcpServer(row) : null;
}
```

- [ ] **Step 2: Add slug uniqueness check in the POST route**

In `app/api/mcp-servers/route.ts`, add the slug collision check after validation:

```typescript
import { createMcpServer, getMcpServerBySlug, listMcpServers } from "@/lib/mcp-servers";
import { slugify } from "@/lib/mcp-servers";

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid server config");

  const slug = slugify(body.data.name);
  const existing = getMcpServerBySlug(slug);
  if (existing) {
    return badRequest("An MCP server with a similar name already exists.");
  }

  return ok({ server: createMcpServer(body.data) }, { status: 201 });
}
```

- [ ] **Step 3: Add slug uniqueness check in the PATCH route**

In `app/api/mcp-servers/[serverId]/route.ts`, add a collision check when the name is being changed:

```typescript
import { deleteMcpServer, getMcpServer, getMcpServerBySlug, updateMcpServer } from "@/lib/mcp-servers";
import { slugify } from "@/lib/mcp-servers";
```

Inside the PATCH handler, after reading the body, add before the update call:

```typescript
if (body.name) {
  const slug = slugify(body.name);
  const conflicting = getMcpServerBySlug(slug);
  if (conflicting && conflicting.id !== params.data.serverId) {
    return badRequest("An MCP server with a similar name already exists.");
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/mcp-servers/route.ts app/api/mcp-servers/[serverId]/route.ts lib/mcp-servers.ts
git commit -m "Add slug uniqueness enforcement in API routes"
```

---

### Task 4: Update tool naming and routing in assistant-runtime

**Files:**
- Modify: `lib/assistant-runtime.ts:52-58` (mcpToolFunctionName)
- Modify: `lib/assistant-runtime.ts:141-157` (buildToolDefinitions)
- Modify: `lib/assistant-runtime.ts:366-383` (executeMcpToolCall routing)
- Modify: `lib/assistant-runtime.ts:246-268` (buildCapabilitiesSystemMessage)
- Modify: `lib/assistant-runtime.ts:270-286` (buildVisionMcpDirective)

- [ ] **Step 1: Update `mcpToolFunctionName` to use slug**

In `lib/assistant-runtime.ts`, replace the function:

```typescript
function mcpToolFunctionName(serverSlug: string, toolName: string) {
  return `mcp_${serverSlug}_${toolName}`;
}
```

Remove `sanitizeForFunctionName` since slugs are already sanitized.

- [ ] **Step 2: Update `buildToolDefinitions` to use `server.slug`**

Change line 147 from:
```typescript
name: mcpToolFunctionName(server.id, tool.name),
```
To:
```typescript
name: mcpToolFunctionName(server.slug, tool.name),
```

- [ ] **Step 3: Update `executeMcpToolCall` routing to use slug**

Replace the routing logic (lines 368-383) with:

```typescript
const withoutPrefix = functionName.slice(4);
const toolSets = context.input.mcpToolSets;
let resolvedServer: McpServer | null = null;
let resolvedTool: McpTool | null = null;

for (const { server, tools } of toolSets) {
  if (withoutPrefix.startsWith(server.slug + "_")) {
    const toolName = withoutPrefix.slice(server.slug.length + 1);
    const tool = tools.find((t) => t.name === toolName);
    if (tool) {
      resolvedServer = server;
      resolvedTool = tool;
      break;
    }
  }
}
```

- [ ] **Step 4: Simplify `buildCapabilitiesSystemMessage`**

Change lines 258-260 from:
```typescript
for (const server of mcpServers) {
  lines.push(`- ${server.name} (${server.id})`);
}
```
To:
```typescript
for (const server of mcpServers) {
  lines.push(`- ${server.name}`);
}
```

- [ ] **Step 5: Simplify `buildVisionMcpDirective`**

Change line 281 from:
```typescript
`Vision MCP server: ${mcpServer.name} (id: ${mcpServer.id})`,
```
To:
```typescript
`Vision MCP server: ${mcpServer.name}`,
```

- [ ] **Step 6: Remove unused `sanitizeForFunctionName` function**

Delete the `sanitizeForFunctionName` function (lines 52-54) since it's no longer used.

- [ ] **Step 7: Commit**

```bash
git add lib/assistant-runtime.ts
git commit -m "Use slug-based tool naming and simplify system message"
```

---

### Task 5: Update tests

**Files:**
- Modify: `tests/unit/mcp-servers.test.ts`
- Modify: `tests/unit/assistant-runtime.test.ts`

- [ ] **Step 1: Update `mcp-servers.test.ts` to verify slug field**

Add slug assertions to existing tests and add a new test for slug generation:

```typescript
it("creates, lists, updates, and deletes MCP servers", () => {
  const server = createMcpServer({
    name: "Test Server",
    url: "https://mcp.example.com/api",
    headers: { Authorization: "Bearer test123" }
  });

  expect(server.name).toBe("Test Server");
  expect(server.slug).toBe("test_server");
  expect(server.url).toBe("https://mcp.example.com/api");
  expect(server.headers).toEqual({ Authorization: "Bearer test123" });
  expect(server.enabled).toBe(true);

  const all = listMcpServers();
  expect(all).toHaveLength(1);

  const fetched = getMcpServer(server.id);
  expect(fetched?.slug).toBe("test_server");

  updateMcpServer(server.id, { name: "Updated Server", enabled: false });
  const updated = getMcpServer(server.id);
  expect(updated?.name).toBe("Updated Server");
  expect(updated?.slug).toBe("updated_server");
  expect(updated?.enabled).toBe(false);

  deleteMcpServer(server.id);
  expect(listMcpServers()).toHaveLength(0);
  expect(getMcpServer(server.id)).toBeNull();
});

it("generates correct slugs from names", () => {
  const cases = [
    { name: "My Exa Server", expectedSlug: "my_exa_server" },
    { name: "exa", expectedSlug: "exa" },
    { name: "  spaces  ", expectedSlug: "spaces" },
    { name: "special!@#chars", expectedSlug: "special_chars" },
    { name: "multiple---dashes", expectedSlug: "multiple_dashes" },
    { name: "UPPERCASE", expectedSlug: "uppercase" },
    { name: "under_score", expectedSlug: "under_score" }
  ];

  for (const { name, expectedSlug } of cases) {
    const server = createMcpServer({ name, url: "https://test.com" });
    expect(server.slug).toBe(expectedSlug);
    deleteMcpServer(server.id);
  }
});

it("rejects duplicate slug on create via DB constraint", () => {
  createMcpServer({ name: "Exa", url: "https://a.com" });
  expect(() => {
    createMcpServer({ name: "exa", url: "https://b.com" });
  }).toThrow();
});
```

- [ ] **Step 2: Update `assistant-runtime.test.ts` to use slug-based tool names**

In all test cases that reference MCP tool names, change from `mcp_mcp_{id}_{tool}` to `mcp_{slug}_{tool}`. Also add `slug` to mock server objects.

Key changes:
1. All mock `McpServer` objects need a `slug` field matching the expected tool naming
2. All `mcp_mcp_{id}_{toolName}` references become `mcp_{slug}_{toolName}`

For example, the server mock `{ id: "mcp_exa", name: "Exa", ... }` becomes `{ id: "mcp_exa", name: "Exa", slug: "exa", ... }` and tool name `mcp_mcp_exa_web_search` becomes `mcp_exa_web_search`.

Similarly `{ id: "mcp_docs", name: "Docs", ... }` becomes `{ id: "mcp_docs", name: "Docs", slug: "docs", ... }` and `mcp_mcp_docs_search_docs` becomes `mcp_docs_search_docs`.

The enum injection test on line 213 should check for `mcp_exa_web_search` instead of `mcp_mcp_exa_web_search`.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run tests/unit/mcp-servers.test.ts tests/unit/assistant-runtime.test.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/mcp-servers.test.ts tests/unit/assistant-runtime.test.ts
git commit -m "Update tests for slug-based MCP tool naming"
```

---

### Task 6: Update frontend to display slug collision errors

**Files:**
- Modify: `components/settings/sections/mcp-servers-section.tsx`

- [ ] **Step 1: Show slug collision error from API**

In `mcp-servers-section.tsx`, update the save handler to read the error message from the API response when it fails.

In the `saveMcpServer` function, change the error handling for the POST case:

```typescript
if (!postRes.ok) {
  const errorData = await postRes.json().catch(() => null);
  setError(errorData?.error ?? "Failed to add server");
  return;
}
```

And for the PATCH case:

```typescript
if (!patchRes.ok) {
  const errorData = await patchRes.json().catch(() => null);
  setError(errorData?.error ?? "Failed to update server");
  return;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/sections/mcp-servers-section.tsx
git commit -m "Show slug collision errors in MCP server settings UI"
```

---

### Task 7: Run full test suite and verify

**Files:** None

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Delete existing database and verify fresh start works**

Since the project is in dev, delete the existing database to get a clean schema:

```bash
rm -f $EIDON_DATA_DIR/eidon.db
```

Or if `EIDON_DATA_DIR` is not set, find and remove the DB file.

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "Fix test failures from MCP slug migration"
```
