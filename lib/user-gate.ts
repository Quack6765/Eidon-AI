const PENDING_USER_GATES_KEY = Symbol.for("eidon:pending-user-gates");

type PendingUserGate = { settle: (value: unknown) => void };

function getPendingUserGates() {
  const registry = globalThis as Record<symbol, Map<string, PendingUserGate> | undefined>;
  registry[PENDING_USER_GATES_KEY] ??= new Map<string, PendingUserGate>();
  return registry[PENDING_USER_GATES_KEY];
}

export function settleUserGate(actionId: string, value: unknown) {
  const gates = getPendingUserGates();
  const gate = gates.get(actionId);
  if (!gate) {
    return false;
  }

  gates.delete(actionId);
  gate.settle(value);
  return true;
}

export function waitForUserGate<T>(
  actionId: string,
  options: {
    timeoutMs: number;
    abortSignal?: AbortSignal;
    readRecorded: () => T | null;
    onExpire: () => T;
    onStop: () => T;
  }
) {
  return new Promise<T>((resolve) => {
    let settled = false;

    const finish = (outcome: T) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.abortSignal?.removeEventListener("abort", handleAbort);
      getPendingUserGates().delete(actionId);
      resolve(outcome);
    };

    const adoptRecorded = () => {
      const recorded = options.readRecorded();
      if (recorded === null) {
        return false;
      }
      finish(recorded);
      return true;
    };

    const timer = setTimeout(() => {
      getPendingUserGates().delete(actionId);
      if (!adoptRecorded()) {
        finish(options.onExpire());
      }
    }, options.timeoutMs);
    timer.unref?.();

    function handleAbort() {
      getPendingUserGates().delete(actionId);
      if (!adoptRecorded()) {
        finish(options.onStop());
      }
    }

    options.abortSignal?.addEventListener("abort", handleAbort, { once: true });
    getPendingUserGates().set(actionId, { settle: (value) => finish(value as T) });

    if (!adoptRecorded() && options.abortSignal?.aborted) {
      handleAbort();
    }
  });
}
