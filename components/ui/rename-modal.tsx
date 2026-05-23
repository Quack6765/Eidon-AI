"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type RenameModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSave: (newValue: string) => void;
  title: string;
  maxLength?: number;
};

export function RenameModal({
  open,
  onOpenChange,
  value,
  onSave,
  title,
  maxLength = 48,
}: RenameModalProps) {
  const titleId = useId();
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(value);
      requestAnimationFrame(() => {
        inputRef.current?.select();
      });
    }
  }, [open, value]);

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

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0;

  function handleSave() {
    if (!canSave) return;
    onSave(trimmed);
    onOpenChange(false);
  }

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
        <h3
          id={titleId}
          className="text-sm font-semibold text-[var(--text)] mb-4"
        >
          {title}
        </h3>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          maxLength={maxLength}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors"
          autoFocus
        />
        <div className="flex items-center justify-end gap-2 mt-4">
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="px-3 py-1.5 text-xs"
            onClick={handleSave}
            disabled={!canSave}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
