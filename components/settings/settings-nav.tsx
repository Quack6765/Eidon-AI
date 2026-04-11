"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  Clock3,
  Settings,
  Sparkles,
  Server,
  Zap,
  Shield,
  LogOut,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/lib/types";

const PERSONAL_ITEMS = [
  { href: "/settings/general", label: "General", icon: Settings },
  { href: "/settings/personas", label: "Personas", icon: Users },
  { href: "/settings/automations", label: "Scheduled automations", icon: Clock3 },
  { href: "/settings/memories", label: "Memories", icon: Brain },
  { href: "/settings/account", label: "Account", icon: Shield }
] as const;

const SERVER_ITEMS = [
  { href: "/settings/providers", label: "Providers", icon: Sparkles },
  { href: "/settings/mcp-servers", label: "MCP Servers", icon: Server },
  { href: "/settings/skills", label: "Skills", icon: Zap }
] as const;

const USER_MANAGEMENT_ITEM = { href: "/settings/users", label: "Users", icon: Users } as const;

function NavSection({
  title,
  items,
  pathname,
  onCloseAction
}: {
  title: string;
  items: ReadonlyArray<{ href: string; label: string; icon: typeof Settings }>;
  pathname: string;
  onCloseAction: () => void;
}) {
  const router = useRouter();

  return (
    <div className="space-y-2">
      <p className="px-4 text-[10px] font-semibold uppercase tracking-[0.28em] text-white/30">
        {title}
      </p>
      <div className="space-y-1">
        {items.map((item) => {
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
                  onCloseAction();
                  router.push(item.href);
                }
              }}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-300 ${
                isActive
                  ? "bg-white/[0.05] text-white font-semibold"
                  : "text-white/45 hover:bg-white/[0.03] hover:text-white/80"
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
  );
}

export function SettingsNav({
  currentUser,
  passwordLoginEnabled,
  onCloseAction
}: {
  currentUser: AuthUser;
  passwordLoginEnabled: boolean;
  onCloseAction: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const serverItems =
    currentUser.role !== "admin"
      ? []
      : passwordLoginEnabled
        ? [...SERVER_ITEMS, USER_MANAGEMENT_ITEM]
        : [...SERVER_ITEMS];

  async function handleLogout() {
    if (isSigningOut) {
      return;
    }

    try {
      setIsSigningOut(true);
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

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

        <div className="flex-1 space-y-6">
          <NavSection
            title="Workspace"
            items={PERSONAL_ITEMS}
            pathname={pathname}
            onCloseAction={onCloseAction}
          />

          {serverItems.length > 0 ? (
            <NavSection
              title="Server"
              items={serverItems}
              pathname={pathname}
              onCloseAction={onCloseAction}
            />
          ) : null}
        </div>

        <div className="mt-8 rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/30">
            Signed in
          </p>
          <p className="mt-2 text-sm font-medium text-white/85">
            {currentUser.username}
          </p>
          <p className="mt-1 text-xs text-white/45">
            {currentUser.role === "admin" ? "Administrator access" : "Private workspace"}
          </p>
          <Button
            type="button"
            variant="danger"
            onClick={() => void handleLogout()}
            disabled={isSigningOut}
            className="mt-4 w-full gap-2 rounded-2xl border-red-400/15 bg-red-500/[0.07] px-3 py-2.5 text-sm text-red-100 hover:bg-red-500/[0.12]"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </div>
    </aside>
  );
}
