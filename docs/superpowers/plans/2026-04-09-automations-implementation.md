# Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scheduled automations with a dedicated Automations workspace, full run conversation history, global timezone support, and strict filtering so automation runs never appear in the main chat sidebar.

**Architecture:** Extend the existing SQLite-backed app with first-class `automations` and `automation_runs` tables plus automation linkage on `conversations`. Reuse the existing chat execution path by creating a fresh conversation for each run, and split the UX into two surfaces: `/settings/automations` for CRUD and `/automations` for operational history and run transcripts. Run scheduling inside the existing Node server process and calculate due times from structured schedule fields in the deployment timezone.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, better-sqlite3, Zod, Vitest, Playwright, custom Node server (`server.cjs`)

---

## File Map

- `lib/db.ts` — schema migrations for `automations`, `automation_runs`, and automation-aware conversation columns
- `lib/types.ts` — shared app types for automations, runs, cadence config, and conversation origin
- `lib/env.ts` — parse timezone env and expose validated runtime timezone
- `lib/conversations.ts` — create automation-linked conversations and keep manual sidebar queries isolated
- `lib/automations.ts` — all persistence helpers for automations and runs
- `lib/automation-scheduler.ts` — next-run calculations, due selection, loop lifecycle, and fire-once claim logic
- `app/api/automations/**` — CRUD, list runs, run-now, retry
- `components/settings/settings-nav.tsx` — add scheduled automations nav item
- `app/settings/automations/page.tsx` — settings entry page
- `components/settings/sections/automations-section.tsx` — automation editor/list UI using `SettingsSplitPane`
- `components/automations/automations-nav.tsx` — dedicated workspace sidebar
- `components/automations/automations-workspace.tsx` — automation list, run history, and run detail shell
- `app/automations/**` — workspace routes and run transcript pages
- `components/shell.tsx` — route-aware switch between chat sidebar, settings nav, and automations nav
- `server.cjs` — start the scheduler after Next and WebSocket initialization
- `tests/unit/automations.test.ts` — persistence + schedule validation coverage
- `tests/unit/automation-scheduler.test.ts` — next-run and missed-run behavior
- `tests/unit/conversations.test.ts` — manual/automation separation coverage
- `tests/unit/automations-section.test.tsx` — settings CRUD form behavior
- `tests/e2e/features.spec.ts` — end-to-end automations flow

### Task 1: Database, Types, And Timezone Foundation

**Files:**
- Modify: `lib/db.ts`
- Modify: `lib/types.ts`
- Modify: `lib/env.ts`
- Modify: `tests/unit/env.test.ts`
- Test: `tests/unit/automations.test.ts`

- [ ] **Step 1: Write the failing foundation tests**

Create `tests/unit/automations.test.ts` with a minimal migration/type smoke test:

```ts
import { getDb } from "@/lib/db";

describe("automations schema", () => {
  it("creates automations tables and automation conversation columns", () => {
    const db = getDb();

    const automationCols = db.prepare("PRAGMA table_info(automations)").all() as Array<{ name: string }>;
    const runCols = db.prepare("PRAGMA table_info(automation_runs)").all() as Array<{ name: string }>;
    const conversationCols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;

    expect(automationCols.map((col) => col.name)).toEqual(
      expect.arrayContaining(["prompt", "schedule_kind", "next_run_at", "enabled"])
    );
    expect(runCols.map((col) => col.name)).toEqual(
      expect.arrayContaining(["automation_id", "conversation_id", "scheduled_for", "status"])
    );
    expect(conversationCols.map((col) => col.name)).toEqual(
      expect.arrayContaining(["automation_id", "automation_run_id", "conversation_origin"])
    );
  });
});
```

Add to `tests/unit/env.test.ts`:

```ts
it("parses the timezone env and exposes it", async () => {
  const { parseEnv } = await import("@/lib/env");

  const env = parseEnv({
    NODE_ENV: "development",
    EIDON_PASSWORD_LOGIN_ENABLED: "true",
    EIDON_ADMIN_USERNAME: "admin",
    EIDON_DATA_DIR: ".test-data",
    TZ: "America/Toronto"
  });

  expect(env.TZ).toBe("America/Toronto");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/env.test.ts tests/unit/automations.test.ts
```

Expected: FAIL with missing `TZ` parsing and missing `automations` / `automation_runs` / automation conversation columns.

- [ ] **Step 3: Add schema, types, and env parsing**

Update `lib/env.ts` to include timezone parsing:

```ts
const nodeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TZ: z.string().min(1).default("UTC"),
  EIDON_PASSWORD_LOGIN_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // ...
});
```

Add to `lib/types.ts`:

