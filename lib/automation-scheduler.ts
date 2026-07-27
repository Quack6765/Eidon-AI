import { env } from "@/lib/env";
import {
  getAutomationCatchUpWindow,
  getNextAutomationRunAt
} from "@/lib/automation-schedule";
import {
  attachConversationToRun,
  claimAutomationRun,
  commitScheduledAutomationSlots,
  createAutomationRun,
  getAutomation,
  getAutomationOwnerId,
  getAutomationRun,
  listAutomations,
  listDueAutomations,
  listQueuedAutomationRuns,
  MAX_AUTOMATION_CATCH_UP_RUNS,
  updateAutomation,
  updateAutomationRunStatus
} from "@/lib/automations";
import { createConversation } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getPersona } from "@/lib/personas";
import { getProviderProfile } from "@/lib/settings";
import type { StartChatTurn } from "@/lib/chat-turn";
import { startChatTurn } from "@/lib/chat-turn";
import { requestStop } from "@/lib/chat-turn-control";
import {
  AutomationOwnerBusyError,
  configureAutomationExecutionLimit,
  enqueueAutomationExecution,
  getAutomationExecutionLimiterSnapshot,
  type AutomationExecutionOutcome
} from "@/lib/automation-execution-limiter";
import type { ConversationManager } from "@/lib/conversation-manager";
import type { Automation } from "@/lib/types";
import { getConversationManager } from "@/lib/ws-singleton";

type SchedulerDependencies = {
  now?: () => Date;
  timeZone?: string;
  manager?: ConversationManager;
  startChatTurn?: StartChatTurn;
  pollIntervalMs?: number;
  maxConcurrentRuns?: number;
  runTimeoutMs?: number;
};

type SchedulerHandle = {
  wake: () => void;
};

const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000;
const DEFAULT_MAX_CONCURRENT_RUNS = 4;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const SCHEDULER_REGISTRY_KEY = Symbol.for("eidon.automation.schedulers");

class AutomationRunDeadlineError extends Error {
  constructor(readonly settlement: Promise<unknown>) {
    super("Automation run exceeded its execution deadline");
    this.name = "AutomationRunDeadlineError";
  }
}

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

function getAutomationOwnerKey(automationId: string) {
  return getAutomationOwnerId(automationId) ?? "owner:unowned";
}

async function executeAutomationRun(
  runId: string,
  dependencies: Required<
    Pick<SchedulerDependencies, "now" | "manager" | "startChatTurn" | "runTimeoutMs">
  >
): Promise<AutomationExecutionOutcome | void> {
  try {
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

    const automationOwnerId = getAutomationOwnerId(automation.id);

    if (automation.personaId && !getPersona(automation.personaId, automationOwnerId ?? undefined)) {
      updateAutomationRunStatus(runId, {
        status: "failed",
        errorMessage: "Persona not found",
        finishedAt: dependencies.now().toISOString()
      });
      return;
    }

    const setupTransaction = getDb().transaction(() => {
      const startedAt = dependencies.now().toISOString();
      if (!claimAutomationRun(run.id, startedAt)) {
        return null;
      }

      const conversation = createConversation(automation.name, null, {
        providerProfileId: automation.providerProfileId,
        origin: "automation",
        automationId: automation.id,
        automationRunId: run.id
      }, automationOwnerId ?? undefined);
      attachConversationToRun(run.id, conversation.id);
      return conversation;
    });
    const conversation = setupTransaction.immediate();

    if (!conversation) {
      const current = getAutomationRun(run.id);
      if (current?.status === "queued") {
        updateAutomationRunStatus(run.id, {
          status: "failed",
          errorMessage: "Automation already has a running job",
          finishedAt: dependencies.now().toISOString()
        });
      }
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const turn = dependencies.startChatTurn(
      dependencies.manager,
      conversation.id,
      automation.prompt,
      [],
      automation.personaId ?? undefined
    );
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        requestStop(conversation.id);
        reject(new AutomationRunDeadlineError(turn));
      }, dependencies.runTimeoutMs);
    });
    let result: Awaited<ReturnType<StartChatTurn>>;
    try {
      result = await Promise.race([turn, deadline]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }

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
    const current = getAutomationRun(runId);
    if (current?.status === "queued" || current?.status === "running") {
      updateAutomationRunStatus(runId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Automation run failed",
        finishedAt: dependencies.now().toISOString()
      });
    }
    if (error instanceof AutomationRunDeadlineError) {
      return { quarantineUntil: error.settlement };
    }
  }
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

function processDueAutomation(
  automation: Automation,
  nowIsoString: string,
  timeZone: string
) {
  if (!automation.nextRunAt) {
    return;
  }

  const catchUp = getAutomationCatchUpWindow(
    automation,
    automation.nextRunAt,
    nowIsoString,
    timeZone,
    MAX_AUTOMATION_CATCH_UP_RUNS
  );
  const dueSlots = catchUp.dueSlots;

  if (dueSlots.length === 0) {
    return;
  }

  const latestDueSlot = dueSlots[dueSlots.length - 1];
  return commitScheduledAutomationSlots({
    automationId: automation.id,
    missedSlots: dueSlots.slice(0, -1),
    latestDueSlot,
    nextRunAt: catchUp.nextRunAt,
    timestamp: nowIsoString
  });
}

