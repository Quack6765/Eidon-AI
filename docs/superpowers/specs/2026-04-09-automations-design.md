# Automations Design

## Summary

Add user-friendly scheduled automations that execute a saved prompt on a recurring cadence and create a fresh conversation for each run. The feature avoids the term "cronjob" in the product UI. Users manage schedule definitions in Settings and monitor execution in a dedicated Automations workspace with its own sidebar and run history, separate from the main chat sidebar.

The first version supports both interval-based schedules and calendar-based schedules. Interval schedules cannot be configured below 5 minutes. The scheduler uses a single global deployment timezone sourced from Docker/environment configuration so runtime behavior and UI display stay aligned.

## Product Model

### Terminology

- **Automation** — the reusable scheduled definition the user creates and manages
- **Run** — one execution of an automation at a scheduled or manual trigger time
- **Run conversation** — the full chat transcript produced by a single run

The UI should use:

- Workspace label: `Automations`
- Settings page label: `Scheduled automations`
- Per-item label: `Automation`

Do not expose raw cron syntax or the word `cronjob` in the user-facing interface.

### User Experience Goals

- Users can create, edit, enable, pause, and delete automations from Settings
- Each run creates a brand-new conversation rather than appending to a shared thread
- Previous runs can be opened and viewed as full conversations using the same conversation-style UI as manual chats
- Automation run conversations never appear in the main chat sidebar
- Active and historical runs are visible in a dedicated Automations workspace

## Scheduling Model

### Supported cadence types

#### Interval schedules

Structured interval fields:

- `interval_minutes`

Rules:

- minimum value is 5 minutes
- UI only offers values at or above 5 minutes
- API validation rejects anything below 5 minutes even if the client is bypassed

#### Calendar schedules

Structured calendar fields:

- `calendar_frequency` — `daily` or `weekly`
- `time_of_day` — local time in `HH:MM`
- `days_of_week` — JSON-encoded weekday array for weekly schedules

The primary persisted model is structured schedule fields, not raw cron text. Next-run timestamps are derived from these fields by server logic.

### Timezone semantics

The app uses one global timezone for all automations. This timezone comes from environment configuration and should be surfaced in the product so users understand what "9:00 AM" means operationally.

Recommended runtime behavior:

- add support for `TZ` in Docker/runtime environment
- validate and apply it at server startup
- use it for all next-run calculations and displayed schedule labels
- do not support per-automation timezone overrides in v1

## Runtime Behavior

### Execution architecture

Use an in-process scheduler inside the existing Node app. Do not introduce a separate worker process for v1.

Scheduler responsibilities:

1. Load enabled automations from SQLite on startup
2. Compute and persist `next_run_at`
3. Wake when the next automation becomes due
4. Claim and start due automations one at a time with concurrency guards
5. Create run records and linked conversations
6. Execute the existing chat pipeline with the automation prompt, provider profile, and optional persona
7. Persist run completion state and the following `next_run_at`

This keeps deployment aligned with the current single-app architecture and reuses the existing conversation and chat runtime.

### Execution flow

For each due automation:

1. Create `automation_runs` row with scheduled metadata
2. Create a fresh conversation linked to that run
3. Submit the automation prompt through the existing chat execution path using the automation's provider profile and persona
4. Mark the run as `running`
5. On completion, mark the run as `completed` or `failed`
6. Update automation metadata such as `last_status`, `last_started_at`, `last_finished_at`, and `next_run_at`

### Downtime and missed runs

When the app is down during a scheduled execution window, do not automatically backfill a burst of missed runs in v1.

Recommended behavior:

- record that the scheduled occurrence was missed
- surface the missed occurrence in automation history
- continue from the next future valid occurrence

This avoids surprising replay behavior, duplicate work, and restart spikes.

### Overlapping executions

If an automation is still running when its next scheduled time arrives, skip the overlapping occurrence in v1 and record it as `missed`. Do not queue overlapping runs for the same automation in the first version.

## Data Model

### New table: `automations`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PRIMARY KEY` | Unique identifier |
| `name` | `TEXT NOT NULL` | User-facing automation name |
| `prompt` | `TEXT NOT NULL` | Instruction executed on each run |
| `provider_profile_id` | `TEXT NOT NULL` | Provider profile used for runs |
| `persona_id` | `TEXT` | Optional persona for runs |
| `schedule_kind` | `TEXT NOT NULL` | `interval` or `calendar` |
| `interval_minutes` | `INTEGER` | Used for interval schedules |
| `calendar_frequency` | `TEXT` | `daily` or `weekly` for calendar schedules |
| `time_of_day` | `TEXT` | Local time in `HH:MM` format |
| `days_of_week` | `TEXT` | Encoded weekly day selection |
| `enabled` | `INTEGER NOT NULL DEFAULT 1` | Active/paused state |
| `next_run_at` | `TEXT` | ISO timestamp for next due run |
| `last_scheduled_for` | `TEXT` | Last scheduled timestamp considered |
| `last_started_at` | `TEXT` | Last run start time |
| `last_finished_at` | `TEXT` | Last run finish time |
| `last_status` | `TEXT` | `running`, `completed`, `failed`, `missed`, or `paused` |
| `created_at` | `TEXT NOT NULL` | ISO timestamp |
| `updated_at` | `TEXT NOT NULL` | ISO timestamp |

