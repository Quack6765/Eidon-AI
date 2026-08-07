"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { getUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";

export function useUnsavedChangesGate() {
  const [open, setOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const gate = useCallback((action: () => void) => {
    const guard = getUnsavedChangesGuard();
    if (guard && guard.isDirty()) {
      pendingActionRef.current = action;
      setOpen(true);
      return;
    }
    action();
  }, []);

  const handleSave = useCallback(async () => {
    const guard = getUnsavedChangesGuard();
    if (guard) {
      try {
        const saved = await guard.save();
        if (saved === false) {
          return;
        }
      } catch {
        return;
      }
    }
    setOpen(false);
    const next = pendingActionRef.current;
    pendingActionRef.current = null;
    next?.();
  }, []);

  const handleDiscard = useCallback(() => {
    const guard = getUnsavedChangesGuard();
    if (guard) {
      guard.discard();
    }
    setOpen(false);
    const next = pendingActionRef.current;
    pendingActionRef.current = null;
    next?.();
  }, []);

  const dialog: ReactNode =
    typeof document !== "undefined" ? (
      createPortal(
        <UnsavedChangesDialog
          open={open}
          onOpenChange={setOpen}
          entityType={getUnsavedChangesGuard()?.entityType ?? "your settings"}
          onSave={() => void handleSave()}
          onDiscard={handleDiscard}
        />,
        document.body
      )
    ) : null;

  return { gate, dialog };
}
