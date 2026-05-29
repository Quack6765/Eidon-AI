type GuardCallback = {
  isDirty: () => boolean;
  save: () => void;
  discard: () => void;
  entityType: string;
};

let currentGuard: GuardCallback | null = null;

export function registerUnsavedChangesGuard(guard: GuardCallback | null) {
  currentGuard = guard;
}

export function getUnsavedChangesGuard() {
  return currentGuard;
}
