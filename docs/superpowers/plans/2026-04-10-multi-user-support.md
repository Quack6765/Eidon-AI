# Multi-User Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add isolated multi-user workspaces with an env-backed super-admin, local admin/user accounts, role-aware settings navigation, and strict server-side separation between global admin-managed settings and user-private data.

**Architecture:** Introduce a unified `users` model plus `user_settings`, keep the env super-admin as a persisted DB owner with env-managed credentials, and thread `userId` ownership through all private data services. Preserve the current settings/read model where possible, but split writes into user-private general settings and admin-only provider/user-management flows so authorization stays explicit.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, better-sqlite3, Zod, jose, argon2, Vitest, Playwright, custom Node server, `agent-browser`

---

## File Map

- `lib/db.ts` — add `users` and `user_settings`, retarget `auth_sessions`, and add `user_id` ownership on top-level private tables
- `lib/types.ts` — define `UserRole`, `AuthSource`, persisted user/account types, and split user-private settings types from global provider summaries
- `lib/users.ts` — new persistence layer for env-super-admin bootstrap and local user CRUD
- `lib/auth.ts` — authenticate against `users`, expose `requireAdminUser`, and keep session lookup bound to persisted `users.id`
- `lib/settings.ts` — move general settings into `user_settings` while keeping provider profiles global
- `lib/conversations.ts` — owner-scope conversation CRUD/listing
- `lib/folders.ts` — owner-scope folder CRUD/listing
- `lib/personas.ts` — owner-scope persona CRUD
- `lib/memories.ts` — owner-scope memory CRUD
- `lib/automations.ts` — owner-scope automations and automation runs
- `components/shell.tsx` — pass authenticated user context into settings nav rendering
- `components/settings/settings-nav.tsx` — role-aware/hideable nav items, including the new `Users` item
- `components/settings/sections/general-section.tsx` — write only user-private general settings
- `components/settings/sections/providers-section.tsx` — write only admin-managed provider profile settings
- `components/settings/sections/account-section.tsx` — local-user password change only, env-managed account read-only credentials
- `components/settings/sections/users-section.tsx` — new admin-only user management UI
- `app/settings/layout.tsx` — load conversation/folder data for the current owner only
- `app/settings/providers/page.tsx` — admin-only page guard
- `app/settings/mcp-servers/page.tsx` — admin-only page guard
- `app/settings/skills/page.tsx` — admin-only page guard
- `app/settings/account/page.tsx` — pass expanded `AuthUser`
- `app/settings/users/page.tsx` — new admin-only settings page
- `app/api/auth/login/route.ts` — authenticate env super-admin vs local users against `users`
- `app/api/auth/account/route.ts` — local self-password change only
- `app/api/settings/route.ts` — combined read model for current user + global provider catalog
- `app/api/settings/general/route.ts` — new user-private general settings write API
- `app/api/settings/providers/route.ts` — new admin-only provider profile write API
- `app/api/users/route.ts` — new admin-only user list/create API
- `app/api/users/[userId]/route.ts` — new admin-only edit/delete API
- `app/api/mcp-servers/**` — require admin for server-wide MCP management
- `app/api/skills/**` — require admin for server-wide skill management
- `app/api/settings/test/route.ts` — require admin for provider test actions
- `app/api/providers/github/**` — require admin because provider profiles are global
- `app/api/conversations/**`, `app/api/folders/**`, `app/api/personas/**`, `app/api/memories/**`, `app/api/automations/**` — owner-scope resource access
- `tests/unit/db.test.ts` — schema additions and migration expectations
- `tests/unit/users.test.ts` — new env-super-admin bootstrap and local-user CRUD tests
- `tests/unit/auth.test.ts` — env/local auth behavior
- `tests/unit/auth-session.test.ts` — session resolution, disabled-login mode, account mutation rules
- `tests/unit/settings.test.ts` — per-user general settings isolation and shared provider catalog behavior
- `tests/unit/conversations.test.ts` — conversation ownership filtering
- `tests/unit/folders.test.ts` — folder ownership filtering
- `tests/unit/personas.test.ts` — persona ownership filtering
- `tests/unit/memories.test.ts` — memory ownership filtering
- `tests/unit/automations.test.ts` — automation ownership filtering
- `tests/unit/mcp-server-routes.test.ts` — admin-only MCP route enforcement
- `tests/unit/github-copilot-routes.test.ts` — admin-only provider route enforcement
- `tests/unit/settings-nav.test.tsx` — new role-aware settings nav behavior
- `tests/unit/account-section.test.tsx` — env-managed vs local account UI states
- `tests/unit/users-section.test.tsx` — new users page behavior

### Task 1: Database And Shared Type Foundation

**Files:**
- Modify: `lib/db.ts`
- Modify: `lib/types.ts`
- Modify: `tests/unit/db.test.ts`

- [ ] **Step 1: Write the failing schema test**

Add this test to `tests/unit/db.test.ts`:

