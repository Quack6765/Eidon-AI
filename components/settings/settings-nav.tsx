"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  ChevronRight,
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
import { isUnmodifiedPrimaryClick } from "@/lib/navigation";
import type { AuthUser } from "@/lib/types";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

const ACCOUNT_ITEMS = [
  { href: "/settings/account", label: "Account", icon: Shield }
] as const;

const ASSISTANT_ITEMS = [
  { href: "/settings/general", label: "General", icon: Settings },
  { href: "/settings/providers", label: "Providers", icon: Sparkles, adminOnly: true },
  { href: "/settings/personas", label: "Personas", icon: Users },
  { href: "/settings/memories", label: "Memories", icon: Brain }
] as const;

const CAPABILITY_ITEMS = [
  { href: "/settings/mcp-servers", label: "MCP Servers", icon: Server },
  { href: "/settings/skills", label: "Skills", icon: Zap }
] as const;

const AUTOMATION_ITEMS = [
  { href: "/settings/automations", label: "Scheduled automations", icon: Clock3 }
] as const;

const ADMINISTRATION_ITEMS = [
  { href: "/settings/users", label: "Users", icon: Users }
] as const;

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
    <div className="space-y-1.5">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
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
              className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 md:min-h-11 ${
                isActive
                  ? "border-[var(--accent)]/20 bg-[var(--accent)]/12 font-semibold text-white"
                  : "border-transparent text-white/60 hover:border-white/[0.04] hover:bg-white/[0.035] hover:text-white/90"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon
                className={`h-4.5 w-4.5 ${
                  isActive ? "text-[var(--accent)]" : "opacity-40"
                }`}
              />
              <span className="text-sm font-medium">
                {item.label}
              </span>
              <ChevronRight className="ml-auto h-4 w-4 text-white/25 md:hidden" />
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
    if (isUnmodifiedPrimaryClick(event)) {
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

  async function handleUnsavedSave() {
    const guard = getUnsavedChangesGuard();
    if (guard) {
      try {
        const saved = await guard.save();
        if (saved === false) return;
      } catch {
        return;
      }
    }
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

  const assistantItems = ASSISTANT_ITEMS.filter(
    (item) => !("adminOnly" in item) || currentUser.role === "admin"
  );

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
    <aside className="flex h-full flex-col bg-[#0f0f0f] text-gray-300">
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 md:py-6">
        <div className="mb-6 flex min-h-11 items-center gap-3 px-1 md:mb-7">
          <Link
            href="/"
            onClick={(event) => navigateWithGuard("/", event)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.035] transition-colors duration-200 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 md:h-10 md:w-10"
            aria-label="Back to chat"
          >
            <ArrowLeft className="h-4 w-4 text-white/60" />
          </Link>
          <span className="text-lg font-semibold tracking-tight text-white/90">
            Settings
          </span>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <NavSection
            title="Personal"
            items={ACCOUNT_ITEMS}
            pathname={pathname}
            onNavigate={navigateWithGuard}
          />

          <NavSection
            title="Assistant"
            items={assistantItems}
            pathname={pathname}
            onNavigate={navigateWithGuard}
          />

          {currentUser.role === "admin" ? (
            <NavSection
              title="Capabilities"
              items={CAPABILITY_ITEMS}
              pathname={pathname}
              onNavigate={navigateWithGuard}
            />
          ) : null}

          <NavSection
            title="Automation"
            items={AUTOMATION_ITEMS}
            pathname={pathname}
            onNavigate={navigateWithGuard}
          />

          {currentUser.role === "admin" && passwordLoginEnabled ? (
            <NavSection
              title="Administration"
              items={ADMINISTRATION_ITEMS}
              pathname={pathname}
              onNavigate={navigateWithGuard}
            />
          ) : null}
        </div>

        <div className="mt-auto pt-5">
          <div className="border-t border-white/[0.06] pt-4">
            <p className="text-sm font-medium text-[var(--text)]">
              {currentUser.username}
            </p>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleLogout()}
              disabled={isSigningOut}
              className="mt-3 min-h-11 px-4 text-sm md:min-h-10"
            >
              <LogOut className="h-3 w-3" />
              Sign out
            </Button>
            <p className="mt-2.5 text-[11px] font-medium text-white/45 tracking-[0.04em] tabular-nums">
              {appVersion}
            </p>
          </div>
        </div>
      </div>
      {typeof document !== "undefined" && createPortal(
        <UnsavedChangesDialog
          open={unsavedDialogOpen}
          onOpenChange={setUnsavedDialogOpen}
          entityType={getUnsavedChangesGuard()?.entityType ?? "your settings"}
          onSave={() => void handleUnsavedSave()}
          onDiscard={handleUnsavedDiscard}
        />,
        document.body
      )}
    </aside>
  );
}
