import { env } from "@/lib/env";
import { getNextAutomationRunAt } from "@/lib/automation-schedule";
import {
  attachConversationToRun,
  createAutomationRun,
  getAutomation,
  getAutomationRun,
  listAutomationRuns,
  listAutomations,
  listDueAutomations,
  listQueuedAutomationRuns,
  updateAutomation,
  updateAutomationRunStatus
} from "@/lib/automations";
import { createConversation } from "@/lib/conversations";
import { getPersona } from "@/lib/personas";
import { getProviderProfile } from "@/lib/settings";
import type { StartChatTurn } from "@/lib/chat-turn";
import { startChatTurn } from "@/lib/chat-turn";
import type { ConversationManager } from "@/lib/conversation-manager";
import type { Automation } from "@/lib/types";
import { getConversationManager } from "@/lib/ws-singleton";

type SchedulerDependencies = {
  now?: () => Date;
  timeZone?: string;
  manager?: ConversationManager;
  startChatTurn?: StartChatTurn;
  pollIntervalMs?: number;
};

type SchedulerHandle = {
  wake: () => void;
};

const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000;
const SCHEDULER_REGISTRY_KEY = Symbol.for("eidon.automation.schedulers");

function getActiveSchedulers() {
  const scope = globalThis as typeof globalThis & {
    [SCHEDULER_REGISTRY_KEY]?: Set<SchedulerHandle>;
  };

  if (!scope[SCHEDULER_REGISTRY_KEY]) {
    scope[SCHEDULER_REGISTRY_KEY] = new Set<SchedulerHandle>();
  }

  return scope[SCHEDULER_REGISTRY_KEY];
}

function registerScheduler(handle: SchedulerHandle) {
  getActiveSchedulers().add(handle);
}

function unregisterScheduler(handle: SchedulerHandle) {
  getActiveSchedulers().delete(handle);
}

export function wakeAutomationSchedulers() {
  for (const scheduler of getActiveSchedulers()) {
    scheduler.wake();
  }
}

function getNextWakeAt() {
  const queuedRun = listQueuedAutomationRuns()[0];
  const automationWakeAt = listAutomations()
    .filter((automation) => automation.enabled && automation.nextRunAt)
    .map((automation) => automation.nextRunAt as string)
    .sort((left, right) => left.localeCompare(right))[0] ?? null;

  if (queuedRun && automationWakeAt) {
    return queuedRun.scheduledFor < automationWakeAt ? queuedRun.scheduledFor : automationWakeAt;
  }

  return queuedRun?.scheduledFor ?? automationWakeAt ?? null;
}

async function executeAutomationRun(
  runId: string,
  dependencies: Required<Pick<SchedulerDependencies, "now" | "manager" | "startChatTurn">>
) {
  const run = getAutomationRun(runId);
  if (!run || run.status !== "queued") {
    return;
  }

  const automation = getAutomation(run.automationId);
  if (!automation) {
    updateAutomationRunStatus(runId, {
      status: "failed",
      errorMessage: "Automation not found",
      finishedAt: dependencies.now().toISOString()
    });
    return;
  }

  if (!getProviderProfile(automation.providerProfileId)) {
    updateAutomationRunStatus(runId, {
      status: "failed",
      errorMessage: "Provider profile not found",
      finishedAt: dependencies.now().toISOString()
    });
    return;
  }

  if (automation.personaId && !getPersona(automation.personaId)) {
    updateAutomationRunStatus(runId, {
      status: "failed",
      errorMessage: "Persona not found",
      finishedAt: dependencies.now().toISOString()
    });
    return;
  }

  const otherRunningRun = listAutomationRuns(automation.id).find(
    (candidate) => candidate.id !== run.id && candidate.status === "running"
  );
  if (otherRunningRun) {
    updateAutomationRunStatus(runId, {
      status: "failed",
      errorMessage: "Automation already has a running job",
      finishedAt: dependencies.now().toISOString()
    });
    return;
  }

  const conversation = createConversation(automation.name, null, {
    providerProfileId: automation.providerProfileId,
    origin: "automation",
    automationId: automation.id,
    automationRunId: run.id
  });
  attachConversationToRun(run.id, conversation.id);
  updateAutomationRunStatus(run.id, {
    status: "running",
    startedAt: dependencies.now().toISOString(),
    errorMessage: null
  });

  try {
    const result = await dependencies.startChatTurn(
      dependencies.manager,
      conversation.id,
      automation.prompt,
      [],
      automation.personaId ?? undefined
    );

    const completedAt = dependencies.now().toISOString();
    if (result?.status === "failed") {
      updateAutomationRunStatus(run.id, {
        status: "failed",
        errorMessage: result.errorMessage ?? "Automation run failed",
        finishedAt: completedAt
      });
      return;
    }

    if (result?.status === "stopped") {
      updateAutomationRunStatus(run.id, {
        status: "stopped",
        finishedAt: completedAt
      });
      return;
    }

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: completedAt
    });
  } catch (error) {
    updateAutomationRunStatus(run.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Automation run failed",
      finishedAt: dependencies.now().toISOString()
    });
  }
}

