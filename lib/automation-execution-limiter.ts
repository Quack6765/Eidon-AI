export type AutomationExecutionOutcome = {
  quarantineUntil?: Promise<unknown>;
};

type AutomationExecutionTask = {
  runId: string;
  ownerKey: string;
  execute: () => Promise<AutomationExecutionOutcome | void>;
  completion: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type AutomationExecutionRegistry = {
  maxConcurrent: number;
  active: Map<string, AutomationExecutionTask>;
  pending: AutomationExecutionTask[];
  tasksByRunId: Map<string, AutomationExecutionTask>;
  quarantinedOwners: Map<string, Promise<void>>;
};

const AUTOMATION_EXECUTION_REGISTRY_KEY = Symbol.for("eidon.automation.execution-limiter");
const DEFAULT_MAX_CONCURRENT = 4;

export class AutomationOwnerBusyError extends Error {
  constructor() {
    super("Another automation is already active for this user");
    this.name = "AutomationOwnerBusyError";
  }
}

function getRegistry() {
  const scope = globalThis as typeof globalThis & {
    [AUTOMATION_EXECUTION_REGISTRY_KEY]?: AutomationExecutionRegistry;
  };

  if (!scope[AUTOMATION_EXECUTION_REGISTRY_KEY]) {
    scope[AUTOMATION_EXECUTION_REGISTRY_KEY] = {
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      active: new Map(),
      pending: [],
      tasksByRunId: new Map(),
      quarantinedOwners: new Map()
    };
  }

  return scope[AUTOMATION_EXECUTION_REGISTRY_KEY];
}

function isOwnerBusy(registry: AutomationExecutionRegistry, ownerKey: string) {
  return (
    registry.quarantinedOwners.has(ownerKey) ||
    [...registry.active.values()].some((task) => task.ownerKey === ownerKey) ||
    registry.pending.some((task) => task.ownerKey === ownerKey)
  );
}

function drainAutomationExecutions() {
  const registry = getRegistry();

  while (registry.active.size < registry.maxConcurrent) {
    const activeOwners = new Set(
      [...registry.active.values()].map((task) => task.ownerKey)
    );
    const nextIndex = registry.pending.findIndex(
      (task) =>
        !activeOwners.has(task.ownerKey) &&
        !registry.quarantinedOwners.has(task.ownerKey)
    );

    if (nextIndex < 0) {
      return;
    }

    const [task] = registry.pending.splice(nextIndex, 1);
    registry.active.set(task.runId, task);

    let execution: Promise<AutomationExecutionOutcome | void>;
    try {
      execution = task.execute();
    } catch (error) {
      registry.active.delete(task.runId);
      registry.tasksByRunId.delete(task.runId);
      task.reject(error);
      continue;
    }

    void execution.then(
      (outcome) => {
        registry.active.delete(task.runId);
        registry.tasksByRunId.delete(task.runId);

        if (outcome?.quarantineUntil) {
          const settlement = outcome.quarantineUntil
            .then(
              () => {
                console.info(`[automation] Timed-out run ${task.runId} settled`);
              },
              (error) => {
                console.error(`[automation] Timed-out run ${task.runId} rejected after timeout`, error);
              }
            )
            .finally(() => {
              if (registry.quarantinedOwners.get(task.ownerKey) === settlement) {
                registry.quarantinedOwners.delete(task.ownerKey);
              }
              drainAutomationExecutions();
            });
          registry.quarantinedOwners.set(task.ownerKey, settlement);
        }

        task.resolve();
        drainAutomationExecutions();
      },
      (error) => {
        registry.active.delete(task.runId);
        registry.tasksByRunId.delete(task.runId);
        task.reject(error);
        drainAutomationExecutions();
      }
    );
  }
}

export function configureAutomationExecutionLimit(maxConcurrent: number) {
  const registry = getRegistry();
  if (
    registry.active.size === 0 &&
    registry.pending.length === 0 &&
    registry.quarantinedOwners.size === 0
  ) {
    registry.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  }
  drainAutomationExecutions();
}

export function enqueueAutomationExecution(input: {
  runId: string;
  ownerKey: string;
  execute: () => Promise<AutomationExecutionOutcome | void>;
  rejectIfOwnerBusy?: boolean;
}) {
  const registry = getRegistry();
  const existing = registry.tasksByRunId.get(input.runId);
  if (existing) {
    return existing.completion;
  }

  if (input.rejectIfOwnerBusy && isOwnerBusy(registry, input.ownerKey)) {
    throw new AutomationOwnerBusyError();
  }

  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const task: AutomationExecutionTask = {
    runId: input.runId,
    ownerKey: input.ownerKey,
    execute: input.execute,
    completion,
    resolve,
    reject
  };
  registry.pending.push(task);
  registry.tasksByRunId.set(task.runId, task);
  drainAutomationExecutions();
  return completion;
}

export function getAutomationExecutionLimiterSnapshot() {
  const registry = getRegistry();
  return {
    maxConcurrent: registry.maxConcurrent,
    activeRunIds: [...registry.active.keys()],
    pendingRunIds: registry.pending.map((task) => task.runId),
    quarantinedOwnerKeys: [...registry.quarantinedOwners.keys()]
  };
}

export function resetAutomationExecutionLimiterForTests() {
  const scope = globalThis as typeof globalThis & {
    [AUTOMATION_EXECUTION_REGISTRY_KEY]?: AutomationExecutionRegistry;
  };
  delete scope[AUTOMATION_EXECUTION_REGISTRY_KEY];
}
