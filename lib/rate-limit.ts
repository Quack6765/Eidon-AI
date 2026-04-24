const attemptMap = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const CLEANUP_INTERVAL_MS = 300_000;

let lastCleanup = 0;

function cleanupStale() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of attemptMap) {
    if (now >= entry.resetAt) {
      attemptMap.delete(key);
    }
  }
}

export function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();

  cleanupStale();

  const entry = attemptMap.get(key);

  if (!entry || now >= entry.resetAt) {
    attemptMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1, resetAt: now + WINDOW_MS };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: MAX_ATTEMPTS - entry.count, resetAt: entry.resetAt };
}

export function resetRateLimits() {
  attemptMap.clear();
  lastCleanup = 0;
}