### New table: `automation_runs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PRIMARY KEY` | Unique identifier |
| `automation_id` | `TEXT NOT NULL` | Parent automation |
| `conversation_id` | `TEXT` | Linked conversation for this run |
| `scheduled_for` | `TEXT NOT NULL` | The time this run was supposed to fire |
| `started_at` | `TEXT` | Actual execution start |
| `finished_at` | `TEXT` | Actual execution finish |
| `status` | `TEXT NOT NULL` | `queued`, `running`, `completed`, `failed`, `missed`, or `stopped` |
| `error_message` | `TEXT` | Failure explanation when applicable |
| `trigger_source` | `TEXT NOT NULL` | `schedule`, `manual_run`, or `manual_retry` |
| `created_at` | `TEXT NOT NULL` | ISO timestamp |

### New columns on `conversations`

| Column | Type | Description |
|--------|------|-------------|
| `automation_id` | `TEXT` | Parent automation if this is an automation conversation |
| `automation_run_id` | `TEXT` | Specific run linkage |
| `conversation_origin` | `TEXT NOT NULL DEFAULT 'manual'` | `manual` or `automation` |

These fields let the app reuse the normal conversation rendering stack while filtering manual and automation conversations into different navigation surfaces.

## Navigation And Pages

### Settings

Add a new route:

- `/settings/automations`

Purpose:

- create and edit automations
- pause or enable automations
- view next run and last result summary
- manage cadence, prompt, provider profile, and persona

The Settings UI is for authoring and configuration. It is not the primary operational history surface.

### Automations workspace

Add dedicated app routes:

- `/automations`
- `/automations/[automationId]`
- `/automations/[automationId]/runs/[runId]`

Behavior:

- the left sidebar lists automation definitions
- selecting an automation shows its run history
- selecting a run opens the full conversation transcript for that run
- the run detail reuses the same conversation-style viewer as normal chats

This workspace should feel parallel to the chat workspace, not like a modal or a report screen.

### Shell integration

Extend `Shell` to switch among three navigation modes based on pathname:

- `Sidebar` for normal chat routes
- `SettingsNav` for settings routes
- `AutomationsNav` for automation workspace routes

Do not mix automation runs into the existing main sidebar list.

## Settings Page UX

The settings page should include:

- automation list
- create button
- editor for name and prompt
- provider profile selector
- optional persona selector
- cadence editor with interval and calendar variants
- enable/pause toggle
- next run preview
- last run status summary

Validation requirements:

- minimum interval of 5 minutes
- required prompt
- required provider profile
- weekly schedules require at least one weekday
- invalid configurations block save with field-level messages

## Automations Workspace UX

The dedicated Automations workspace should include:

- automation sidebar with name, enabled state, next run, and last result signal
- selected automation detail view with recent runs
- run state badges for `running`, `completed`, `failed`, and `missed`
- ability to open any previous run as a full conversation view
- ability to manually run now and retry failed runs

The workspace should prioritize active and historical visibility without making normal chat navigation noisy.

## API Shape

Add resource-shaped APIs:

- `GET /api/automations`
- `POST /api/automations`
- `GET /api/automations/[automationId]`
- `PATCH /api/automations/[automationId]`
- `DELETE /api/automations/[automationId]`
- `GET /api/automations/[automationId]/runs`
- `POST /api/automations/[automationId]/run-now`
- `POST /api/automation-runs/[runId]/retry`

The API should return schedule configuration in structured fields rather than raw cron expressions.

## Failure Cases

### Invalid references

If an automation references a provider profile or persona that no longer exists:

- scheduled executions should fail with a clear recorded reason
- the failure should be visible in run history
- the automation should remain editable so the user can repair it

### Runtime failures

If the chat pipeline fails during execution:

- preserve the linked conversation
- mark the run `failed`
- store a short `error_message`

### Scheduler safety

The scheduler must avoid duplicate firing for the same due occurrence. Claiming logic should ensure one run record per due slot even if the app loop wakes twice.

## Files Changed

| File | Change |
|------|--------|
| `lib/db.ts` | Add automations and automation_runs tables plus conversation linkage columns |
| `lib/types.ts` | Add automation and automation run types |
| `lib/env.ts` | Parse and validate timezone-related environment configuration |
| `Dockerfile` | Add runtime timezone environment support |
| `lib/automations.ts` | New data access layer for automation definitions and runs |
| `lib/automation-scheduler.ts` | New scheduler loop and next-run calculation logic |
| `lib/chat-turn.ts` | Reuse chat execution for scheduled runs |
| `components/shell.tsx` | Route-aware nav switching for Automations workspace |
| `components/automations/*` | New workspace components and navigation |
| `app/automations/*` | New workspace pages |
| `components/settings/settings-nav.tsx` | Add settings route for scheduled automations |
| `app/settings/automations/page.tsx` | New settings page route |
| `components/settings/sections/automations-section.tsx` | New settings CRUD/editor component |
| `app/api/automations/*` | New automation APIs |
| `tests/unit/*` | Scheduler, next-run calculation, and persistence coverage |
| `tests/e2e/*` | Settings and workspace flows for automations |

## Testing

### Unit coverage

- schedule validation
- minimum 5-minute enforcement
- next-run calculation for interval and calendar schedules
- timezone-aware scheduling behavior
- downtime handling that records missed runs without replay bursts
- conversation filtering so automation conversations do not leak into the main chat sidebar

### Integration coverage

- creating an automation persists correct rows
- triggering an automation creates a run and linked conversation
- failed runs retain visible conversation history and error state
- manual retry creates a new run with `trigger_source = manual_retry`

### E2E coverage

- create automation from settings
- view automation in Automations workspace
- manually run an automation
- open a previous run and see the full conversation transcript
- confirm main chat sidebar remains free of automation runs

## Out Of Scope

- per-automation timezone overrides
- exposing raw cron syntax in the UI
- backfilling missed runs after downtime
- concurrency queues for overlapping runs of the same automation
- attachments or complex workflow steps inside automation definitions
- multi-step workflow automation beyond one prompt per run