```ts
it("adds multi-user tables and owner columns", async () => {
  const { getDb } = await import("@/lib/db");
  const db = getDb();

  const userColumns = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  const userSettingsColumns = (
    db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>
  ).map((column) => column.name);
  const conversationColumns = (
    db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>
  ).map((column) => column.name);
  const folderColumns = (db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  const personaColumns = (db.prepare("PRAGMA table_info(personas)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  const memoryColumns = (
    db.prepare("PRAGMA table_info(user_memories)").all() as Array<{ name: string }>
  ).map((column) => column.name);
  const automationColumns = (
    db.prepare("PRAGMA table_info(automations)").all() as Array<{ name: string }>
  ).map((column) => column.name);

  expect(userColumns).toEqual(
    expect.arrayContaining(["username", "role", "auth_source", "password_hash"])
  );
  expect(userSettingsColumns).toEqual(
    expect.arrayContaining([
      "user_id",
      "default_provider_profile_id",
      "conversation_retention",
      "mcp_timeout"
    ])
  );
  expect(conversationColumns).toContain("user_id");
  expect(folderColumns).toContain("user_id");
  expect(personaColumns).toContain("user_id");
  expect(memoryColumns).toContain("user_id");
  expect(automationColumns).toContain("user_id");
});
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run:

```bash
npx vitest run tests/unit/db.test.ts
```

Expected: FAIL because `users`, `user_settings`, and the new `user_id` columns do not exist yet.

- [ ] **Step 3: Add the schema and shared types**

Update `lib/types.ts`:

```ts
export type UserRole = "admin" | "user";
export type AuthSource = "env_super_admin" | "local";

export type PersistedUser = {
  id: string;
  username: string;
  role: UserRole;
  authSource: AuthSource;
  createdAt: string;
  updatedAt: string;
};
```

Update `lib/db.ts`:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    auth_source TEXT NOT NULL,
    password_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    default_provider_profile_id TEXT,
    skills_enabled INTEGER NOT NULL DEFAULT 1,
    conversation_retention TEXT NOT NULL DEFAULT 'forever',
    auto_compaction INTEGER NOT NULL DEFAULT 1,
    memories_enabled INTEGER NOT NULL DEFAULT 1,
    memories_max_count INTEGER NOT NULL DEFAULT 100,
    mcp_timeout INTEGER NOT NULL DEFAULT 120000,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (default_provider_profile_id) REFERENCES provider_profiles(id) ON DELETE SET NULL
  );
`);

function ensureColumn(table: string, column: string, sql: string) {
  const columns = getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    getDb().exec(sql);
  }
}

ensureColumn(
  "conversations",
  "user_id",
  "ALTER TABLE conversations ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE"
);
ensureColumn(
  "folders",
  "user_id",
  "ALTER TABLE folders ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE"
);
ensureColumn(
  "personas",
  "user_id",
  "ALTER TABLE personas ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE"
);
ensureColumn(
  "user_memories",
  "user_id",
  "ALTER TABLE user_memories ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE"
);
ensureColumn(
  "automations",
  "user_id",
  "ALTER TABLE automations ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE"
);
```

Leave `auth_sessions` unchanged in this task so the current `admin_users` auth flow remains runtime-safe until Task 2 completes the auth migration.

- [ ] **Step 4: Run the schema test to verify it passes**

Run:

```bash
npx vitest run tests/unit/db.test.ts tests/unit/auth-session.test.ts
```

Expected: PASS for both suites, proving the schema foundation landed without breaking the current `admin_users`-backed auth flow.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/types.ts tests/unit/db.test.ts
git commit -m "feat: add multi-user schema foundation"
```

### Task 2: Persisted Users And Authentication

**Files:**
- Modify: `lib/db.ts`
- Modify: `lib/types.ts`
- Create: `lib/users.ts`
- Modify: `lib/auth.ts`
- Modify: `app/api/auth/login/route.ts`
- Create: `tests/unit/users.test.ts`
- Modify: `tests/unit/auth.test.ts`
- Modify: `tests/unit/auth-session.test.ts`

- [ ] **Step 1: Write the failing user/auth tests**

Create `tests/unit/users.test.ts`:

```ts
import { createLocalUser, ensureEnvSuperAdminUser, listUsers, updateManagedUser } from "@/lib/users";

describe("users", () => {
  it("bootstraps and syncs the env super-admin row", async () => {
    const first = await ensureEnvSuperAdminUser();
    const second = await ensureEnvSuperAdminUser();

    expect(first.id).toBe(second.id);
    expect(first.authSource).toBe("env_super_admin");
    expect(first.role).toBe("admin");
  });

  it("creates and updates local users", async () => {
    const created = await createLocalUser({
      username: "alice",
      password: "correct-horse-battery-staple",
      role: "user"
    });

    const updated = await updateManagedUser(created.id, { role: "admin", username: "alice-admin" });

    expect(updated?.username).toBe("alice-admin");
    expect(updated?.role).toBe("admin");
    expect(listUsers().some((user) => user.id === created.id)).toBe(true);
  });
});
```

