"use client";

import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  variant = "danger"
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  variant?: "danger" | "default";
}) {
  const icon = variant === "danger" ? (
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-red-500/20 bg-red-500/10">
      <Trash2 className="h-[18px] w-[18px] text-red-400" />
    </div>
  ) : undefined;
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      icon={icon}
      footer={
        <>
          <Button type="button" variant="ghost" autoFocus className="px-4 py-2 text-xs" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant={variant === "danger" ? "destructive" : "default"} className="px-4 py-2 text-xs" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
