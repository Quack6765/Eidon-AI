# Rename Hermes → Eidon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename all "hermes" references to "eidon" across the entire codebase — user-visible text, env vars, internal naming, database filename, session cookie, package name, images, and documentation.

**Architecture:** Mechanical find-and-replace with no behavioral changes. The central constant `APP_NAME` in `lib/constants.ts` is not used for the hardcoded UI strings (login, sidebar, shell), so those must be changed independently. Internal event prefixes and the MCP client name also need renaming.

**Tech Stack:** TypeScript, Next.js, better-sqlite3, Zod, Playwright

---

### Task 1: Central Constants and Core Config

**Files:**
- Modify: `lib/constants.ts`
- Modify: `lib/env.ts`

- [ ] **Step 1: Update `lib/constants.ts`**

Replace `APP_NAME` and `SESSION_COOKIE_NAME`:
```typescript
export const APP_NAME = "Eidon";
export const SESSION_COOKIE_NAME = "eidon_session";
```

- [ ] **Step 2: Update `lib/env.ts` — rename all HERMES_* keys to EIDON_***

Replace every `HERMES_` prefix with `EIDON_` throughout the file. This includes:
- The Zod schema keys: `HERMES_PASSWORD_LOGIN_ENABLED` → `EIDON_PASSWORD_LOGIN_ENABLED`, etc.
- The `sensitiveEnvNames` array entries
- The `nonProductionDefaults` record keys
- The `productionRejectedValues` record keys
- The `parseEnv` function's resolved values
- The `getEnvValue` switch cases
- The `HermesEnv` type alias → `EidonEnv`
- The `isPasswordLoginEnabled` call: `"HERMES_PASSWORD_LOGIN_ENABLED"` → `"EIDON_PASSWORD_LOGIN_ENABLED"`

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts lib/env.ts
git commit -m "refactor: rename APP_NAME and env vars from HERMES_* to EIDON_*"
```

---

### Task 2: Downstream Env Var Consumers

**Files:**
- Modify: `lib/auth.ts:11,17,76-77`
- Modify: `lib/db.ts:93,95`
- Modify: `lib/crypto.ts:6`
- Modify: `lib/attachments.ts:75`
- Modify: `lib/chat-bootstrap.ts:10`
- Modify: `middleware.ts:11`
- Modify: `lib/conversation-events.ts:1-3`
- Modify: `lib/mcp-client.ts:69`

- [ ] **Step 1: Update `lib/auth.ts`**

Line 17: `env.HERMES_SESSION_SECRET` → `env.EIDON_SESSION_SECRET`
Lines 76-77: `env.HERMES_ADMIN_USERNAME` → `env.EIDON_ADMIN_USERNAME`, `env.HERMES_ADMIN_PASSWORD` → `env.EIDON_ADMIN_PASSWORD`

- [ ] **Step 2: Update `lib/db.ts`**

Line 93: `env.HERMES_DATA_DIR` → `env.EIDON_DATA_DIR`
Line 95: `"hermes.db"` → `"eidon.db"`

- [ ] **Step 3: Update `lib/crypto.ts`**

Line 6: `env.HERMES_ENCRYPTION_SECRET` → `env.EIDON_ENCRYPTION_SECRET`

- [ ] **Step 4: Update `lib/attachments.ts`**

Line 75: `env.HERMES_DATA_DIR` → `env.EIDON_DATA_DIR`

- [ ] **Step 5: Update `lib/chat-bootstrap.ts`**

Line 10: `"hermes:chat-bootstrap:${conversationId}"` → `"eidon:chat-bootstrap:${conversationId}"`

- [ ] **Step 6: Update `middleware.ts`**

Line 11: `env.HERMES_SESSION_SECRET` → `env.EIDON_SESSION_SECRET`

- [ ] **Step 7: Update `lib/conversation-events.ts`**

Lines 1-3: Change all `"hermes:..."` prefixes to `"eidon:..."`:
```typescript
export const CONVERSATION_TITLE_UPDATED_EVENT = "eidon:conversation-title-updated";
export const CONVERSATION_REMOVED_EVENT = "eidon:conversation-removed";
export const CONVERSATION_ACTIVITY_UPDATED_EVENT = "eidon:conversation-activity-updated";
```

- [ ] **Step 8: Update `lib/mcp-client.ts`**

Line 69: `name: "hermes"` → `name: "eidon"`

- [ ] **Step 9: Run unit tests to verify nothing is broken**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add lib/auth.ts lib/db.ts lib/crypto.ts lib/attachments.ts lib/chat-bootstrap.ts middleware.ts lib/conversation-events.ts lib/mcp-client.ts
git commit -m "refactor: update all env var references from HERMES_* to EIDON_*"
```

