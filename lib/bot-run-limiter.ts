const LIMITER_REGISTRY_KEY = Symbol.for("eidon.bot.run.limiter");

export const DEFAULT_MAX_CONCURRENT_BOT_RUNS_PER_USER = 4;
export const DEFAULT_BOT_RUN_TIMEOUT_MS = 30 * 60_000;

type LimiterState = {
  maxConcurrentPerUser: number;
  activeByUser: Map<string, number>;
  slotWaitersByUser: Map<string, Set<() => void>>;
  serialQueues: Map<string, Promise<unknown>>;
};

function getLimiterState() {
  const scope = globalThis as typeof globalThis & { [LIMITER_REGISTRY_KEY]?: LimiterState };
  if (!scope[LIMITER_REGISTRY_KEY]) {
    scope[LIMITER_REGISTRY_KEY] = {
      maxConcurrentPerUser: DEFAULT_MAX_CONCURRENT_BOT_RUNS_PER_USER,
      activeByUser: new Map(),
      slotWaitersByUser: new Map(),
      serialQueues: new Map()
    };
  }
  return scope[LIMITER_REGISTRY_KEY];
}

export function configureBotRunLimits(input: { maxConcurrentPerUser?: number } = {}) {
  const state = getLimiterState();
  if (input.maxConcurrentPerUser !== undefined) {
    state.maxConcurrentPerUser = Math.max(1, Math.floor(input.maxConcurrentPerUser));
  }
}

export function tryAcquireBotUserSlot(userId: string): boolean {
  const state = getLimiterState();
  const active = state.activeByUser.get(userId) ?? 0;
  if (active >= state.maxConcurrentPerUser) {
    return false;
  }
  state.activeByUser.set(userId, active + 1);
  return true;
}

export function acquireBotUserSlot(userId: string, timeoutMs: number): Promise<boolean> {
  if (tryAcquireBotUserSlot(userId)) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const state = getLimiterState();
    let waiters = state.slotWaitersByUser.get(userId);
    if (!waiters) {
      waiters = new Set();
      state.slotWaitersByUser.set(userId, waiters);
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (acquired: boolean) => {
      if (timer) clearTimeout(timer);
      state.slotWaitersByUser.get(userId)?.delete(attempt);
      resolve(acquired);
    };
    const attempt = () => {
      if (tryAcquireBotUserSlot(userId)) {
        finish(true);
      }
    };

    waiters.add(attempt);
    timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
  });
}

export function releaseBotUserSlot(userId: string) {
  const state = getLimiterState();
  const active = state.activeByUser.get(userId) ?? 0;
  if (active <= 1) {
    state.activeByUser.delete(userId);
  } else {
    state.activeByUser.set(userId, active - 1);
  }

  const waiters = state.slotWaitersByUser.get(userId);
  if (!waiters) return;
  for (const attempt of [...waiters]) {
    attempt();
  }
  if (waiters.size === 0) {
    state.slotWaitersByUser.delete(userId);
  }
}

export function getBotRunLimiterSnapshot() {
  const state = getLimiterState();
  return {
    maxConcurrentPerUser: state.maxConcurrentPerUser,
    activeByUser: Object.fromEntries(state.activeByUser),
    queuedKeys: [...state.serialQueues.keys()]
  };
}

export async function enqueueSerialTask<T>(key: string, task: () => Promise<T>): Promise<T> {
  const state = getLimiterState();
  const previous = state.serialQueues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const tracked = run.finally(() => {
    if (state.serialQueues.get(key) === trackedTail) {
      state.serialQueues.delete(key);
    }
  });
  const trackedTail = tracked.catch(() => {});
  state.serialQueues.set(key, trackedTail);
  return tracked;
}

export function resetBotRunLimiter() {
  const state = getLimiterState();
  state.activeByUser.clear();
  state.slotWaitersByUser.clear();
  state.serialQueues.clear();
}
