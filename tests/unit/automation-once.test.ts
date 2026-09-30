import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertFutureRunAt,
  assertValidSchedule,
  commitOneTimeAutomationSlot,
  createAutomation,
  createAutomationRun,
  getAutomation,
  getAutomationRun,
  listAutomationRuns,
  listAutomations,
  pruneExpiredOneTimeAutomations,
  updateAutomation,
  updateAutomationRunStatus
} from "@/lib/automations";
import { describeSchedule } from "@/lib/automation-display";
import { getDb } from "@/lib/db";
import { createConversation, getConversation } from "@/lib/conversations";
import { dispatchRunNotification } from "@/lib/notifications";
import { createLocalUser } from "@/lib/users";
import { updateProviderCatalog } from "@/lib/settings";
import { createProviderProfileInput, createRuntimeProviderProfile } from "@/tests/provider-fixtures";
import { POST as createAutomationRoute } from "@/app/api/automations/route";
import {
  GET as getAutomationRoute,
  PATCH as updateAutomationRoute
} from "@/app/api/automations/[automationId]/route";
import { executeCreateAutomationProposal } from "@/lib/tool-executors";
import type { PromptMessage } from "@/lib/types";

const PROVIDER_PROFILE_ID = "profile_once";
const RUN_AT = "2027-04-10T09:00:00.000Z";
const PAST_RUN_AT = "2020-01-01T00:00:00.000Z";

let routeUserId = "";

beforeEach(() => {
  vi.mocked(dispatchRunNotification).mockClear();
});

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn()
}));

vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return {
    ...actual,
    dispatchRunNotification: vi.fn(async () => {})
  };
});

function registerProviderProfile() {
  updateProviderCatalog({
    defaultProviderProfileId: PROVIDER_PROFILE_ID,
    skillsEnabled: false,
    providerProfiles: [
      createProviderProfileInput({
        id: PROVIDER_PROFILE_ID,
        name: "One-time Automations Test",
        model: "gpt-test",
        systemPrompt: "Be exact.",
        temperature: 0.2,
        maxOutputTokens: 512,
        modelContextLimit: 16384,
        freshTailCount: 12,
        visionMode: "none",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z"
      })
    ]
  });
}

function createOneTimeAutomation(
  overrides: Partial<Parameters<typeof createAutomation>[0]> = {},
  userId?: string
) {
  return createAutomation(
    {
      name: "Remind me",
      prompt: "Send the standup note",
      providerProfileId: PROVIDER_PROFILE_ID,
      personaId: null,
      scheduleKind: "once",
      intervalMinutes: null,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: [],
      runAt: RUN_AT,
      ...overrides
    },
    userId
  );
}

function buildExecutorContext() {
  const startedActions: Array<Record<string, unknown>> = [];
  return {
    context: {
      input: {
        settings: createRuntimeProviderProfile({ id: PROVIDER_PROFILE_ID }),
        onActionStart: async (action: Record<string, unknown>) => {
          startedActions.push(action);
          return "act_once";
        }
      },
      timelineSortOrder: 1,
      promptMessages: [] as PromptMessage[]
    },
    startedActions
  };
}

beforeEach(async () => {
  vi.mocked(dispatchRunNotification).mockClear();
  registerProviderProfile();
  const user = await createLocalUser({
    username: "once-user",
    password: "Password123!",
    role: "admin"
  });
  routeUserId = user.id;
  const auth = await import("@/lib/auth");
  vi.mocked(auth.requireUser).mockResolvedValue({
    ...user,
    passwordManagedBy: "local"
  });
});

describe("one-time automation schedule validation", () => {
  it("requires a valid run time for the once schedule kind", () => {
    expect(() =>
      assertValidSchedule({
        scheduleKind: "once",
        intervalMinutes: null,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: [],
        runAt: null
      })
    ).toThrow("One-time automations require a run time");

    expect(() =>
      assertValidSchedule({
        scheduleKind: "once",
        intervalMinutes: null,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: [],
        runAt: "not-a-date"
      })
    ).toThrow("One-time automations require a valid run time");

    expect(() =>
      assertValidSchedule({
        scheduleKind: "once",
        intervalMinutes: null,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: [],
        runAt: RUN_AT
      })
    ).not.toThrow();
  });

  it("rejects a run time that is not in the future", () => {
    const now = Date.parse(RUN_AT);
    expect(() => assertFutureRunAt("once", RUN_AT, now - 1_000)).not.toThrow();
    expect(() => assertFutureRunAt("once", RUN_AT, now)).toThrow(
      "One-time automations must be scheduled in the future"
    );
    expect(() => assertFutureRunAt("interval", null, now)).not.toThrow();
  });

  it("adds the run_at column to the automations table", () => {
    const cols = getDb().prepare("PRAGMA table_info(automations)").all() as Array<{
      name: string;
    }>;
    expect(cols.map((col) => col.name)).toContain("run_at");
  });
});

