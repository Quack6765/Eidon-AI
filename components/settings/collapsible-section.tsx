"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-white/6 overflow-hidden"
    >
      <summary className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer bg-white/[0.01] hover:bg-white/[0.02] transition-colors select-none list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          {icon ? (
            <span className="text-[#71717a]">{icon}</span>
          ) : null}
          <span className="text-[0.82rem] font-medium text-[#a1a1aa]">{title}</span>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-[#52525b] transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 pt-2">
        {children}
      </div>
    </details>
  );
}