export async function runAutomationNow(
  automationId: string,
  userIdOrDependencies:
    | string
    | (SchedulerDependencies & {
        triggerSource?: "manual_run" | "manual_retry";
      })
    | undefined = undefined,
  maybeDependencies: SchedulerDependencies & {
    triggerSource?: "manual_run" | "manual_retry";
  } = {}
) {
  const userId = typeof userIdOrDependencies === "string" ? userIdOrDependencies : undefined;
  const dependencies = typeof userIdOrDependencies === "string" ? maybeDependencies : (userIdOrDependencies ?? {});
  const automation = getAutomation(automationId, userId);
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
  const ownerKey = getAutomationOwnerKey(automation.id);

  try {
    await enqueueAutomationExecution({
      runId: run.id,
      ownerKey,
      rejectIfOwnerBusy: true,
      execute: () =>
        executeAutomationRun(run.id, {
          now,
          manager,
          startChatTurn: runChatTurn,
          runTimeoutMs: Math.max(1, dependencies.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS)
        })
    });
  } catch (error) {
    if (error instanceof AutomationOwnerBusyError) {
      updateAutomationRunStatus(run.id, {
        status: "failed",
        errorMessage: error.message,
        finishedAt: now().toISOString()
      });
    } else {
      throw error;
    }
  }

  return getAutomationRun(run.id);
}

export async function retryAutomationRunNow(
  runId: string,
  userIdOrDependencies: string | SchedulerDependencies | undefined = undefined,
  maybeDependencies: SchedulerDependencies = {}
) {
  const userId = typeof userIdOrDependencies === "string" ? userIdOrDependencies : undefined;
  const dependencies = typeof userIdOrDependencies === "string" ? maybeDependencies : (userIdOrDependencies ?? {});
  const currentRun = getAutomationRun(runId, userId);
  if (!currentRun) {
    return null;
  }

  const retryDependencies = {
    ...dependencies,
    triggerSource: "manual_retry" as const
  };

  return userId
    ? runAutomationNow(currentRun.automationId, userId, retryDependencies)
    : runAutomationNow(currentRun.automationId, retryDependencies);
}

export function createAutomationScheduler(dependencies: SchedulerDependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const timeZone = dependencies.timeZone ?? env.TZ;
  const manager = dependencies.manager ?? getConversationManager();
  const runChatTurn = dependencies.startChatTurn ?? startChatTurn;
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxConcurrentRuns = Math.max(
    1,
    Math.floor(dependencies.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS)
  );
  const runTimeoutMs = Math.max(1, dependencies.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS);
  configureAutomationExecutionLimit(maxConcurrentRuns);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let started = false;

  function ownerKeyForRun(run: ReturnType<typeof listQueuedAutomationRuns>[number]) {
    return getAutomationOwnerKey(run.automationId);
  }

  function launchAvailableRuns() {
    const launched: Promise<void>[] = [];

    for (const run of listQueuedAutomationRuns()) {
      const ownerKey = ownerKeyForRun(run);
      const promise = enqueueAutomationExecution({
        runId: run.id,
        ownerKey,
        execute: () => executeAutomationRun(run.id, {
          now,
          manager,
          startChatTurn: runChatTurn,
          runTimeoutMs
        })
      })
        .catch((error) => {
          console.error("Automation execution failed", error);
        })
        .finally(() => {
          if (started) {
            schedulerHandle.wake();
          }
        });
      launched.push(promise);
    }

    return launched;
  }

  function scheduleNextCycle() {
    const nextWakeAt = getNextWakeAt();
    const limiterSnapshot = getAutomationExecutionLimiterSnapshot();
    const nextWakeDelayMs = nextWakeAt
      ? Math.max(0, new Date(nextWakeAt).getTime() - now().getTime())
      : pollIntervalMs;
    const hasAdmittedExecutions =
      limiterSnapshot.activeRunIds.length > 0 || limiterSnapshot.pendingRunIds.length > 0;
    const rawDelayMs = nextWakeDelayMs === 0 && hasAdmittedExecutions
      ? pollIntervalMs
      : nextWakeDelayMs;
    const delayMs = Math.min(rawDelayMs, MAX_TIMER_DELAY_MS);

    timer = setTimeout(() => {
      void runCycle(false).catch((error) => {
        console.error("Automation scheduler cycle failed", error);
      });
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
        void runCycle(false).catch((error) => {
          console.error("Automation scheduler cycle failed", error);
        });
      });
    }
  };

  async function runCycle(waitForExecutions: boolean) {
    if (running) {
      return running;
    }

    running = (async () => {
      const nowIsoString = now().toISOString();
      ensureNextRunAt(timeZone, nowIsoString);

      for (const automation of listDueAutomations(nowIsoString)) {
        processDueAutomation(automation, nowIsoString, timeZone);
      }

      if (waitForExecutions) {
        while (true) {
          const launched = launchAvailableRuns();
          if (launched.length === 0) {
            break;
          }
          await Promise.allSettled(launched);
        }
      } else {
        launchAvailableRuns();
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
      await runCycle(true);
    },
    wake() {
      schedulerHandle.wake();
    }
  };
}

export { getNextAutomationRunAt };