describe("one-time automation storage", () => {
  it("stores the run time, arms the next run, and defaults notifications to web push", () => {
    const automation = createOneTimeAutomation();

    expect(automation.runAt).toBe(RUN_AT);
    expect(automation.nextRunAt).toBe(RUN_AT);
    expect(automation.intervalMinutes).toBeNull();
    expect(automation.calendarFrequency).toBeNull();
    expect(automation.timeOfDay).toBeNull();
    expect(automation.daysOfWeek).toEqual([]);
    expect(getAutomation(automation.id)?.notifyConfig).toEqual({
      channels: [expect.objectContaining({ kind: "push" })]
    });
    expect(describeSchedule(getAutomation(automation.id)!)).toContain("Once on");
  });

  it("keeps an explicitly supplied notify config instead of defaulting", () => {
    const automation = createOneTimeAutomation({
      notifyConfig: { channels: [{ kind: "ntfy", topic: "alerts" }] }
    });

    expect(getAutomation(automation.id)?.notifyConfig).toEqual({
      channels: [expect.objectContaining({ kind: "ntfy", topic: "alerts" })]
    });
  });

  it("does not default notifications for recurring automations", () => {
    const automation = createAutomation({
      name: "Recurring",
      prompt: "Prompt",
      providerProfileId: PROVIDER_PROFILE_ID,
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 15,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    expect(getAutomation(automation.id)?.notifyConfig).toEqual({ channels: [] });
  });

  it("rejects creating a one-time automation in the past", () => {
    expect(() => createOneTimeAutomation({ runAt: "2020-01-01T00:00:00.000Z" })).toThrow(
      "One-time automations must be scheduled in the future"
    );
  });

  it("recomputes the next run when the run time changes and never re-arms a past slot", () => {
    const automation = createOneTimeAutomation();

    const moved = updateAutomation(automation.id, { runAt: "2027-04-11T09:00:00.000Z" });
    expect(moved?.runAt).toBe("2027-04-11T09:00:00.000Z");
    expect(moved?.nextRunAt).toBe("2027-04-11T09:00:00.000Z");

    const cleared = updateAutomation(automation.id, { nextRunAt: null });
    expect(cleared?.nextRunAt).toBeNull();

    const edited = updateAutomation(automation.id, { name: "Renamed" });
    expect(edited?.name).toBe("Renamed");
    expect(edited?.nextRunAt).toBe("2027-04-11T09:00:00.000Z");
  });
});

describe("one-time automation commit", () => {
  it("fires exactly one run and clears the next run so it cannot re-arm", () => {
    const automation = createOneTimeAutomation();

    const run = commitOneTimeAutomationSlot({
      automationId: automation.id,
      runAt: RUN_AT,
      timestamp: "2027-04-10T09:00:00.000Z"
    });

    expect(run?.scheduledFor).toBe(RUN_AT);
    expect(run?.triggerSource).toBe("schedule");
    expect(run?.status).toBe("queued");
    expect(getAutomation(automation.id)?.nextRunAt).toBeNull();

    const second = commitOneTimeAutomationSlot({
      automationId: automation.id,
      runAt: RUN_AT,
      timestamp: "2027-04-10T09:00:05.000Z"
    });

    expect(second).toBeNull();
    expect(listAutomationRuns(automation.id)).toHaveLength(1);
  });

  it("still fires a slot that passed while the server was down", () => {
    const automation = createOneTimeAutomation();
    updateAutomation(automation.id, { runAt: PAST_RUN_AT, nextRunAt: PAST_RUN_AT });

    const run = commitOneTimeAutomationSlot({
      automationId: automation.id,
      runAt: PAST_RUN_AT,
      timestamp: "2027-04-10T09:00:00.000Z"
    });

    expect(run?.status).toBe("queued");
    expect(run?.scheduledFor).toBe(PAST_RUN_AT);
    expect(getAutomation(automation.id)?.nextRunAt).toBeNull();
  });

  it("keeps the slot armed while another run of the automation is still running", () => {
    const automation = createOneTimeAutomation();
    const running = createAutomationRun({
      automationId: automation.id,
      scheduledFor: RUN_AT,
      triggerSource: "manual_run"
    });
    updateAutomationRunStatus(running.id, {
      status: "running",
      startedAt: "2027-04-10T08:00:00.000Z"
    });

    const run = commitOneTimeAutomationSlot({
      automationId: automation.id,
      runAt: RUN_AT,
      timestamp: "2027-04-10T09:00:00.000Z"
    });

    expect(run).toBeNull();
    expect(getAutomation(automation.id)?.nextRunAt).toBe(RUN_AT);

    updateAutomationRunStatus(running.id, {
      status: "completed",
      finishedAt: "2027-04-10T09:00:01.000Z"
    });

    const retried = commitOneTimeAutomationSlot({
      automationId: automation.id,
      runAt: RUN_AT,
      timestamp: "2027-04-10T09:00:02.000Z"
    });

    expect(retried?.status).toBe("queued");
    expect(getAutomation(automation.id)?.nextRunAt).toBeNull();
  });

  it("prunes an expired one-time automation that was never fired", () => {
    const stale = createOneTimeAutomation();
    updateAutomation(stale.id, { runAt: PAST_RUN_AT });
    const armed = createOneTimeAutomation();

    expect(getAutomation(stale.id)?.nextRunAt).toBeNull();

    const deleted = pruneExpiredOneTimeAutomations("2026-06-01T00:00:00.000Z");

    expect(deleted).toEqual([stale.id]);
    expect(getAutomation(stale.id)).toBeNull();
    expect(getAutomation(armed.id)).not.toBeNull();
  });

  it("keeps a one-time automation whose run is still in flight", () => {
    const automation = createOneTimeAutomation();
    updateAutomation(automation.id, { runAt: PAST_RUN_AT });
    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: PAST_RUN_AT,
      triggerSource: "schedule"
    });

    expect(pruneExpiredOneTimeAutomations("2027-04-10T09:00:00.000Z")).toEqual([]);
    expect(getAutomation(automation.id)).not.toBeNull();
    expect(getAutomationRun(run.id)?.status).toBe("queued");  });

  it("leaves recurring automations alone in the prune sweep", () => {
    const recurring = createAutomation({
      name: "Recurring",
      prompt: "Prompt",
      providerProfileId: PROVIDER_PROFILE_ID,
      personaId: null,
      scheduleKind: "calendar",
      intervalMinutes: null,
      calendarFrequency: "daily",
      timeOfDay: "09:00",
      daysOfWeek: []
    });

    expect(pruneExpiredOneTimeAutomations("2030-01-01T00:00:00.000Z")).toEqual([]);
    expect(listAutomations().map((automation) => automation.id)).toEqual([recurring.id]);
  });
});

