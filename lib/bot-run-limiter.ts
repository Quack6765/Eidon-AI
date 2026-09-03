const LIMITER_REGISTRY_KEY = Symbol.for("eidon.bot.run.limiter");

export const DEFAULT_MAX_CONCURRENT_BOT_RUNS_PER_USER = 4;
export const DEFAULT_BOT_RUN_TIMEOUT_MS = 30 * 60_000;

type LimiterState = {
  maxConcurrentPerUser: number;
  activeByUser: Map<string, number>;
  botQueues: Map<string, Promise<unknown>>;
};

function getLimiterState() {
  const scope = globalThis as typeof globalThis & { [LIMITER_REGISTRY_KEY]?: LimiterState };
  if (!scope[LIMITER_REGISTRY_KEY]) {
    scope[LIMITER_REGISTRY_KEY] = {
      maxConcurrentPerUser: DEFAULT_MAX_CONCURRENT_BOT_RUNS_PER_USER,
      activeByUser: new Map(),
      botQueues: new Map()
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

export function releaseBotUserSlot(userId: string) {
  const state = getLimiterState();
  const active = state.activeByUser.get(userId) ?? 0;
  if (active <= 1) {
    state.activeByUser.delete(userId);
  } else {
    state.activeByUser.set(userId, active - 1);
  }
}

export function getBotRunLimiterSnapshot() {
  const state = getLimiterState();
  return {
    maxConcurrentPerUser: state.maxConcurrentPerUser,
    activeByUser: Object.fromEntries(state.activeByUser),
    queuedBots: [...state.botQueues.keys()]
  };
}

export async function enqueueBotTask<T>(botId: string, task: () => Promise<T>): Promise<T> {
  const state = getLimiterState();
  const previous = state.botQueues.get(botId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const tracked = run.finally(() => {
    if (state.botQueues.get(botId) === trackedTail) {
      state.botQueues.delete(botId);
    }
  });
  const trackedTail = tracked.catch(() => {});
  state.botQueues.set(botId, trackedTail);
  return tracked;
}

export function resetBotRunLimiter() {
  const state = getLimiterState();
  state.activeByUser.clear();
  state.botQueues.clear();
}