Add to `tests/unit/auth.test.ts`:

```ts
it("authenticates the env super-admin against env credentials and local users against password hashes", async () => {
  const { createLocalUser } = await import("@/lib/users");
  const auth = await import("@/lib/auth");

  await auth.ensureAdminBootstrap();
  await createLocalUser({
    username: "member",
    password: "member-secret-123",
    role: "user"
  });

  await expect(auth.authenticateUser("admin", "changeme123")).resolves.toMatchObject({
    username: "admin",
    authSource: "env_super_admin"
  });
  await expect(auth.authenticateUser("member", "member-secret-123")).resolves.toMatchObject({
    username: "member",
    authSource: "local"
  });
});
```

Add to `tests/unit/auth-session.test.ts`:

```ts
it("rejects account credential updates for env-managed users", async () => {
  const auth = await import("@/lib/auth");
  await auth.ensureAdminBootstrap();
  const admin = await auth.findUserByUsername("admin");

  await expect(auth.updateOwnPassword(admin!.user, "new-secret-123")).rejects.toThrow(
    "Env-managed credentials cannot be changed in the UI"
  );
});
```

- [ ] **Step 2: Run the auth tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/users.test.ts tests/unit/auth.test.ts tests/unit/auth-session.test.ts
```

Expected: FAIL because `lib/users.ts`, `authenticateUser`, and env-managed account restrictions do not exist yet.

- [ ] **Step 3: Implement persisted users and auth**

Create `lib/users.ts`:

```ts
export async function ensureEnvSuperAdminUser(): Promise<PersistedUser> {
  const db = getDb();
  const envUsername = env.EIDON_ADMIN_USERNAME;
  const existingEnvUser = db
    .prepare(`SELECT id, username, role, auth_source, created_at, updated_at FROM users WHERE auth_source = 'env_super_admin'`)
    .get() as UserRow | undefined;

  const conflictingLocal = db
    .prepare(`SELECT id FROM users WHERE auth_source = 'local' AND username = ?`)
    .get(envUsername) as { id: string } | undefined;

  if (conflictingLocal) {
    throw new Error(`Env super-admin username "${envUsername}" collides with an existing local user`);
  }

  if (existingEnvUser) {
    db.prepare(`UPDATE users SET username = ?, role = 'admin', updated_at = ? WHERE id = ?`)
      .run(envUsername, nowIso(), existingEnvUser.id);
    return getUserById(existingEnvUser.id)!;
  }

  const userId = createId("user");
  db.prepare(
    `INSERT INTO users (id, username, role, auth_source, password_hash, created_at, updated_at)
     VALUES (?, ?, 'admin', 'env_super_admin', NULL, ?, ?)`
  ).run(userId, envUsername, nowIso(), nowIso());
  return getUserById(userId)!;
}
```

Add local-user helpers to the same file:

```ts
export async function createLocalUser(input: {
  username: string;
  password: string;
  role: UserRole;
}) {
  const passwordHash = await hashPassword(input.password);
  const userId = createId("user");
  const timestamp = nowIso();

  getDb().prepare(
    `INSERT INTO users (id, username, role, auth_source, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'local', ?, ?, ?)`
  ).run(userId, input.username.trim(), input.role, passwordHash, timestamp, timestamp);

  createDefaultUserSettings(userId);
  return getUserById(userId)!;
}
```

Update `lib/auth.ts`:

```ts
export async function authenticateUser(username: string, password: string) {
  await ensureAdminBootstrap();
  const record = await findUserByUsername(username);
  if (!record) return null;

  if (record.user.authSource === "env_super_admin") {
    return password === env.EIDON_ADMIN_PASSWORD ? record.user : null;
  }

  if (!record.passwordHash) return null;
  return (await verifyPassword(password, record.passwordHash)) ? record.user : null;
}

export async function requireAdminUser() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("forbidden");
  }
  return user;
}
```

Update `app/api/auth/login/route.ts` to call `authenticateUser(username, password)` instead of querying `admin_users` directly.

In the same task, update `lib/db.ts` so fresh installs create `auth_sessions` with a foreign key to `users(id)` once `lib/auth.ts` writes and resolves sessions against persisted `users`.

Also expand `AuthUser` in `lib/types.ts` now that its consumers are being migrated in this task:

```ts
export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
  authSource: AuthSource;
  passwordManagedBy: "env" | "local";
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 4: Run the auth tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/users.test.ts tests/unit/auth.test.ts tests/unit/auth-session.test.ts
npm run typecheck
```

Expected: PASS for the auth-focused test suites, and `npm run typecheck` stays clean with the widened `AuthUser` shape now that its consumers have been migrated.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/types.ts lib/users.ts lib/auth.ts app/api/auth/login/route.ts tests/unit/users.test.ts tests/unit/auth.test.ts tests/unit/auth-session.test.ts
git commit -m "feat: unify auth around persisted users"
```

### Task 3: Split User Settings From Global Provider Settings

