"use client";

import { useEffect, useId } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type UnsavedChangesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  onSave: () => void;
  onDiscard: () => void;
};

export function UnsavedChangesDialog({
  open,
  onOpenChange,
  entityType,
  onSave,
  onDiscard,
}: UnsavedChangesDialogProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#121214] p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-[18px] w-[18px] text-amber-400" />
          </div>
          <h3
            id={titleId}
            className="text-sm font-semibold text-[var(--text)]"
          >
            Unsaved changes
          </h3>
        </div>
        <p id={descId} className="text-sm text-[#71717a] leading-relaxed mb-5">
          You have unsaved changes to {entityType}. Do you want to save before leaving?
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            autoFocus
            className="px-4 py-2 text-xs"
            onClick={onDiscard}
          >
            Don&apos;t save
          </Button>
          <Button
            type="button"
            className="px-4 py-2 text-xs"
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
