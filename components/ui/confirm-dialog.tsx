"use client";

import { type ReactNode, useEffect, useId } from "react";
import { Trash2 } from "lucide-react";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  variant?: "danger" | "default";
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  variant = "danger",
}: ConfirmDialogProps) {
  const titleId = useId();

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#121214] p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-red-500/10 border border-red-500/20">
            <Trash2 className="h-[18px] w-[18px] text-red-400" />
          </div>
          <h3
            id={titleId}
            className="text-sm font-semibold text-[var(--text)]"
          >
            {title}
          </h3>
        </div>
        <p className="text-sm text-[#71717a] leading-relaxed mb-5">
          {description}
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-xs text-[var(--muted)] rounded-xl hover:bg-white/5 transition-colors"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            className={
              variant === "danger"
                ? "px-3.5 py-1.5 text-xs font-medium text-red-300 rounded-xl bg-red-500/15 border border-red-500/25 hover:bg-red-500/25 transition-colors"
                : "px-3.5 py-1.5 text-xs font-medium text-[var(--text)] rounded-xl bg-[var(--accent)] hover:opacity-90 transition-colors"
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