```ts
export type AutomationScheduleKind = "interval" | "calendar";
export type AutomationCalendarFrequency = "daily" | "weekly";
export type AutomationRunStatus = "queued" | "running" | "completed" | "failed" | "missed" | "stopped";
export type AutomationTriggerSource = "schedule" | "manual_run" | "manual_retry";
export type ConversationOrigin = "manual" | "automation";

export type Automation = {
  id: string;
  name: string;
  prompt: string;
  providerProfileId: string;
  personaId: string | null;
  scheduleKind: AutomationScheduleKind;
  intervalMinutes: number | null;
  calendarFrequency: AutomationCalendarFrequency | null;
  timeOfDay: string | null;
  daysOfWeek: number[];
  enabled: boolean;
  nextRunAt: string | null;
  lastScheduledFor: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: AutomationRunStatus | "paused" | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRun = {
  id: string;
  automationId: string;
  conversationId: string | null;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: AutomationRunStatus;
  errorMessage: string | null;
  triggerSource: AutomationTriggerSource;
  createdAt: string;
};
```

Add to `lib/db.ts` migration:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    provider_profile_id TEXT NOT NULL,
    persona_id TEXT,
    schedule_kind TEXT NOT NULL,
    interval_minutes INTEGER,
    calendar_frequency TEXT,
    time_of_day TEXT,
    days_of_week TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT,
    last_scheduled_for TEXT,
    last_started_at TEXT,
    last_finished_at TEXT,
    last_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    conversation_id TEXT,
    scheduled_for TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    trigger_source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );
`);

const conversationCols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
if (!conversationCols.some((col) => col.name === "automation_id")) {
  db.exec("ALTER TABLE conversations ADD COLUMN automation_id TEXT REFERENCES automations(id) ON DELETE SET NULL");
}
if (!conversationCols.some((col) => col.name === "automation_run_id")) {
  db.exec("ALTER TABLE conversations ADD COLUMN automation_run_id TEXT REFERENCES automation_runs(id) ON DELETE SET NULL");
}
if (!conversationCols.some((col) => col.name === "conversation_origin")) {
  db.exec("ALTER TABLE conversations ADD COLUMN conversation_origin TEXT NOT NULL DEFAULT 'manual'");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/env.test.ts tests/unit/automations.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/types.ts lib/env.ts tests/unit/env.test.ts tests/unit/automations.test.ts
git commit -m "feat: add automation schema foundation"
```

### Task 2: Persistence Layer For Automations And Runs

**Files:**
- Create: `lib/automations.ts`
- Test: `tests/unit/automations.test.ts`

- [ ] **Step 1: Expand the unit test with real CRUD and validation expectations**

Add to `tests/unit/automations.test.ts`:

```ts
import {
  createAutomation,
  createAutomationRun,
  listAutomationRuns,
  listAutomations,
  updateAutomation
} from "@/lib/automations";

describe("automations storage", () => {
  it("creates interval automations with a minimum of 5 minutes", () => {
    expect(() =>
      createAutomation({
        name: "Too fast",
        prompt: "Ping",
        providerProfileId: "profile_default",
        personaId: null,
        scheduleKind: "interval",
        intervalMinutes: 4,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: []
      })
    ).toThrow("Interval automations must be at least 5 minutes");
  });

  it("creates an automation and a linked run record", () => {
    const automation = createAutomation({
      name: "Morning summary",
      prompt: "Summarize priorities",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 15,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-04-09T13:00:00.000Z",
      triggerSource: "schedule"
    });

    expect(listAutomations()[0]?.name).toBe("Morning summary");
    expect(listAutomationRuns(automation.id)[0]?.id).toBe(run.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/unit/automations.test.ts
```

Expected: FAIL with module-not-found for `@/lib/automations` and missing storage helpers.

- [ ] **Step 3: Implement `lib/automations.ts`**

Create `lib/automations.ts`:

