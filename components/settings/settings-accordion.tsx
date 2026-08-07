"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function SettingsAccordion({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      className="group overflow-hidden border-t border-white/[0.06] first:border-t-0"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-[58px] cursor-pointer list-none items-center gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--text)]">{title}</span>
          {description ? (
            <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{description}</span>
          ) : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-white/35 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="pb-6 pt-2">{children}</div>
    </details>
  );
}
