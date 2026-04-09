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
    <aside className="flex h-full flex-col bg-transparent text-gray-300">
      <div className="flex flex-col px-4 py-6">
        <div className="flex items-center gap-3 mb-8 px-2">
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
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition-all duration-300"
            aria-label="Back to chat"
          >
            <ArrowLeft className="h-4 w-4 text-white/60" />
          </Link>
          <span className="text-[20px] font-bold tracking-tight text-white/90">
            Settings
          </span>
        </div>

        <div className="flex-1 space-y-1">
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
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-300 ${
                  isActive
                    ? "bg-white/[0.05] text-white font-semibold"
                    : "text-white/30 hover:bg-white/[0.03] hover:text-white/60"
                }`}
              >
                <Icon
                  className={`h-4.5 w-4.5 ${
                    isActive ? "text-[var(--accent)]" : "opacity-40"
                  }`}
                />
                <span className="text-sm font-medium">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
