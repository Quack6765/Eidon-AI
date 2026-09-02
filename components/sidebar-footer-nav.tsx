"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Bot, Clock3, MessageSquare, Settings } from "lucide-react";
import { isUnmodifiedPrimaryClick } from "@/lib/navigation";

const baseLinkClassName =
  "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm text-white/70 transition-all duration-300 hover:bg-white/[0.03] hover:text-white/90";

export type SidebarView = "chat" | "agents" | "automations";

type SidebarFooterNavProps = {
  currentView: SidebarView;
  onNavigateAction: (href: string) => void | Promise<void>;
};

const FOOTER_LINKS: Array<{
  href: string;
  label: string;
  icon: typeof Settings;
  view?: SidebarView;
}> = [
  { href: "/chat", label: "Chat", icon: MessageSquare, view: "chat" },
  { href: "/agents", label: "Agents", icon: Bot, view: "agents" },
  { href: "/automations", label: "Automations", icon: Clock3, view: "automations" },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function SidebarFooterNav({ currentView, onNavigateAction }: SidebarFooterNavProps) {
  const pathname = usePathname();

  function interceptNavigation(event: ReactMouseEvent<HTMLAnchorElement>, href: string) {
    if (!isUnmodifiedPrimaryClick(event)) return;

    event.preventDefault();
    if (href === "/settings" && !pathname.startsWith("/settings")) {
      sessionStorage.setItem("eidon:settings:origin", pathname);
    }
    void onNavigateAction(href);
  }

  return (
    <div className="flex flex-col gap-0.5 pt-2 pb-1">
      {FOOTER_LINKS.filter((link) => link.view !== currentView).map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-label={`Open ${link.label.toLowerCase()}`}
          className={baseLinkClassName}
          onClick={(event) => interceptNavigation(event, link.href)}
        >
          <link.icon className="h-4.5 w-4.5 opacity-60" />
          <span className="font-medium">{link.label}</span>
        </Link>
      ))}
    </div>
  );
}
