"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";

export function RenameModal({
  open,
  onOpenChange,
  value,
  onSave,
  title,
  maxLength = 48
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSave: (newValue: string) => void;
  title: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [open, value]);
  const trimmed = draft.trim();
  const save = () => {
    if (!trimmed) return;
    onSave(trimmed);
    onOpenChange(false);
  };
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="px-3 py-1.5 text-xs" onClick={save} disabled={!trimmed}>Save</Button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") save(); }}
        maxLength={maxLength}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)]"
        autoFocus
      />
    </DialogShell>
  );
}
