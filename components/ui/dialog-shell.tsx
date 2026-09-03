"use client";

import type { ReactNode } from "react";
import { Dialog } from "radix-ui";

import { cn } from "@/lib/utils";

export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  footer,
  size = "sm"
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "lg";
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="dialog-overlay"
          className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md"
          onClick={() => onOpenChange(false)}
        />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[81] flex max-h-[80vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-white/[0.08] bg-[#121214] p-6 shadow-2xl outline-none",
            size === "lg" ? "max-w-[720px]" : "max-w-sm"
          )}
        >
          <div className="mb-4 flex items-center gap-3">
            {icon}
            <Dialog.Title className="text-sm font-semibold text-[var(--text)]">
              {title}
            </Dialog.Title>
          </div>
          <Dialog.Description
            className={description
              ? "mb-5 text-sm leading-relaxed text-[#71717a]"
              : "sr-only"}
          >
            {description ?? `${title} dialog`}
          </Dialog.Description>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto">{children}</div> : null}
          {footer ? (
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