```ts
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { Automation, AutomationRun, AutomationTriggerSource } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function assertValidSchedule(input: {
  scheduleKind: "interval" | "calendar";
  intervalMinutes: number | null;
  calendarFrequency: "daily" | "weekly" | null;
  timeOfDay: string | null;
  daysOfWeek: number[];
}) {
  if (input.scheduleKind === "interval" && (!input.intervalMinutes || input.intervalMinutes < 5)) {
    throw new Error("Interval automations must be at least 5 minutes");
  }
  if (input.scheduleKind === "calendar" && !input.timeOfDay) {
    throw new Error("Calendar automations require a time of day");
  }
  if (input.scheduleKind === "calendar" && input.calendarFrequency === "weekly" && input.daysOfWeek.length === 0) {
    throw new Error("Weekly automations require at least one weekday");
  }
}

export function createAutomation(input: Omit<Automation, "id" | "enabled" | "nextRunAt" | "lastScheduledFor" | "lastStartedAt" | "lastFinishedAt" | "lastStatus" | "createdAt" | "updatedAt">) {
  assertValidSchedule(input);
  const timestamp = nowIso();
  const automation: Automation = {
    id: createId("auto"),
    enabled: true,
    nextRunAt: null,
    lastScheduledFor: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input
  };

  getDb().prepare(`
    INSERT INTO automations (
      id, name, prompt, provider_profile_id, persona_id, schedule_kind, interval_minutes,
      calendar_frequency, time_of_day, days_of_week, enabled, next_run_at, last_scheduled_for,
      last_started_at, last_finished_at, last_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    automation.id,
    automation.name,
    automation.prompt,
    automation.providerProfileId,
    automation.personaId,
    automation.scheduleKind,
    automation.intervalMinutes,
    automation.calendarFrequency,
    automation.timeOfDay,
    JSON.stringify(automation.daysOfWeek),
    1,
    automation.nextRunAt,
    automation.lastScheduledFor,
    automation.lastStartedAt,
    automation.lastFinishedAt,
    automation.lastStatus,
    automation.createdAt,
    automation.updatedAt
  );

  return automation;
}

export function createAutomationRun(input: {
  automationId: string;
  scheduledFor: string;
  triggerSource: AutomationTriggerSource;
}) {
  const run: AutomationRun = {
    id: createId("run"),
    automationId: input.automationId,
    conversationId: null,
    scheduledFor: input.scheduledFor,
    startedAt: null,
    finishedAt: null,
    status: "queued",
    errorMessage: null,
    triggerSource: input.triggerSource,
    createdAt: nowIso()
  };

  getDb().prepare(`
    INSERT INTO automation_runs (
      id, automation_id, conversation_id, scheduled_for, started_at, finished_at, status, error_message, trigger_source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    run.automationId,
    run.conversationId,
    run.scheduledFor,
    run.startedAt,
    run.finishedAt,
    run.status,
    run.errorMessage,
    run.triggerSource,
    run.createdAt
  );

  return run;
}
```

- [ ] **Step 4: Add the remaining query/update helpers**

Extend `lib/automations.ts` with:

```ts
export function listAutomations(): Automation[] {
  const rows = getDb().prepare(`
    SELECT * FROM automations
    ORDER BY updated_at DESC
  `).all() as AutomationRow[];
  return rows.map(rowToAutomation);
}

export function getAutomation(id: string): Automation | null {
  const row = getDb().prepare(`SELECT * FROM automations WHERE id = ?`).get(id) as AutomationRow | undefined;
  return row ? rowToAutomation(row) : null;
}

export function updateAutomation(id: string, patch: Partial<Automation>): Automation | null {
  const current = getAutomation(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: nowIso() };
  assertValidSchedule(next);
  getDb().prepare(`
    UPDATE automations
    SET name = ?, prompt = ?, provider_profile_id = ?, persona_id = ?, schedule_kind = ?,
        interval_minutes = ?, calendar_frequency = ?, time_of_day = ?, days_of_week = ?,
        enabled = ?, next_run_at = ?, last_scheduled_for = ?, last_started_at = ?,
        last_finished_at = ?, last_status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.name,
    next.prompt,
    next.providerProfileId,
    next.personaId,
    next.scheduleKind,
    next.intervalMinutes,
    next.calendarFrequency,
    next.timeOfDay,
    JSON.stringify(next.daysOfWeek),
    next.enabled ? 1 : 0,
    next.nextRunAt,
    next.lastScheduledFor,
    next.lastStartedAt,
    next.lastFinishedAt,
    next.lastStatus,
    next.updatedAt,
    id
  );
  return getAutomation(id);
}

export function listAutomationRuns(automationId: string): AutomationRun[] {
  const rows = getDb().prepare(`
    SELECT * FROM automation_runs
    WHERE automation_id = ?
    ORDER BY created_at DESC
  `).all(automationId) as AutomationRunRow[];
  return rows.map(rowToAutomationRun);
}

export function attachConversationToRun(runId: string, conversationId: string) {
  getDb().prepare(`UPDATE automation_runs SET conversation_id = ? WHERE id = ?`).run(conversationId, runId);
}

export function updateAutomationRunStatus(runId: string, input: {
  status: AutomationRun["status"];
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}) {
  getDb().prepare(`
    UPDATE automation_runs
    SET status = ?, error_message = ?, started_at = COALESCE(?, started_at), finished_at = COALESCE(?, finished_at)
    WHERE id = ?
  `).run(input.status, input.errorMessage ?? null, input.startedAt ?? null, input.finishedAt ?? null, runId);
}

