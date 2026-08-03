"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function TextEditModal({
  open,
  onOpenChange,
  value,
  onChange,
  title,
  subtitle,
  placeholder,
  readOnly
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  title: string;
  subtitle?: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);
  const done = () => {
    onChange(draft);
    onOpenChange(false);
  };
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={subtitle}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="px-3 py-1.5 text-xs" onClick={done} disabled={readOnly}>Done</Button>
        </>
      }
    >
      <Textarea
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={16}
        placeholder={placeholder}
        readOnly={readOnly}
        className={cn("min-h-[300px] flex-1 resize-none", readOnly && "cursor-default opacity-60")}
      />
    </DialogShell>
  );
}
