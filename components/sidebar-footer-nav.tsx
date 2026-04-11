"use client";

import Link from "next/link";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Clock3, Settings } from "lucide-react";

const baseLinkClassName =
  "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm text-white/30 transition-all duration-300 hover:bg-white/[0.03] hover:text-white/60";

type SidebarFooterNavProps = {
  onNavigateAction: (href: string) => void | Promise<void>;
};

function interceptNavigation(
  event: ReactMouseEvent<HTMLAnchorElement>,
  href: string,
  onNavigateAction: SidebarFooterNavProps["onNavigateAction"]
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  event.preventDefault();
  void onNavigateAction(href);
}

export function SidebarFooterNav({ onNavigateAction }: SidebarFooterNavProps) {
  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-white/5 pt-6">
      <Link
        href="/automations"
        aria-label="Open automations"
        className={baseLinkClassName}
        onClick={(event) => interceptNavigation(event, "/automations", onNavigateAction)}
      >
        <Clock3 className="h-4.5 w-4.5 opacity-60" />
        <span className="font-medium">Automations</span>
      </Link>

      <Link
        href="/settings"
        aria-label="Open settings"
        className={baseLinkClassName}
        onClick={(event) => interceptNavigation(event, "/settings", onNavigateAction)}
      >
        <Settings className="h-4.5 w-4.5 opacity-60" />
        <span className="font-medium">Settings</span>
      </Link>
    </div>
  );
}