export function listDueAutomations(nowIsoString: string): Automation[] {
  const rows = getDb().prepare(`
    SELECT * FROM automations
    WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
    ORDER BY next_run_at ASC
  `).all(nowIsoString) as AutomationRow[];
  return rows.map(rowToAutomation);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/unit/automations.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/automations.ts tests/unit/automations.test.ts
git commit -m "feat: add automations persistence layer"
```

### Task 3: Conversation Separation And Automation-Origin Records

**Files:**
- Modify: `lib/conversations.ts`
- Modify: `tests/unit/conversations.test.ts`

- [ ] **Step 1: Add a failing test for manual sidebar filtering**

Add to `tests/unit/conversations.test.ts`:

```ts
import { listConversationsPage } from "@/lib/conversations";

it("excludes automation conversations from the manual chat page", () => {
  createConversation("Manual thread");
  createConversation("Automation thread", null, {
    providerProfileId: "profile_default",
    origin: "automation",
    automationId: "auto_123",
    automationRunId: "run_123"
  });

  expect(listConversationsPage().conversations.map((conversation) => conversation.title)).toEqual([
    "Manual thread"
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts
```

Expected: FAIL because `createConversation` does not accept automation linkage and `listConversationsPage` returns both records.

- [ ] **Step 3: Extend `createConversation` for automation linkage**

Modify `lib/conversations.ts`:

```ts
export function createConversation(
  title?: string | null,
  folderId?: string | null,
  options?: {
    providerProfileId?: string | null;
    origin?: "manual" | "automation";
    automationId?: string | null;
    automationRunId?: string | null;
  }
) {
  const conversation = {
    id: createId("conv"),
    title: trimmedTitle || DEFAULT_CONVERSATION_TITLE,
    titleGenerationStatus: (trimmedTitle ? "completed" : "pending") as ConversationTitleGenerationStatus,
    folderId: folderId ?? null,
    providerProfileId: options?.providerProfileId ?? settings.defaultProviderProfileId,
    conversationOrigin: options?.origin ?? "manual",
    automationId: options?.automationId ?? null,
    automationRunId: options?.automationRunId ?? null,
    sortOrder: maxOrder.max_order + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    isActive: false
  };

  getDb().prepare(`
    INSERT INTO conversations (
      id, title, title_generation_status, folder_id, provider_profile_id, automation_id,
      automation_run_id, conversation_origin, sort_order, created_at, updated_at, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conversation.id,
    conversation.title,
    conversation.titleGenerationStatus,
    conversation.folderId,
    conversation.providerProfileId,
    conversation.automationId,
    conversation.automationRunId,
    conversation.conversationOrigin,
    conversation.sortOrder,
    conversation.createdAt,
    conversation.updatedAt,
    0
  );
}
```

- [ ] **Step 4: Filter manual conversation queries**

Update `listConversationsPage` and `listConversations` queries:

```ts
FROM conversations c
WHERE c.conversation_origin = 'manual'
ORDER BY ${activityTimestamp} DESC, c.id DESC
```

And update `ConversationRow`/`rowToConversation` to include:

```ts
conversationOrigin: row.conversation_origin as ConversationOrigin,
automationId: row.automation_id,
automationRunId: row.automation_run_id,
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/conversations.ts tests/unit/conversations.test.ts
git commit -m "feat: separate automation and manual conversations"
```

### Task 4: Automations API Surface

**Files:**
- Create: `app/api/automations/route.ts`
- Create: `app/api/automations/[automationId]/route.ts`
- Create: `app/api/automations/[automationId]/runs/route.ts`
- Create: `app/api/automations/[automationId]/run-now/route.ts`
- Create: `app/api/automation-runs/[runId]/retry/route.ts`
- Test: `tests/unit/automations.test.ts`

- [ ] **Step 1: Add failing API-oriented expectations to the storage test**

Add to `tests/unit/automations.test.ts`:

```ts
import { getAutomation, listAutomationRuns, updateAutomation } from "@/lib/automations";

it("updates an automation and preserves structured cadence fields", () => {
  const automation = createAutomation({
    name: "Weekly digest",
    prompt: "Digest",
    providerProfileId: "profile_default",
    personaId: null,
    scheduleKind: "calendar",
    intervalMinutes: null,
    calendarFrequency: "weekly",
    timeOfDay: "09:30",
    daysOfWeek: [1, 3, 5]
  });

  const updated = updateAutomation(automation.id, { enabled: false, timeOfDay: "10:00" });

  expect(updated?.enabled).toBe(false);
  expect(getAutomation(automation.id)?.timeOfDay).toBe("10:00");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/automations.test.ts
```

Expected: FAIL if `updateAutomation` or structured field serialization is incomplete.

- [ ] **Step 3: Implement CRUD routes**

Create `app/api/automations/route.ts`:

```ts
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { createAutomation, listAutomations } from "@/lib/automations";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1),
  providerProfileId: z.string().min(1),
  personaId: z.string().nullable().default(null),
  scheduleKind: z.enum(["interval", "calendar"]),
  intervalMinutes: z.number().int().nullable(),
  calendarFrequency: z.enum(["daily", "weekly"]).nullable(),
  timeOfDay: z.string().nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([])
});

export async function GET() {
  await requireUser();
  return ok({ automations: listAutomations() });
}

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid automation data");
  return ok({ automation: createAutomation(body.data) }, { status: 201 });
}
```

Create `app/api/automations/[automationId]/route.ts`:

```ts
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { deleteAutomation, getAutomation, updateAutomation } from "@/lib/automations";

const paramsSchema = z.object({ automationId: z.string().min(1) });

export async function GET(_request: Request, context: { params: Promise<{ automationId: string }> }) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid automation id");
  const automation = getAutomation(params.data.automationId);
  if (!automation) return badRequest("Automation not found", 404);
  return ok({ automation });
}
```

- [ ] **Step 4: Implement run listing and trigger routes**

Create run-focused routes:

```ts
// app/api/automations/[automationId]/runs/route.ts
export async function GET(_request: Request, context: { params: Promise<{ automationId: string }> }) {
  await requireUser();
  const { automationId } = paramsSchema.parse(await context.params);
  return ok({ runs: listAutomationRuns(automationId) });
}

// app/api/automations/[automationId]/run-now/route.ts
export async function POST(_request: Request, context: { params: Promise<{ automationId: string }> }) {
  await requireUser();
  const { automationId } = paramsSchema.parse(await context.params);
  const run = await triggerAutomationNow(automationId, "manual_run");
  return ok({ run }, { status: 201 });
}

// app/api/automation-runs/[runId]/retry/route.ts
export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  await requireUser();
  const { runId } = runParamsSchema.parse(await context.params);
  const run = await retryAutomationRun(runId);
  return ok({ run }, { status: 201 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/unit/automations.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/automations app/api/automation-runs lib/automations.ts tests/unit/automations.test.ts
git commit -m "feat: add automations api routes"
```

### Task 5: Settings CRUD UI For Scheduled Automations

**Files:**
- Modify: `components/settings/settings-nav.tsx`
- Create: `app/settings/automations/page.tsx`
- Create: `components/settings/sections/automations-section.tsx`
- Test: `tests/unit/automations-section.test.tsx`

- [ ] **Step 1: Write the failing settings UI test**

Create `tests/unit/automations-section.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AutomationsSection } from "@/components/settings/sections/automations-section";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() })
}));

describe("automations section", () => {
  beforeEach(() => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ automations: [] })
      } as Response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ automation: { id: "auto_1" } })
      } as Response);
  });

  it("blocks saving intervals below five minutes", async () => {
    render(React.createElement(AutomationsSection));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add automation" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add automation" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Morning summary" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Summarize priorities" } });
    fireEvent.change(screen.getByLabelText("Every"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save automation" }));

    expect(screen.getByText("Interval must be at least 5 minutes")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/unit/automations-section.test.tsx
```

Expected: FAIL with missing component/module.

- [ ] **Step 3: Add the settings page and nav entry**

Update `components/settings/settings-nav.tsx`:

```ts
import { Clock3 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/settings/general", label: "General", icon: Settings },
  { href: "/settings/providers", label: "Providers", icon: Sparkles },
  { href: "/settings/personas", label: "Personas", icon: Users },
  { href: "/settings/automations", label: "Scheduled automations", icon: Clock3 },
  { href: "/settings/memories", label: "Memories", icon: Brain },
  // ...
] as const;
```

Create `app/settings/automations/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth";
import { AutomationsSection } from "@/components/settings/sections/automations-section";

export default async function AutomationsPage() {
  await requireUser();
  return <AutomationsSection />;
}
```

- [ ] **Step 4: Implement `AutomationsSection` with split-pane CRUD**

Create `components/settings/sections/automations-section.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { SettingsSplitPane } from "@/components/settings/settings-split-pane";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function AutomationsSection() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    prompt: "",
    scheduleKind: "interval" as const,
    intervalMinutes: 5,
    calendarFrequency: "daily" as const,
    timeOfDay: "09:00",
    daysOfWeek: [] as number[]
  });
  const [error, setError] = useState("");

  async function saveAutomation() {
    if (form.scheduleKind === "interval" && form.intervalMinutes < 5) {
      setError("Interval must be at least 5 minutes");
      return;
    }
    // POST/PATCH and refresh local list
  }

  return (
    <div className="min-h-0 p-4 md:p-8">
      <SettingsSplitPane
        listHeader={<h2 className="text-[0.9rem] font-semibold text-[#f4f4f5]">Scheduled automations</h2>}
        listPanel={<Button onClick={() => setSelectedId("new")}>Add automation</Button>}
        isDetailVisible={Boolean(selectedId)}
        onBackAction={() => setSelectedId(null)}
        detailPanel={
          <div className="space-y-4">
            <Input aria-label="Name" value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
            <Textarea aria-label="Prompt" value={form.prompt} onChange={(e) => setForm((current) => ({ ...current, prompt: e.target.value }))} />
            <Input aria-label="Every" type="number" min={5} value={form.intervalMinutes} onChange={(e) => setForm((current) => ({ ...current, intervalMinutes: Number(e.target.value) }))} />
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <Button onClick={() => void saveAutomation()}>Save automation</Button>
          </div>
        }
      />
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/unit/automations-section.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/settings/settings-nav.tsx app/settings/automations/page.tsx components/settings/sections/automations-section.tsx tests/unit/automations-section.test.tsx
git commit -m "feat: add scheduled automations settings ui"
```

### Task 6: Dedicated Automations Workspace And Full Run Conversation View

**Files:**
- Modify: `components/shell.tsx`
- Create: `components/automations/automations-nav.tsx`
- Create: `components/automations/automations-workspace.tsx`
- Create: `app/automations/page.tsx`
- Create: `app/automations/[automationId]/page.tsx`
- Create: `app/automations/[automationId]/runs/[runId]/page.tsx`
- Modify: `app/chat/[conversationId]/page.tsx`
- Test: `tests/e2e/features.spec.ts`

- [ ] **Step 1: Add a failing E2E spec for navigation separation**

Add to `tests/e2e/features.spec.ts`:

```ts
test.describe("Feature: Automations workspace", () => {
  test("opens a previous automation run as a full conversation without polluting the main sidebar", async ({ page }) => {
    await signIn(page);

    await page.goto("/settings/automations");
    await expect(page.getByRole("heading", { name: "Scheduled automations" })).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Add automation" }).click();
    await page.getByLabel("Name").fill("Morning summary");
    await page.getByLabel("Prompt").fill("Summarize priorities");
    await page.getByRole("button", { name: "Save automation" }).click();

    await page.goto("/automations");
    await expect(page.getByText("Morning summary")).toBeVisible({ timeout: 5000 });
    await expect(page.locator('aside a[href*="/chat/"]')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the E2E spec to verify it fails**

Run:

```bash
npx playwright test tests/e2e/features.spec.ts -g "Feature: Automations workspace"
```

Expected: FAIL because `/settings/automations` and `/automations` do not exist yet.

- [ ] **Step 3: Add the workspace nav and shell switch**

Create `components/automations/automations-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Clock3, PlayCircle } from "lucide-react";
import type { Automation } from "@/lib/types";

export function AutomationsNav({ automations }: { automations: Automation[] }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col bg-transparent text-gray-300">
      <div className="px-4 py-6">
        <div className="mb-6 flex items-center gap-3 px-2">
          <Clock3 className="h-5 w-5 text-[var(--accent)]" />
          <span className="text-[20px] font-bold tracking-tight text-white/90">Automations</span>
        </div>
        <div className="space-y-1">
          {automations.map((automation) => (
            <Link
              key={automation.id}
              href={`/automations/${automation.id}`}
              className={pathname.startsWith(`/automations/${automation.id}`) ? "flex items-center gap-3 rounded-2xl px-4 py-3 bg-white/[0.05] text-white font-semibold" : "flex items-center gap-3 rounded-2xl px-4 py-3 text-white/30 hover:bg-white/[0.03] hover:text-white/60"}
            >
              <Bot className="h-4.5 w-4.5" />
              <span className="truncate text-sm">{automation.name}</span>
              {automation.lastStatus === "running" ? <PlayCircle className="ml-auto h-4 w-4 text-emerald-400" /> : null}
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}
```

Update `components/shell.tsx`:

```tsx
import { AutomationsNav } from "@/components/automations/automations-nav";
import type { Automation } from "@/lib/types";

export function Shell({
  conversationPage,
  folders,
  automations,
  children
}: PropsWithChildren<{ conversationPage: ConversationListPage; folders?: Folder[]; automations?: Automation[] }>) {
  const isSettingsPage = pathname.startsWith("/settings");
  const isAutomationsPage = pathname.startsWith("/automations");

  // ...
  {isSettingsPage ? (
    <SettingsNav onCloseAction={() => setIsSidebarOpen(false)} />
  ) : isAutomationsPage ? (
    <AutomationsNav automations={automations ?? []} />
  ) : (
    <Sidebar conversationPage={conversationPage} folders={folders} onClose={() => setIsSidebarOpen(false)} />
  )}
}
```

- [ ] **Step 4: Build the workspace routes and reuse the full chat transcript view**

Create `app/automations/[automationId]/runs/[runId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { ChatView } from "@/components/chat-view";
import { requireUser } from "@/lib/auth";
import { getConversation, listVisibleMessages, listConversationsPage } from "@/lib/conversations";
import { listAutomations, getAutomationRun } from "@/lib/automations";
import { listFolders } from "@/lib/folders";
import { getSanitizedSettings } from "@/lib/settings";

export default async function AutomationRunPage({ params }: { params: Promise<{ automationId: string; runId: string }> }) {
  await requireUser();
  const { automationId, runId } = await params;
  const run = getAutomationRun(runId);
  if (!run?.conversationId || run.automationId !== automationId) notFound();

  const conversation = getConversation(run.conversationId);
  if (!conversation) notFound();

  const settings = getSanitizedSettings();

  return (
    <Shell conversationPage={listConversationsPage()} folders={listFolders()} automations={listAutomations()}>
      <ChatView
        payload={{
          conversation,
          messages: listVisibleMessages(conversation.id),
          providerProfiles: settings.providerProfiles,
          defaultProviderProfileId: settings.defaultProviderProfileId,
          debug: { rawTurnCount: 0, memoryNodeCount: 0, latestCompactionAt: null }
        }}
      />
    </Shell>
  );
}
```

Create `app/automations/page.tsx` and `app/automations/[automationId]/page.tsx` to render `AutomationsWorkspace` with automation list + run history.

- [ ] **Step 5: Run the E2E spec to verify it passes**

Run:

```bash
npx playwright test tests/e2e/features.spec.ts -g "Feature: Automations workspace"
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/shell.tsx components/automations app/automations tests/e2e/features.spec.ts
git commit -m "feat: add automations workspace"
```

### Task 7: Scheduler Loop, Trigger Execution, And Server Startup

**Files:**
- Create: `lib/automation-scheduler.ts`
- Modify: `lib/automations.ts`
- Modify: `lib/chat-turn.ts`
- Modify: `server.cjs`
- Test: `tests/unit/automation-scheduler.test.ts`

- [ ] **Step 1: Write the failing scheduler tests**

Create `tests/unit/automation-scheduler.test.ts`:

```ts
import { createAutomation } from "@/lib/automations";
import { computeNextRunAt, markMissedRuns, triggerAutomationNow } from "@/lib/automation-scheduler";

describe("automation scheduler", () => {
  it("computes the next run for interval automations in 5 minute increments", () => {
    expect(
      computeNextRunAt(
        {
          scheduleKind: "interval",
          intervalMinutes: 15,
          calendarFrequency: null,
          timeOfDay: null,
          daysOfWeek: []
        },
        "2026-04-09T13:02:00.000Z",
        "America/Toronto"
      )
    ).toBe("2026-04-09T13:15:00.000Z");
  });

  it("does not replay bursts of missed runs after downtime", () => {
    const automation = createAutomation({
      name: "Daily summary",
      prompt: "Summarize priorities",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "calendar",
      intervalMinutes: null,
      calendarFrequency: "daily",
      timeOfDay: "09:00",
      daysOfWeek: []
    });

    const outcome = markMissedRuns("2026-04-09T15:00:00.000Z");
    expect(outcome.missedAutomationIds).toContain(automation.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/unit/automation-scheduler.test.ts
```

Expected: FAIL with module-not-found for `@/lib/automation-scheduler`.

- [ ] **Step 3: Implement scheduling calculations and run triggering**

Create `lib/automation-scheduler.ts`:

```ts
import { env } from "@/lib/env";
import { attachConversationToRun, createAutomationRun, getAutomation, listDueAutomations, updateAutomation, updateAutomationRunStatus } from "@/lib/automations";
import { createConversation } from "@/lib/conversations";

export function computeNextRunAt(
  schedule: {
    scheduleKind: "interval" | "calendar";
    intervalMinutes: number | null;
    calendarFrequency: "daily" | "weekly" | null;
    timeOfDay: string | null;
    daysOfWeek: number[];
  },
  nowIsoString: string,
  timezone: string = env.TZ
) {
  const now = new Date(nowIsoString);

  if (schedule.scheduleKind === "interval" && schedule.intervalMinutes) {
    return new Date(now.getTime() + schedule.intervalMinutes * 60_000).toISOString();
  }

  if (!schedule.timeOfDay) {
    throw new Error("Calendar automations require a time of day");
  }

  const [hour, minute] = schedule.timeOfDay.split(":").map(Number);
  const next = new Date(now);
  next.setUTCHours(hour, minute, 0, 0);

  if (schedule.calendarFrequency === "daily" && next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  if (schedule.calendarFrequency === "weekly") {
    const allowedDays = schedule.daysOfWeek.length ? schedule.daysOfWeek : [next.getUTCDay()];
    while (!allowedDays.includes(next.getUTCDay()) || next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(hour, minute, 0, 0);
    }
  }

  return next.toISOString();
}

export async function triggerAutomationNow(automationId: string, triggerSource: "manual_run" | "manual_retry" = "manual_run") {
  const automation = getAutomation(automationId);
  if (!automation) {
    throw new Error("Automation not found");
  }
  const run = createAutomationRun({
    automationId: automation.id,
    scheduledFor: new Date().toISOString(),
    triggerSource
  });

  const conversation = createConversation(automation.name, null, {
    providerProfileId: automation.providerProfileId,
    origin: "automation",
    automationId: automation.id,
    automationRunId: run.id
  });

  attachConversationToRun(run.id, conversation.id);
  updateAutomationRunStatus(run.id, { status: "running", startedAt: new Date().toISOString() });

  // delegate to shared chat execution
  return { runId: run.id, conversationId: conversation.id };
}
```

- [ ] **Step 4: Start and stop the scheduler from `server.cjs`**

Update `server.cjs`:

```js
const { createAutomationScheduler } = require("./ws-handler-compiled.cjs");

let automationScheduler;

app.prepare().then(async () => {
  // existing server setup...

  const { initializeMcpServers, createAutomationScheduler } = require("./ws-handler-compiled.cjs");

  automationScheduler = createAutomationScheduler();
  automationScheduler.start().catch((err) => {
    console.error("[automations] Scheduler failed:", err.message);
  });

  process.on("SIGINT", async () => {
    await automationScheduler?.stop?.();
    cleanupDevServerFile();
    await require("./ws-handler-compiled.cjs").shutdownAllProcesses?.();
    process.exit(0);
  });
});
```

In `lib/chat-turn.ts`, add a shared programmatic entry such as:

```ts
export async function startScheduledAutomationTurn(input: {
  conversationId: string;
  prompt: string;
  providerProfileId: string;
  personaId: string | null;
}) {
  // wrap the existing assistant turn path instead of duplicating it
}
```

- [ ] **Step 5: Run the scheduler tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/automation-scheduler.test.ts tests/unit/automations.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/automation-scheduler.ts lib/automations.ts lib/chat-turn.ts server.cjs tests/unit/automation-scheduler.test.ts
git commit -m "feat: add automation scheduler runtime"
```

### Task 8: Full Verification, Browser Validation, And Coverage Gate

**Files:**
- Modify: `tests/e2e/features.spec.ts`
- Modify: `tests/unit/automations-section.test.tsx`
- Modify: `tests/unit/automation-scheduler.test.ts`
- Modify: `tests/unit/conversations.test.ts`

- [ ] **Step 1: Add the remaining end-to-end assertions**

Extend `tests/e2e/features.spec.ts` so the automations flow verifies:

```ts
await page.goto("/automations");
await expect(page.getByText("Morning summary")).toBeVisible();
await page.getByRole("button", { name: "Run now" }).click();
await expect(page.getByText("Running")).toBeVisible();
await page.getByRole("link", { name: /Apr/ }).click();
await expect(page.locator('[data-testid="chat-view-root"]')).toBeVisible();
await expect(page.locator('aside a[href*="/chat/"]')).toHaveCount(0);
```

- [ ] **Step 2: Run lint, typecheck, unit tests, and coverage**

Run:

```bash
npm run lint
npm run typecheck
npm run test
```

Expected:

- `lint`: exit code 0
- `typecheck`: exit code 0
- `test`: PASS with coverage summary meeting the repo’s global threshold

- [ ] **Step 3: Start the dev server and run Playwright**

If `.dev-server` exists and is healthy, reuse it. Otherwise:

```bash
npm run dev
```

Then run:

```bash
npm run test:e2e
```

Expected: PASS including the new Automations workspace flow.

- [ ] **Step 4: Validate the UI in the browser**

Use the required browser validation flow:

1. Open the settings page for scheduled automations
2. Create an interval automation and confirm the 5 minute minimum guard
3. Open `/automations`
4. Trigger a run and open a previous run
5. Confirm the full conversation transcript is visible and the main chat sidebar stays clean
6. Capture a screenshot of the Automations workspace and a screenshot of the run transcript view

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/features.spec.ts tests/unit/automations-section.test.tsx tests/unit/automation-scheduler.test.ts tests/unit/conversations.test.ts
git commit -m "test: verify automations workflow end to end"
```