describe("one-time automation consumption", () => {
  it("deletes itself once the scheduled run finishes and notifies with the conversation link", async () => {
    process.env.EIDON_BASE_URL = "https://eidon.example.com";
    try {
      const automation = createOneTimeAutomation();
      const run = commitOneTimeAutomationSlot({
        automationId: automation.id,
        runAt: RUN_AT,
        timestamp: RUN_AT
      });
      const conversation = createConversation("Reminder", null, {}, undefined);
      getDb()
        .prepare("UPDATE automation_runs SET conversation_id = ? WHERE id = ?")
        .run(conversation.id, run!.id);

      updateAutomationRunStatus(run!.id, {
        status: "completed",
        finishedAt: RUN_AT
      });

      await vi.waitFor(() => {
        expect(getAutomation(automation.id)).toBeNull();
      });

      expect(getConversation(conversation.id, undefined)).not.toBeNull();
      expect(dispatchRunNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "automation_run_done",
          status: "completed",
          automationId: automation.id,
          url: `https://eidon.example.com/conversations/${conversation.id}`
        })
      );
    } finally {
      delete process.env.EIDON_BASE_URL;
    }
  });

  it("consumes the automation on failure too", async () => {
    const automation = createOneTimeAutomation();
    const run = commitOneTimeAutomationSlot({
      automationId: automation.id,
      runAt: RUN_AT,
      timestamp: RUN_AT
    });

    updateAutomationRunStatus(run!.id, {
      status: "failed",
      errorMessage: "Provider unavailable",
      finishedAt: RUN_AT
    });

    await vi.waitFor(() => {
      expect(getAutomation(automation.id)).toBeNull();
    });
  });

  it("stays armed when a manual run finishes", async () => {
    const automation = createOneTimeAutomation();
    const manual = createAutomationRun({
      automationId: automation.id,
      scheduledFor: RUN_AT,
      triggerSource: "manual_run"
    });

    updateAutomationRunStatus(manual.id, {
      status: "completed",
      finishedAt: RUN_AT
    });

    await vi.waitFor(() => {
      expect(dispatchRunNotification).toHaveBeenCalled();
    });

    expect(getAutomation(automation.id)).not.toBeNull();
    expect(getAutomation(automation.id)?.nextRunAt).toBe(RUN_AT);
  });

  it("keeps recurring automations and their run deep link", async () => {
    process.env.EIDON_BASE_URL = "https://eidon.example.com";
    try {
      const automation = createAutomation({
        name: "Recurring",
        prompt: "Prompt",
        providerProfileId: PROVIDER_PROFILE_ID,
        personaId: null,
        scheduleKind: "calendar",
        intervalMinutes: null,
        calendarFrequency: "daily",
        timeOfDay: "09:00",
        daysOfWeek: [],
        notifyConfig: { channels: [{ kind: "push" }] }
      });
      const run = createAutomationRun({
        automationId: automation.id,
        scheduledFor: RUN_AT,
        triggerSource: "schedule"
      });

      updateAutomationRunStatus(run.id, {
        status: "completed",
        finishedAt: RUN_AT
      });

      await vi.waitFor(() => {
        expect(dispatchRunNotification).toHaveBeenCalled();
      });

      expect(getAutomation(automation.id)).not.toBeNull();
      expect(dispatchRunNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          url: undefined,
          automationId: automation.id
        })
      );
    } finally {
      delete process.env.EIDON_BASE_URL;
    }
  });
});

