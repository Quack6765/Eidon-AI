import { useCallback, useMemo, useState } from "react";

export function useDirtyState<T extends Record<string, unknown>>(current: T) {
  const [snapshot, setSnapshot] = useState<string>(JSON.stringify(current));
  const currentJson = JSON.stringify(current);
  const isDirty = currentJson !== snapshot;

  const snapshotObj = useMemo<T>(() => JSON.parse(snapshot), [snapshot]);

  const isFieldDirty = useCallback(
    (key: keyof T) => {
      return JSON.stringify(current[key]) !== JSON.stringify(snapshotObj[key]);
    },
    [current, snapshotObj]
  );

  const reset = useCallback((next?: T) => {
    setSnapshot(next !== undefined ? JSON.stringify(next) : currentJson);
  }, [currentJson]);

  return { isDirty, isFieldDirty, reset };
}
