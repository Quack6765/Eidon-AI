"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  Settings,
  Sparkles,
  Server,
  Zap,
  Shield,
  Users,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/settings/general", label: "General", icon: Settings },
  { href: "/settings/providers", label: "Providers", icon: Sparkles },
  { href: "/settings/personas", label: "Personas", icon: Users },
  { href: "/settings/memories", label: "Memories", icon: Brain },
  { href: "/settings/mcp-servers", label: "MCP Servers", icon: Server },
  { href: "/settings/skills", label: "Skills", icon: Zap },
  { href: "/settings/account", label: "Account", icon: Shield },
] as const;

export function SettingsNav({ onCloseAction }: { onCloseAction: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
        <Link
          href="/"
          onClick={(event) => {
            if (
              !event.defaultPrevented &&
              !event.metaKey &&
              !event.ctrlKey &&
              event.button === 0
            ) {
              event.preventDefault();
              onCloseAction();
              router.push("/");
            }
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors duration-200"
          aria-label="Back to chat"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-white/60" />
        </Link>
        <span className="text-sm font-semibold text-[var(--text)]">
          Settings
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => {
                if (
                  !event.defaultPrevented &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  event.button === 0
                ) {
                  event.preventDefault();
                  router.push(item.href);
                }
              }}
              className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 transition-all duration-200 ${
                isActive
                  ? "bg-[rgba(139,92,246,0.10)] border border-[rgba(139,92,246,0.25)]"
                  : "border border-transparent text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--text)]"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${
                  isActive ? "text-[#8b5cf6]" : "text-[#71717a]"
                }`}
              />
              <span
                className={`text-[13px] ${
                  isActive
                    ? "text-[var(--text)] font-medium"
                    : ""
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
