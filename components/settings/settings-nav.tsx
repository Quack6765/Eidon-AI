"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
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
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { getUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";
import type { AuthUser } from "@/lib/types";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

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
  onNavigate,
}: {
  title: string;
  items: ReadonlyArray<{ href: string; label: string; icon: typeof Settings }>;
  pathname: string;
  onNavigate: (href: string, event: React.MouseEvent) => void;
}) {
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
              onClick={(event) => onNavigate(item.href, event)}
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
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingNavTarget, setPendingNavTarget] = useState<string | null>(null);

  function navigateWithGuard(href: string, event: React.MouseEvent) {
    if (
      !event.defaultPrevented &&
      !event.metaKey &&
      !event.ctrlKey &&
      event.button === 0
    ) {
      event.preventDefault();
      const guard = getUnsavedChangesGuard();
      if (guard && guard.isDirty()) {
        setPendingNavTarget(href);
        setUnsavedDialogOpen(true);
        return;
      }
      onCloseAction();
      router.push(href);
    }
  }

  function handleUnsavedSave() {
    const guard = getUnsavedChangesGuard();
    if (guard) guard.save();
    setUnsavedDialogOpen(false);
    if (pendingNavTarget) {
      onCloseAction();
      router.push(pendingNavTarget);
      setPendingNavTarget(null);
    }
  }

  function handleUnsavedDiscard() {
    const guard = getUnsavedChangesGuard();
    if (guard) guard.discard();
    setUnsavedDialogOpen(false);
    if (pendingNavTarget) {
      onCloseAction();
      router.push(pendingNavTarget);
      setPendingNavTarget(null);
    }
  }

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
            onClick={(event) => navigateWithGuard("/", event)}
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
            onNavigate={navigateWithGuard}
          />

          {serverItems.length > 0 ? (
            <NavSection
              title="Server"
              items={serverItems}
              pathname={pathname}
              onNavigate={navigateWithGuard}
            />
          ) : null}
        </div>

        <div className="mt-auto pt-6">
          <div className="border-t border-white/[0.06] pt-4">
            <p className="text-sm font-medium text-[var(--text)]">
              {currentUser.username}
            </p>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleLogout()}
              disabled={isSigningOut}
              className="mt-3 px-4 py-2 text-xs"
            >
              <LogOut className="h-3 w-3" />
              Sign out
            </Button>
            <p className="mt-2.5 text-[10px] font-medium text-white/30 tracking-[0.04em] tabular-nums">
              {appVersion}
            </p>
          </div>
        </div>
      </div>
      {createPortal(
        <UnsavedChangesDialog
          open={unsavedDialogOpen}
          onOpenChange={setUnsavedDialogOpen}
          entityType={getUnsavedChangesGuard()?.entityType ?? "your settings"}
          onSave={handleUnsavedSave}
          onDiscard={handleUnsavedDiscard}
        />,
        document.body
      )}
    </aside>
  );
}