---

### Task 3: UI Text and Initials

**Files:**
- Modify: `components/login-form.tsx:47,53`
- Modify: `components/shell.tsx:65`
- Modify: `components/sidebar.tsx:1041,1043`

- [ ] **Step 1: Update `components/login-form.tsx`**

Line 47: Change the logo initial `H` → `E`:
```tsx
            E
```

Line 53: Change `Hermes` → `Eidon`:
```tsx
            Eidon
```

- [ ] **Step 2: Update `components/shell.tsx`**

Line 65: Change `Hermes` → `Eidon`:
```tsx
          <div className="font-semibold text-[var(--text)] text-sm tracking-wide">Eidon</div>
```

- [ ] **Step 3: Update `components/sidebar.tsx`**

Line 1041: Change the logo initial `H` → `E`:
```tsx
              E
```

Line 1043: Change `Hermes` → `Eidon`:
```tsx
            <span className="font-semibold text-white/90 text-sm tracking-wide">Eidon</span>
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add components/login-form.tsx components/shell.tsx components/sidebar.tsx
git commit -m "refactor: rename UI text from Hermes to Eidon"
```

---

### Task 4: Images

**Files:**
- Overwrite: `public/logo.png`
- Overwrite: `public/chat-icon.png`

- [ ] **Step 1: Copy new logo image**

```bash
cp /Users/charles/Downloads/eidon-full.png public/logo.png
```

- [ ] **Step 2: Copy new chat icon image**

```bash
cp /Users/charles/Downloads/eidon-profile-pic.png public/chat-icon.png
```

- [ ] **Step 3: Commit**

```bash
git add public/logo.png public/chat-icon.png
git commit -m "feat: replace logo and chat-icon with Eidon branding"
```

---

### Task 5: Package Name and .env

**Files:**
- Modify: `package.json:2`
- Modify: `.env`
- Modify: `package-lock.json:2` (auto-updated by npm)

- [ ] **Step 1: Update `package.json`**

Line 2: `"name": "hermes"` → `"name": "eidon"`

- [ ] **Step 2: Update `.env`**

Replace all `HERMES_` prefixes with `EIDON_`:
```
EIDON_PASSWORD_LOGIN_ENABLED=false
EIDON_ADMIN_USERNAME=admin
EIDON_ADMIN_PASSWORD=changeme123
EIDON_SESSION_SECRET=ZISMNywwJxqvuun4XcQWqBSeSL3MoT9WDFn7/WDm+k0=
EIDON_ENCRYPTION_SECRET=ZISMNywwJxqvuun4XcQWqBSeSL3MoT9WDFn7/WDm+ks=
```

- [ ] **Step 3: Run npm install to update lockfile**

