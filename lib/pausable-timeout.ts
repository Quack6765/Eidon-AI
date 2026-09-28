export type PausableTimeout = {
  pause: () => void;
  resume: () => void;
  clear: () => void;
  remainingMs: () => number;
};

export function createPausableTimeout(callback: () => void, delayMs: number): PausableTimeout {
  let remaining = delayMs;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;

  const start = () => {
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = null;
      done = true;
      callback();
    }, remaining);
    timer.unref?.();
  };

  start();

  return {
    pause() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    },
    resume() {
      if (timer || done) return;
      start();
    },
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      done = true;
    },
    remainingMs() {
      if (done) return 0;
      return timer ? Math.max(0, remaining - (Date.now() - startedAt)) : remaining;
    }
  };
}
