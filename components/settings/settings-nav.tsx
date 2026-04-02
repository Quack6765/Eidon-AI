"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Settings, Sparkles, Server, Zap, Shield } from "lucide-react";

const NAV_ITEMS = [
  { href: "/settings/general", label: "General", icon: Settings, color: "bg-[#8b5cf6]", activeBg: "bg-[#8b5cf6]/15", activeBorder: "border-[#8b5cf6]/30" },
  { href: "/settings/providers", label: "Providers", icon: Sparkles, color: "bg-[#1e293b]", activeBg: "bg-[#1e293b]", activeBorder: "border-[#1e293b]" },
  { href: "/settings/mcp-servers", label: "MCP Servers", icon: Server, color: "bg-[#0ea5e9]", activeBg: "bg-[#0ea5e9]/15", activeBorder: "border-[#0ea5e9]/30" },
  { href: "/settings/skills", label: "Skills", icon: Zap, color: "bg-[#f59e0b]", activeBg: "bg-[#f59e0b]/15", activeBorder: "border-[#f59e0b]/30" },
  { href: "/settings/account", label: "Account", icon: Shield, color: "bg-[#38bdf8]", activeBg: "bg-[#38bdf8]/15", activeBorder: "border-[#38bdf8]/30" },
] as const;

export function SettingsNav({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
        <Link
          href="/"
          onClick={(event) => {
            if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && event.button === 0) {
              event.preventDefault();
              onClose();
            }
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors duration-200"
          aria-label="Back to chat"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-white/60" />
        </Link>
        <span className="text-sm font-semibold text-[var(--text)]">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => {
                if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && event.button === 0) {
                  event.preventDefault();
                  window.location.href = item.href;
                }
              }}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-all duration-200 ${
                isActive
                  ? `${item.activeBg} border ${item.activeBorder}`
                  : "text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--text)]"
              }`}
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.color}`}>
                <Icon className="h-4 w-4 text-white" />
              </div>
              <span className={`text-[13px] ${isActive ? "text-[var(--text)] font-medium" : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
