type CanaryTranscriptionRegistry = {
  busyUsers: Set<string>;
  queuedCount: number;
  tail: Promise<void>;
};

const CANARY_TRANSCRIPTION_REGISTRY_KEY = Symbol.for("eidon.speech.canary-transcription-limiter");
const MAX_QUEUED_TRANSCRIPTIONS = 4;

export class CanaryTranscriptionBusyError extends Error {
  constructor(message = "Canary transcription is busy. Try again in a moment.") {
    super(message);
    this.name = "CanaryTranscriptionBusyError";
  }
}

function getRegistry() {
  const scope = globalThis as typeof globalThis & {
    [CANARY_TRANSCRIPTION_REGISTRY_KEY]?: CanaryTranscriptionRegistry;
  };

  if (!scope[CANARY_TRANSCRIPTION_REGISTRY_KEY]) {
    scope[CANARY_TRANSCRIPTION_REGISTRY_KEY] = {
      busyUsers: new Set(),
      queuedCount: 0,
      tail: Promise.resolve()
    };
  }

  return scope[CANARY_TRANSCRIPTION_REGISTRY_KEY];
}

export async function runCanaryTranscription<T>(input: {
  userId: string;
  execute: () => Promise<T>;
}) {
  const registry = getRegistry();
  if (registry.busyUsers.has(input.userId)) {
    throw new CanaryTranscriptionBusyError("Another Canary transcription is already running.");
  }
  if (registry.queuedCount >= MAX_QUEUED_TRANSCRIPTIONS) {
    throw new CanaryTranscriptionBusyError();
  }

  registry.busyUsers.add(input.userId);
  registry.queuedCount += 1;
  const previous = registry.tail;
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  registry.tail = previous.catch(() => {}).then(() => completion);

  await previous.catch(() => {});
  try {
    return await input.execute();
  } finally {
    registry.busyUsers.delete(input.userId);
    registry.queuedCount -= 1;
    release();
  }
}

export function resetCanaryTranscriptionLimiterForTests() {
  const scope = globalThis as typeof globalThis & {
    [CANARY_TRANSCRIPTION_REGISTRY_KEY]?: CanaryTranscriptionRegistry;
  };
  delete scope[CANARY_TRANSCRIPTION_REGISTRY_KEY];
}
