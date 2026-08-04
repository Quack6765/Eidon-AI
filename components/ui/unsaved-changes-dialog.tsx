"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";

export function UnsavedChangesDialog({
  open,
  onOpenChange,
  entityType,
  onSave,
  onDiscard
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Unsaved changes"
      description={`You have unsaved changes to ${entityType}. Do you want to save before leaving?`}
      icon={
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-amber-500/20 bg-amber-500/10">
          <AlertTriangle className="h-[18px] w-[18px] text-amber-400" />
        </div>
      }
      footer={
        <>
          <Button type="button" variant="ghost" autoFocus className="px-4 py-2 text-xs" onClick={onDiscard}>
            Don&apos;t save
          </Button>
          <Button type="button" className="px-4 py-2 text-xs" onClick={onSave}>Save</Button>
        </>
      }
    />
  );
}