function createMissedRun(automationId: string, scheduledFor: string, nowIsoString: string) {
  const run = createAutomationRun({
    automationId,
    scheduledFor,
    triggerSource: "schedule"
  });
  updateAutomationRunStatus(run.id, {
    status: "missed",
    finishedAt: nowIsoString
  });
}

function ensureNextRunAt(timeZone: string, nowIsoString: string) {
  for (const automation of listAutomations()) {
    if (!automation.enabled) {
      continue;
    }

    if (automation.nextRunAt && automation.nextRunAt <= nowIsoString) {
      continue;
    }

    const anchorIsoString = automation.lastScheduledFor ?? automation.updatedAt ?? nowIsoString;
    const expectedNextRunAt = getNextAutomationRunAt(automation, anchorIsoString, timeZone);

    if (automation.nextRunAt === expectedNextRunAt) {
      continue;
    }

    updateAutomation(automation.id, { nextRunAt: expectedNextRunAt });
  }
}

async function processDueAutomation(
  automation: Automation,
  nowIsoString: string,
  timeZone: string,
  dependencies: Required<Pick<SchedulerDependencies, "now" | "manager" | "startChatTurn">>
) {
  if (!automation.nextRunAt) {
    return;
  }

  const dueSlots: string[] = [];
  let cursor = automation.nextRunAt;
  while (cursor <= nowIsoString) {
    dueSlots.push(cursor);
    cursor = getNextAutomationRunAt(automation, cursor, timeZone);
  }

  if (dueSlots.length === 0) {
    return;
  }

  const hasRunningRun = listAutomationRuns(automation.id).some((run) => run.status === "running");
  const latestDueSlot = dueSlots[dueSlots.length - 1];

  for (const missedSlot of hasRunningRun ? dueSlots : dueSlots.slice(0, -1)) {
    createMissedRun(automation.id, missedSlot, nowIsoString);
  }

  updateAutomation(automation.id, { nextRunAt: cursor });

  if (hasRunningRun) {
    return;
  }

  const run = createAutomationRun({
    automationId: automation.id,
    scheduledFor: latestDueSlot,
    triggerSource: "schedule"
  });
  await executeAutomationRun(run.id, dependencies);
}

export async function runAutomationNow(
  automationId: string,
  dependencies: SchedulerDependencies & {
    triggerSource?: "manual_run" | "manual_retry";
  } = {}
) {
  const automation = getAutomation(automationId);
  if (!automation) {
    return null;
  }

  const now = dependencies.now ?? (() => new Date());
  const manager = dependencies.manager ?? getConversationManager();
  const runChatTurn = dependencies.startChatTurn ?? startChatTurn;
  const run = createAutomationRun({
    automationId: automation.id,
    scheduledFor: now().toISOString(),
    triggerSource: dependencies.triggerSource ?? "manual_run"
  });

  await executeAutomationRun(run.id, {
    now,
    manager,
    startChatTurn: runChatTurn
  });

  return getAutomationRun(run.id);
}

export async function retryAutomationRunNow(
  runId: string,
  dependencies: SchedulerDependencies = {}
) {
  const currentRun = getAutomationRun(runId);
  if (!currentRun) {
    return null;
  }

  return runAutomationNow(currentRun.automationId, {
    ...dependencies,
    triggerSource: "manual_retry"
  });
}

export function createAutomationScheduler(dependencies: SchedulerDependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const timeZone = dependencies.timeZone ?? env.TZ;
  const manager = dependencies.manager ?? getConversationManager();
  const runChatTurn = dependencies.startChatTurn ?? startChatTurn;
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let started = false;

  function scheduleNextCycle() {
    const nextWakeAt = getNextWakeAt();
    const delayMs = nextWakeAt
      ? Math.max(0, new Date(nextWakeAt).getTime() - now().getTime())
      : pollIntervalMs;

    timer = setTimeout(() => {
      void runCycle();
    }, delayMs);
  }

  const schedulerHandle: SchedulerHandle = {
    wake() {
      if (!started) {
        return;
      }

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      queueMicrotask(() => {
        void runCycle();
      });
    }
  };

  async function runCycle() {
    if (running) {
      return running;
    }

    running = (async () => {
      const nowIsoString = now().toISOString();
      ensureNextRunAt(timeZone, nowIsoString);

      for (const run of listQueuedAutomationRuns()) {
        await executeAutomationRun(run.id, {
          now,
          manager,
          startChatTurn: runChatTurn
        });
      }

      for (const automation of listDueAutomations(nowIsoString)) {
        await processDueAutomation(automation, nowIsoString, timeZone, {
          now,
          manager,
          startChatTurn: runChatTurn
        });
      }
    })().finally(() => {
      running = null;
      if (started) {
        scheduleNextCycle();
      }
    });

    return running;
  }

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      registerScheduler(schedulerHandle);
      schedulerHandle.wake();
    },
    stop() {
      started = false;
      unregisterScheduler(schedulerHandle);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    async runOnce() {
      await runCycle();
    },
    wake() {
      schedulerHandle.wake();
    }
  };
}

export type AutomationScheduler = ReturnType<typeof createAutomationScheduler>;
export { getNextAutomationRunAt };