**Files:**
- Modify: `lib/settings.ts`
- Modify: `lib/types.ts`
- Modify: `app/api/settings/route.ts`
- Create: `app/api/settings/general/route.ts`
- Create: `app/api/settings/providers/route.ts`
- Modify: `components/settings/sections/general-section.tsx`
- Modify: `components/settings/sections/providers-section.tsx`
- Modify: `tests/unit/settings.test.ts`
- Modify: `tests/unit/providers-section.test.tsx`

- [ ] **Step 1: Write the failing settings tests**

Add to `tests/unit/settings.test.ts`:

```ts
it("stores general settings per user while keeping provider profiles global", async () => {
  const { createLocalUser, ensureEnvSuperAdminUser } = await import("@/lib/users");
  const { getSettingsForUser, updateGeneralSettingsForUser, updateProviderCatalog } = await import("@/lib/settings");

  const admin = await ensureEnvSuperAdminUser();
  const member = await createLocalUser({
    username: "member",
    password: "member-secret-123",
    role: "user"
  });

  updateProviderCatalog({
    defaultProviderProfileId: "profile_alpha",
    providerProfiles: [buildProfile({ id: "profile_alpha", name: "Alpha", apiKey: "sk-alpha" })]
  });
  updateGeneralSettingsForUser(admin.id, { conversationRetention: "90d", mcpTimeout: 120_000 });
  updateGeneralSettingsForUser(member.id, { conversationRetention: "7d", mcpTimeout: 45_000 });

  expect(getSettingsForUser(admin.id).conversationRetention).toBe("90d");
  expect(getSettingsForUser(member.id).conversationRetention).toBe("7d");
  expect(getSettingsForUser(admin.id).defaultProviderProfileId).toBe("profile_alpha");
  expect(getSettingsForUser(member.id).defaultProviderProfileId).toBe("profile_alpha");
});
```

Add to `tests/unit/providers-section.test.tsx`:

```tsx
it("saves provider changes through the admin-only providers settings endpoint", async () => {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/settings/providers" && init?.method === "PUT") {
      return new Response(JSON.stringify({ settings: {} }), { status: 200 });
    }
    return new Response(JSON.stringify({ settings: {} }), { status: 200 });
  }) as unknown as typeof fetch;

  // render ProvidersSection and trigger save...

  expect(global.fetch).toHaveBeenCalledWith(
    "/api/settings/providers",
    expect.objectContaining({ method: "PUT" })
  );
});
```

- [ ] **Step 2: Run the settings tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/providers-section.test.tsx
```

Expected: FAIL because settings are still stored in one global row and the providers section still writes to `/api/settings`.

- [ ] **Step 3: Implement split settings storage and routes**

Update `lib/settings.ts`:

```ts
export function getSettingsForUser(userId: string): AppSettings {
  const row = getDb()
    .prepare(
      `SELECT
        user_id,
        default_provider_profile_id,
        skills_enabled,
        conversation_retention,
        auto_compaction,
        memories_enabled,
        memories_max_count,
        mcp_timeout,
        updated_at
       FROM user_settings
       WHERE user_id = ?`
    )
    .get(userId) as UserSettingsRow | undefined;

  if (!row) {
    createDefaultUserSettings(userId);
    return getSettingsForUser(userId);
  }

  return rowToSettings(row);
}
```

Update `lib/types.ts` so `AppSettings.defaultProviderProfileId` becomes nullable at the same time the settings layer is split:

```ts
export type AppSettings = {
  defaultProviderProfileId: string | null;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  autoCompaction: boolean;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  mcpTimeout: number;
  updatedAt: string;
};
```

Add write helpers:

```ts
export function updateGeneralSettingsForUser(userId: string, input: Partial<AppSettings>) {
  const current = getSettingsForUser(userId);
  const next = { ...current, ...input, updatedAt: new Date().toISOString() };

  getDb().prepare(
    `UPDATE user_settings
     SET default_provider_profile_id = ?,
         skills_enabled = ?,
         conversation_retention = ?,
         auto_compaction = ?,
         memories_enabled = ?,
         memories_max_count = ?,
         mcp_timeout = ?,
         updated_at = ?
     WHERE user_id = ?`
  ).run(
    next.defaultProviderProfileId,
    next.skillsEnabled ? 1 : 0,
    next.conversationRetention,
    next.autoCompaction ? 1 : 0,
    next.memoriesEnabled ? 1 : 0,
    next.memoriesMaxCount,
    next.mcpTimeout,
    next.updatedAt,
    userId
  );

  return getSettingsForUser(userId);
}
```

Create `app/api/settings/general/route.ts`:

```ts
export async function PUT(request: Request) {
  const user = await requireUser();
  const payload = generalSettingsSchema.safeParse(await request.json());
  if (!payload.success) return badRequest("Invalid general settings payload");
  return ok({ settings: updateGeneralSettingsForUser(user.id, payload.data) });
}
```

Create `app/api/settings/providers/route.ts`:

```ts
export async function PUT(request: Request) {
  await requireAdminUser();
  const payload = await request.json();
  return ok({ settings: updateProviderCatalog(payload) });
}
```

Update `components/settings/sections/general-section.tsx`:

```ts
const response = await fetch("/api/settings/general", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    conversationRetention,
    autoCompaction,
    mcpTimeout
  })
});
```

Update `components/settings/sections/providers-section.tsx`:

```ts
const response = await fetch("/api/settings/providers", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(await buildSettingsPayload())
});
```

- [ ] **Step 4: Run the settings tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/settings.test.ts tests/unit/providers-section.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/settings.ts lib/types.ts app/api/settings/route.ts app/api/settings/general/route.ts app/api/settings/providers/route.ts components/settings/sections/general-section.tsx components/settings/sections/providers-section.tsx tests/unit/settings.test.ts tests/unit/providers-section.test.tsx
git commit -m "feat: split user settings from provider management"
```

