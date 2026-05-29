import { useCallback, useState } from "react";

export function useDirtyState<T>(current: T) {
  const [snapshot, setSnapshot] = useState<string>(JSON.stringify(current));
  const currentJson = JSON.stringify(current);
  const isDirty = currentJson !== snapshot;

  const reset = useCallback((next?: T) => {
    setSnapshot(next !== undefined ? JSON.stringify(next) : currentJson);
  }, [currentJson]);

  return { isDirty, reset };
}
