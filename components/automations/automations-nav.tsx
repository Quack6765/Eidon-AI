"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Bot, Clock3, PlayCircle } from "lucide-react";

import type { Automation } from "@/lib/types";

function statusLabel(automation: Automation) {
  if (automation.lastStatus === "running") {
    return "Running";
  }

  if (!automation.enabled) {
    return "Paused";
  }

  return automation.lastStatus ? automation.lastStatus : "Idle";
}

export function AutomationsNav({
  automations,
  onCloseAction
}: {
  automations: Automation[];
  onCloseAction: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col bg-transparent text-gray-300">
      <div className="flex flex-col px-4 py-6">
        <div className="mb-8 flex items-center gap-3 px-2">
          <Link
            href="/settings/automations"
            onClick={onCloseAction}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 transition-all duration-300 hover:bg-white/10"
            aria-label="Open automation settings"
          >
            <ArrowLeft className="h-4 w-4 text-white/60" />
          </Link>
          <div className="min-w-0">
            <span className="block text-[20px] font-bold tracking-tight text-white/90">
              Automations
            </span>
            <span className="block text-[11px] text-[#71717a]">
              Runs and history
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <Link
            href="/automations"
            onClick={onCloseAction}
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-300 ${
              pathname === "/automations"
                ? "bg-white/[0.05] font-semibold text-white"
                : "text-white/30 hover:bg-white/[0.03] hover:text-white/60"
            }`}
          >
            <Clock3 className="h-4.5 w-4.5" />
            <span className="truncate text-sm">Overview</span>
          </Link>

          {automations.map((automation) => {
            const isActive =
              pathname === `/automations/${automation.id}` ||
              pathname.startsWith(`/automations/${automation.id}/runs/`);

            return (
              <Link
                key={automation.id}
                href={`/automations/${automation.id}`}
                onClick={onCloseAction}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-300 ${
                  isActive
                    ? "bg-white/[0.05] font-semibold text-white"
                    : "text-white/30 hover:bg-white/[0.03] hover:text-white/60"
                }`}
              >
                <Bot className={`h-4.5 w-4.5 ${isActive ? "text-[var(--accent)]" : "opacity-40"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{automation.name}</div>
                  <div className="truncate text-[11px] text-[#71717a]">
                    {statusLabel(automation)}
                  </div>
                </div>
                {automation.lastStatus === "running" ? (
                  <PlayCircle className="ml-auto h-4 w-4 text-emerald-400" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