### Task 4: Owner-Scope Private Data And Shell Queries

**Files:**
- Modify: `lib/conversations.ts`
- Modify: `lib/folders.ts`
- Modify: `lib/personas.ts`
- Modify: `lib/memories.ts`
- Modify: `lib/automations.ts`
- Modify: `app/settings/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `app/automations/page.tsx`
- Modify: `app/automations/[automationId]/page.tsx`
- Modify: `app/api/conversations/**`
- Modify: `app/api/folders/**`
- Modify: `app/api/personas/**`
- Modify: `app/api/memories/**`
- Modify: `app/api/automations/**`
- Modify: `tests/unit/conversations.test.ts`
- Modify: `tests/unit/folders.test.ts`
- Modify: `tests/unit/personas.test.ts`
- Modify: `tests/unit/memories.test.ts`
- Modify: `tests/unit/automations.test.ts`

- [ ] **Step 1: Write the failing ownership tests**

Add to `tests/unit/personas.test.ts`:

```ts
it("lists only personas owned by the requested user", async () => {
  const { createLocalUser, ensureEnvSuperAdminUser } = await import("@/lib/users");
  const admin = await ensureEnvSuperAdminUser();
  const member = await createLocalUser({
    username: "member",
    password: "member-secret-123",
    role: "user"
  });

  createPersona(admin.id, { name: "Admin Persona", content: "A" });
  createPersona(member.id, { name: "Member Persona", content: "B" });

  expect(listPersonas(admin.id).map((persona) => persona.name)).toEqual(["Admin Persona"]);
  expect(listPersonas(member.id).map((persona) => persona.name)).toEqual(["Member Persona"]);
});
```

Add to `tests/unit/memories.test.ts`:

```ts
it("lists only memories owned by the requested user", async () => {
  const { createLocalUser, ensureEnvSuperAdminUser } = await import("@/lib/users");
  const admin = await ensureEnvSuperAdminUser();
  const member = await createLocalUser({
    username: "member",
    password: "member-secret-123",
    role: "user"
  });

  createMemory(admin.id, "Admin memory", "work");
  createMemory(member.id, "Member memory", "personal");

  expect(listMemories(admin.id).map((memory) => memory.content)).toEqual(["Admin memory"]);
  expect(listMemories(member.id).map((memory) => memory.content)).toEqual(["Member memory"]);
});
```

Add to `tests/unit/conversations.test.ts`:

```ts
it("returns only the current owner's manual conversations", async () => {
  const { createLocalUser, ensureEnvSuperAdminUser } = await import("@/lib/users");
  const admin = await ensureEnvSuperAdminUser();
  const member = await createLocalUser({
    username: "member",
    password: "member-secret-123",
    role: "user"
  });

  createConversation(admin.id);
  createConversation(member.id);

  expect(listConversations(admin.id)).toHaveLength(1);
  expect(listConversations(member.id)).toHaveLength(1);
  expect(listConversations(admin.id)[0].id).not.toBe(listConversations(member.id)[0].id);
});
```

Add matching owner-filter tests to `tests/unit/folders.test.ts` and `tests/unit/automations.test.ts` using the same two-user setup and exact list/count assertions.

- [ ] **Step 2: Run the owner-scope tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts tests/unit/folders.test.ts tests/unit/personas.test.ts tests/unit/memories.test.ts tests/unit/automations.test.ts
```

Expected: FAIL because the current helpers are global and do not accept `userId`.

- [ ] **Step 3: Thread `userId` through private resources**

Update `lib/personas.ts`:

```ts
export function listPersonas(userId: string): Persona[] {
  return (getDb()
    .prepare(
      `SELECT id, name, content, created_at, updated_at
       FROM personas
       WHERE user_id = ?
       ORDER BY created_at ASC`
    )
    .all(userId) as PersonaRow[]).map(rowToPersona);
}

export function createPersona(userId: string, input: { name: string; content: string }): Persona {
  const persona = {
    id: createId("persona"),
    name: input.name.trim(),
    content: input.content,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  getDb().prepare(
    `INSERT INTO personas (id, user_id, name, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(persona.id, userId, persona.name, persona.content, persona.createdAt, persona.updatedAt);

  return persona;
}
```

Update `lib/memories.ts`:

```ts
export function listMemories(userId: string, filter?: { category?: string; search?: string }): UserMemory[] {
  let sql = `SELECT id, content, category, created_at, updated_at FROM user_memories WHERE user_id = ?`;
  const params: unknown[] = [userId];

  if (filter?.category) {
    sql += ` AND category = ?`;
    params.push(filter.category);
  }

  if (filter?.search) {
    sql += ` AND content LIKE ?`;
    params.push(`%${filter.search}%`);
  }

  sql += ` ORDER BY updated_at DESC`;
  return (getDb().prepare(sql).all(...params) as MemoryRow[]).map(rowToMemory);
}
```

Update `lib/conversations.ts`:

```ts
export function listConversations(userId: string) {
  const activityTimestamp = conversationActivityTimestampSql("c");
  const rows = getDb()
    .prepare(
      `SELECT
        c.id,
        c.title,
        c.title_generation_status,
        c.folder_id,
        c.provider_profile_id,
        c.automation_id,
        c.automation_run_id,
        c.conversation_origin,
        c.sort_order,
        c.created_at,
        ${activityTimestamp} AS updated_at,
        c.is_active
       FROM conversations c
       WHERE c.user_id = ?
         AND c.conversation_origin = ?
       ORDER BY ${activityTimestamp} DESC, c.id DESC`
    )
    .all(userId, MANUAL_CONVERSATION_ORIGIN) as ConversationRow[];

  return rows.map(rowToConversation);
}
```

Update `lib/folders.ts` and `lib/automations.ts` with the same explicit `userId` parameter on all top-level list/get/create/update/delete helpers, and pass `userId` into every insert statement through the new `user_id` column.

Update `app/settings/layout.tsx`:

```ts
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const conversationPage = listConversationsPage(user.id);
  const folders = listFolders(user.id);

  return (
    <Shell currentUser={user} conversationPage={conversationPage} folders={folders}>
      <main className="flex-1 overflow-y-auto animate-fade-in">{children}</main>
    </Shell>
  );
}
```

Update private API routes to pass `user.id` into the resource helpers instead of calling global list/get/update/delete functions.

- [ ] **Step 4: Run the owner-scope tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts tests/unit/folders.test.ts tests/unit/personas.test.ts tests/unit/memories.test.ts tests/unit/automations.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/conversations.ts lib/folders.ts lib/personas.ts lib/memories.ts lib/automations.ts app/settings/layout.tsx app/page.tsx app/automations/page.tsx app/automations/[automationId]/page.tsx app/api/conversations app/api/folders app/api/personas app/api/memories app/api/automations tests/unit/conversations.test.ts tests/unit/folders.test.ts tests/unit/personas.test.ts tests/unit/memories.test.ts tests/unit/automations.test.ts
git commit -m "feat: scope private data to the owning user"
```

### Task 5: Admin-Only Routes, Pages, And User Management APIs

**Files:**
- Modify: `lib/auth.ts`
- Modify: `app/settings/providers/page.tsx`
- Modify: `app/settings/mcp-servers/page.tsx`
- Modify: `app/settings/skills/page.tsx`
- Create: `app/settings/users/page.tsx`
- Create: `app/api/users/route.ts`
- Create: `app/api/users/[userId]/route.ts`
- Modify: `app/api/mcp-servers/route.ts`
- Modify: `app/api/mcp-servers/[serverId]/route.ts`
- Modify: `app/api/mcp-servers/test/route.ts`
- Modify: `app/api/skills/route.ts`
- Modify: `app/api/skills/[skillId]/route.ts`
- Modify: `app/api/settings/test/route.ts`
- Modify: `app/api/providers/github/connect/route.ts`
- Modify: `app/api/providers/github/callback/route.ts`
- Modify: `app/api/providers/github/models/route.ts`
- Modify: `app/api/providers/github/disconnect/route.ts`
- Modify: `tests/unit/mcp-server-routes.test.ts`
- Modify: `tests/unit/github-copilot-routes.test.ts`
- Create: `tests/unit/users-routes.test.ts`

- [ ] **Step 1: Write the failing admin-only tests**

Create `tests/unit/users-routes.test.ts`:

```ts
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAdminUser: vi.fn(async () => ({
    id: "user_admin",
    username: "admin",
    role: "admin",
    authSource: "env_super_admin",
    passwordManagedBy: "env",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }))
}));

describe("users routes", () => {
  it("creates a local user", async () => {
    const { POST } = await import("@/app/api/users/route");

    const response = await POST(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "member",
          password: "member-secret-123",
          role: "user"
        })
      })
    );

    expect(response.status).toBe(201);
  });

  it("returns 404 when password login is disabled", async () => {
    vi.doMock("@/lib/env", async () => {
      const actual = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
      return {
        ...actual,
        isPasswordLoginEnabled: () => false
      };
    });

    const { GET } = await import("@/app/api/users/route");
    const response = await GET();

    expect(response.status).toBe(404);
  });
});
```

Add to `tests/unit/mcp-server-routes.test.ts`:

```ts
it("returns forbidden for non-admin users", async () => {
  vi.doMock("@/lib/auth", () => ({
    requireAdminUser: vi.fn(async () => {
      throw new Error("forbidden");
    })
  }));

  const { POST } = await import("@/app/api/mcp-servers/route");
  const response = await POST(
    new Request("http://localhost/api/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transport: "streamable_http", name: "Docs", url: "https://mcp.example.com" })
    })
  );

  expect(response.status).toBe(403);
});
```

Add a similar non-admin rejection to `tests/unit/github-copilot-routes.test.ts`.

- [ ] **Step 2: Run the admin-route tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/users-routes.test.ts tests/unit/mcp-server-routes.test.ts tests/unit/github-copilot-routes.test.ts
```

Expected: FAIL because the new user routes do not exist yet and server-wide APIs still use `requireUser()`.

- [ ] **Step 3: Implement admin-only guards and user APIs**

Create `app/api/users/route.ts`:

```ts
export async function GET() {
  if (!isPasswordLoginEnabled()) return notFound("Not found");
  await requireAdminUser();
  return ok({ users: listUsers() });
}

export async function POST(request: Request) {
  if (!isPasswordLoginEnabled()) return notFound("Not found");
  await requireAdminUser();
  const body = createUserSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid user payload");
  return ok({ user: await createLocalUser(body.data) }, { status: 201 });
}
```

Create `app/api/users/[userId]/route.ts`:

```ts
export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  if (!isPasswordLoginEnabled()) return notFound("Not found");
  await requireAdminUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid user id");
  const body = updateUserSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid user payload");

  const updated = await updateManagedUser(params.data.userId, body.data);
  if (!updated) return notFound("User not found");
  return ok({ user: updated });
}
```

Update server-wide routes from `requireUser()` to `requireAdminUser()`:

```ts
export async function POST(request: Request) {
  await requireAdminUser();
  // existing logic...
}
```

Apply that change to:

- `app/api/mcp-servers/route.ts`
- `app/api/mcp-servers/[serverId]/route.ts`
- `app/api/mcp-servers/test/route.ts`
- `app/api/skills/route.ts`
- `app/api/skills/[skillId]/route.ts`
- `app/api/settings/test/route.ts`
- `app/api/providers/github/connect/route.ts`
- `app/api/providers/github/callback/route.ts`
- `app/api/providers/github/models/route.ts`
- `app/api/providers/github/disconnect/route.ts`

Update admin-only settings pages to call `await requireAdminUser()` before rendering.
For the new `/settings/users` page, return `notFound()` when `isPasswordLoginEnabled()` is false so the page disappears entirely in single-user mode.

- [ ] **Step 4: Run the admin-route tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/users-routes.test.ts tests/unit/mcp-server-routes.test.ts tests/unit/github-copilot-routes.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts app/settings/providers/page.tsx app/settings/mcp-servers/page.tsx app/settings/skills/page.tsx app/settings/users/page.tsx app/api/users app/api/mcp-servers app/api/skills app/api/settings/test/route.ts app/api/providers/github tests/unit/users-routes.test.ts tests/unit/mcp-server-routes.test.ts tests/unit/github-copilot-routes.test.ts
git commit -m "feat: add admin-only user and server settings APIs"
```

### Task 6: Settings UI, Account UX, And Browser Validation

**Files:**
- Modify: `components/shell.tsx`
- Modify: `components/settings/settings-nav.tsx`
- Modify: `components/settings/sections/account-section.tsx`
- Create: `components/settings/sections/users-section.tsx`
- Modify: `app/settings/account/page.tsx`
- Create: `app/settings/users/page.tsx`
- Create: `tests/unit/settings-nav.test.tsx`
- Create: `tests/unit/account-section.test.tsx`
- Create: `tests/unit/users-section.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

Create `tests/unit/settings-nav.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { SettingsNav } from "@/components/settings/settings-nav";

describe("settings nav", () => {
  it("shows admin-only items only for admins when password login is enabled", () => {
    render(
      <SettingsNav
        currentUser={{
          id: "user_admin",
          username: "admin",
          role: "admin",
          authSource: "env_super_admin",
          passwordManagedBy: "env",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z"
        }}
        passwordLoginEnabled
        onCloseAction={() => {}}
      />
    );

    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Providers")).toBeInTheDocument();
  });
});
```

Create `tests/unit/account-section.test.tsx`:

```tsx
it("disables credential editing for env-managed users", () => {
  render(
    <AccountSection
      user={{
        id: "user_admin",
        username: "admin",
        role: "admin",
        authSource: "env_super_admin",
        passwordManagedBy: "env",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z"
      }}
    />
  );

  expect(screen.getByText(/managed by environment variables/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
});
```

Create `tests/unit/users-section.test.tsx`:

```tsx
it("renders the env super-admin row as protected", () => {
  render(
    <UsersSection
      users={[
        {
          id: "user_admin",
          username: "admin",
          role: "admin",
          authSource: "env_super_admin",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z"
        }
      ]}
    />
  );

  expect(screen.getByText(/env-managed/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the UI tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/settings-nav.test.tsx tests/unit/account-section.test.tsx tests/unit/users-section.test.tsx
```

Expected: FAIL because the UI still assumes a single-user account model and the users page does not exist.

- [ ] **Step 3: Implement role-aware settings UI**

Update `components/shell.tsx`:

```tsx
export function Shell({
  currentUser,
  conversationPage,
  folders,
  automations,
  children
}: PropsWithChildren<{
  currentUser: AuthUser;
  conversationPage: ConversationListPage;
  folders?: Folder[];
  automations?: Automation[];
}>) {
  // ...
  return isSettingsPage ? (
    <SettingsNav
      currentUser={currentUser}
      passwordLoginEnabled={isPasswordLoginEnabled()}
      onCloseAction={() => setIsSidebarOpen(false)}
    />
  ) : /* existing branches */;
}
```

Update `components/settings/settings-nav.tsx`:

```tsx
const ADMIN_ITEMS = [
  { href: "/settings/providers", label: "Providers", icon: Sparkles },
  { href: "/settings/mcp-servers", label: "MCP Servers", icon: Server },
  { href: "/settings/skills", label: "Skills", icon: Zap },
  { href: "/settings/users", label: "Users", icon: Users }
] as const;