describe("one-time automation routes", () => {
  it("rejects a past run time on create and returns the stored run time", async () => {
    const response = await createAutomationRoute(
      new Request("http://localhost/api/automations", {
        method: "POST",
        body: JSON.stringify({
          name: "Past reminder",
          prompt: "Prompt",
          providerProfileId: PROVIDER_PROFILE_ID,
          personaId: null,
          botId: null,
          scheduleKind: "once",
          intervalMinutes: null,
          calendarFrequency: null,
          timeOfDay: null,
          daysOfWeek: [],
          runAt: "2020-01-01T00:00:00.000Z"
        })
      })
    );

    expect(response.status).toBe(400);

    const created = await createAutomationRoute(
      new Request("http://localhost/api/automations", {
        method: "POST",
        body: JSON.stringify({
          name: "Reminder",
          prompt: "Prompt",
          providerProfileId: PROVIDER_PROFILE_ID,
          personaId: null,
          botId: null,
          scheduleKind: "once",
          intervalMinutes: null,
          calendarFrequency: null,
          timeOfDay: null,
          daysOfWeek: [],
          runAt: RUN_AT
        })
      })
    );

    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { automation: { id: string; runAt: string } };
    expect(createdBody.automation.runAt).toBe(RUN_AT);

    const listed = await getAutomationRoute(
      new Request("http://localhost/api/automations"),
      { params: Promise.resolve({ automationId: createdBody.automation.id }) }
    );
    const listedBody = (await listed.json()) as { automation: { runAt: string } };
    expect(listedBody.automation.runAt).toBe(RUN_AT);
  });

  it("rejects moving a one-time automation into the past", async () => {
    const automation = createOneTimeAutomation({}, routeUserId);

    const response = await updateAutomationRoute(
      new Request(`http://localhost/api/automations/${automation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ runAt: "2020-01-01T00:00:00.000Z" })
      }),
      { params: Promise.resolve({ automationId: automation.id }) }
    );

    expect(response.status).toBe(400);
    expect(getAutomation(automation.id)?.runAt).toBe(RUN_AT);
  });
});

describe("one-time automation tool", () => {
  it("proposes a one-time automation that carries the resolved run time", async () => {
    const { context, startedActions } = buildExecutorContext();

    const result = await executeCreateAutomationProposal(
      "call_once",
      {
        name: "Standup reminder",
        prompt: "Send the standup note",
        schedule_kind: "once",
        run_at: "2027-04-10T09:00:00.000Z"
      },
      context
    );

    expect(startedActions[0]).toEqual(
      expect.objectContaining({
        kind: "create_automation",
        proposalPayload: expect.objectContaining({
          scheduleKind: "once",
          runAt: RUN_AT,
          intervalMinutes: null,
          calendarFrequency: null,
          timeOfDay: null,
          daysOfWeek: []
        })
      })
    );
    expect(result.promptMessages.at(-1)?.content).toContain("deletes itself");
  });

  it("returns a tool error when the run time is missing or in the past", async () => {
    const missing = buildExecutorContext();
    const missingResult = await executeCreateAutomationProposal(
      "call_missing",
      {
        name: "Standup reminder",
        prompt: "Send the standup note",
        schedule_kind: "once"
      },
      missing.context
    );

    expect(missing.startedActions).toHaveLength(0);
    expect(missingResult.promptMessages.at(-1)?.content).toContain(
      "Error: One-time automations require a run time"
    );

    const past = buildExecutorContext();
    const pastResult = await executeCreateAutomationProposal(
      "call_past",
      {
        name: "Standup reminder",
        prompt: "Send the standup note",
        schedule_kind: "once",
        run_at: "2020-01-01T00:00:00.000Z"
      },
      past.context
    );

    expect(past.startedActions).toHaveLength(0);
    expect(pastResult.promptMessages.at(-1)?.content).toContain(
      "Error: One-time automations must be scheduled in the future"
    );
  });
});