Run: `npm install --package-lock-only`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env
git commit -m "refactor: rename package from hermes to eidon, update .env"
```

---

### Task 6: Dockerfile and Playwright Config

**Files:**
- Modify: `Dockerfile:22-23,36,43-44`
- Modify: `playwright.config.ts:15-20`

- [ ] **Step 1: Update `Dockerfile`**

Line 22: `ENV HERMES_DATA_DIR=/app/data` → `ENV EIDON_DATA_DIR=/app/data`
Line 23: `ENV HERMES_PASSWORD_LOGIN_ENABLED=true` → `ENV EIDON_PASSWORD_LOGIN_ENABLED=true`
Line 36: `RUN groupadd --system hermes && useradd --system --gid hermes hermes` → `RUN groupadd --system eidon && useradd --system --gid eidon eidon`
Line 43: `&& chown -R hermes:hermes /app` → `&& chown -R eidon:eidon /app`
Line 44: `USER hermes` → `USER eidon`

- [ ] **Step 2: Update `playwright.config.ts`**

Lines 15-20: Rename all `HERMES_` to `EIDON_`:
```typescript
      EIDON_DATA_DIR: ".e2e-data",
      EIDON_PASSWORD_LOGIN_ENABLED: "true",
      EIDON_ADMIN_USERNAME: "admin",
      EIDON_ADMIN_PASSWORD: "changeme123",
      EIDON_SESSION_SECRET: "e2e-session-secret-which-is-long-enough",
      EIDON_ENCRYPTION_SECRET: "e2e-encryption-secret-which-is-long-enough"
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile playwright.config.ts
git commit -m "refactor: rename Docker and Playwright env vars from HERMES_* to EIDON_*"
```

---

### Task 7: Test Files

**Files:**
- Modify: `tests/setup.ts:11-16`
- Modify: `tests/unit/db.test.ts:7`

- [ ] **Step 1: Update `tests/setup.ts`**

Lines 11-16: Rename all `HERMES_` to `EIDON_`:
```typescript
  EIDON_DATA_DIR: dataDir,
  EIDON_PASSWORD_LOGIN_ENABLED: "true",
  EIDON_ADMIN_USERNAME: "admin",
  EIDON_ADMIN_PASSWORD: "changeme123",
  EIDON_SESSION_SECRET: "test-session-secret-which-is-long-enough",
  EIDON_ENCRYPTION_SECRET: "test-encryption-secret-which-is-long-enough"
```

- [ ] **Step 2: Update `tests/unit/db.test.ts`**

Line 7: `const dbPath = path.join(dataDir, "hermes.db")` → `const dbPath = path.join(dataDir, "eidon.db")`

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/setup.ts tests/unit/db.test.ts
git commit -m "refactor: rename test env vars and db path from hermes to eidon"
```

---

### Task 8: README and Documentation

**Files:**
- Modify: `README.md` — all "Hermes" → "Eidon", all `HERMES_*` → `EIDON_*`
- Modify: `agent-memory/security/auth.md`
- Modify: `agent-memory/product/about.md`
- Modify: `agent-memory/integrations/external.md`
- Modify: `agent-memory/infrastructure/local.md`
- Modify: `agent-memory/infrastructure/config.md`
- Modify: `agent-memory/data/models.md`
- Modify: `docs/superpowers/specs/2026-04-07-persistent-memory-design.md`
- Modify: `docs/superpowers/specs/2026-04-06-context-compaction-improvements-design.md`
- Modify: `docs/superpowers/specs/2026-04-06-compaction-indicator-design.md`
- Modify: `docs/superpowers/plans/2026-04-05-mcp-tool-call-accuracy.md`

- [ ] **Step 1: Update `README.md`**

Replace all occurrences of:
- `Hermes` → `Eidon` (case-sensitive, whole word)
- `HERMES_` → `EIDON_` (env var prefix)
- `hermes` → `eidon` (lowercase: docker build tag, container name, volume name, db references)

- [ ] **Step 2: Update all `agent-memory/**/*.md` files**

Replace all occurrences of `Hermes` → `Eidon` and `HERMES_` → `EIDON_` in:
- `agent-memory/security/auth.md`
- `agent-memory/product/about.md`
- `agent-memory/integrations/external.md`
- `agent-memory/infrastructure/local.md`
- `agent-memory/infrastructure/config.md`
- `agent-memory/data/models.md`

- [ ] **Step 3: Update all `docs/superpowers/**/*.md` files**

Replace all occurrences of `Hermes` → `Eidon` and `HERMES_` → `EIDON_` in:
- `docs/superpowers/specs/2026-04-07-persistent-memory-design.md`
- `docs/superpowers/specs/2026-04-06-context-compaction-improvements-design.md`
- `docs/superpowers/specs/2026-04-06-compaction-indicator-design.md`
- `docs/superpowers/plans/2026-04-05-mcp-tool-call-accuracy.md`

- [ ] **Step 4: Commit**

```bash
git add README.md agent-memory/ docs/superpowers/
git commit -m "docs: rename all Hermes references to Eidon"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Grep for any remaining hermes references (excluding .git, node_modules, package-lock.json)**

Run: `grep -ri "hermes" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.md" --include="*.env" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=.data .`

Expected: No matches (or only in package-lock.json which npm manages)

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Verify dev server starts**

Run: `npm run dev` and confirm no errors

- [ ] **Step 4: Final commit if any straggler fixes were needed**

```bash
git add -A
git commit -m "chore: final cleanup for hermes → eidon rename"
```