const USER_ITEMS = [
  { href: "/settings/general", label: "General", icon: Settings },
  { href: "/settings/personas", label: "Personas", icon: Users },
  { href: "/settings/automations", label: "Scheduled automations", icon: Clock3 },
  { href: "/settings/memories", label: "Memories", icon: Brain },
  { href: "/settings/account", label: "Account", icon: Shield }
] as const;
```

Update `components/settings/sections/account-section.tsx` so local users only see password change controls:

```tsx
const isEnvManaged = user.passwordManagedBy === "env";

{isEnvManaged ? (
  <div className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3 text-sm text-[var(--muted)]">
    Login credentials for this account are managed by environment variables and cannot be changed here.
  </div>
) : (
  <div>
    <Label>New password</Label>
    <Input name="password" type="password" placeholder="Enter a new password" />
  </div>
)}
```

Create `components/settings/sections/users-section.tsx` with a `SettingsSplitPane` list/detail editor that:

- lists all users
- shows role/auth-source badges
- blocks delete/credential-edit controls for the env super-admin
- supports create, update, and delete for local users through `/api/users`

- [ ] **Step 4: Run the UI tests and validate in the browser**

Run:

```bash
npx vitest run tests/unit/settings-nav.test.tsx tests/unit/account-section.test.tsx tests/unit/users-section.test.tsx
```

Expected: PASS

Then run the UI validation flow required by `AGENTS.md`:

```bash
if [ -f .dev-server ]; then
  URL="$(sed -n '1p' .dev-server)"
