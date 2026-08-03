"use client";

import { useEffect, useRef } from "react";

import { registerUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";

export function useUnsavedChangesGuard(input: {
  isDirty: boolean;
  save: () => boolean | void | Promise<boolean | void>;
  discard: () => void;
  entityType: string;
}) {
  const actions = useRef({ save: input.save, discard: input.discard });
  actions.current = { save: input.save, discard: input.discard };

  useEffect(() => {
    registerUnsavedChangesGuard(input.isDirty ? {
      isDirty: () => input.isDirty,
      save: () => actions.current.save(),
      discard: () => actions.current.discard(),
      entityType: input.entityType
    } : null);
    return () => registerUnsavedChangesGuard(null);
  }, [input.entityType, input.isDirty]);
}