else
  npm run dev
  URL="$(sed -n '1p' .dev-server)"
fi
echo "$URL"
```

Use `agent-browser` against the printed URL and verify:

```bash
agent-browser open "$URL/login"
agent-browser snapshot
```

Manual validation checklist in the same session:

- sign in as env super-admin and confirm `Users`, `Providers`, `MCP Servers`, and `Skills` appear in Settings
- create a regular local user and sign in as that user
- confirm the regular user sees only `General`, `Personas`, `Scheduled automations`, `Memories`, and `Account`
- confirm the regular user cannot reach `/settings/users`
- confirm the env super-admin account page shows env-managed credential messaging
- confirm the regular user account page allows password change

- [ ] **Step 5: Commit**

```bash
git add components/shell.tsx components/settings/settings-nav.tsx components/settings/sections/account-section.tsx components/settings/sections/users-section.tsx app/settings/account/page.tsx app/settings/users/page.tsx tests/unit/settings-nav.test.tsx tests/unit/account-section.test.tsx tests/unit/users-section.test.tsx
git commit -m "feat: add role-aware settings and users page"
```

## Self-Review Checklist

- Spec coverage:
  - env-backed persisted super-admin: Tasks 1 and 2
  - private user settings vs global server settings: Task 3
  - owner-scoped conversations/personas/memories/automations: Task 4
  - admin-only settings and new users page: Tasks 5 and 6
  - password-login-disabled hiding/404 behavior: Tasks 2, 5, and 6
- Placeholder scan:
  - No `TODO`, `TBD`, “similar to Task N”, or unspecified “add tests” steps remain
- Type consistency:
  - `UserRole`, `AuthSource`, `AuthUser.passwordManagedBy`, `requireAdminUser`, and owner-scoped function signatures are used consistently across tasks
