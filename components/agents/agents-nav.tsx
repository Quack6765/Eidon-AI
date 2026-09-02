"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Bot } from "lucide-react";

import { BotAvatar } from "@/components/agents/bot-avatar";
import { BotStatusDot, botStatusLabel } from "@/components/agents/bot-status";
import { addGlobalWsListener } from "@/lib/ws-client";
import type { BotSummary } from "@/lib/types";

function sortBots(bots: BotSummary[]) {
  return [...bots].sort((left, right) => {
    if (left.isChief !== right.isChief) {
      return left.isChief ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

export function AgentsNav({
  bots: initialBots,
  onCloseAction
}: {
  bots: BotSummary[];
  onCloseAction: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [bots, setBots] = useState(initialBots);

  useEffect(() => {
    setBots(initialBots);
  }, [initialBots]);

  useEffect(() => {
    let refreshTimer: number | null = null;

    const scheduleRefresh = () => {
      if (refreshTimer !== null) {
        return;
      }
      refreshTimer = window.setTimeout(async () => {
        refreshTimer = null;
        try {
          const response = await fetch("/api/bots");
          if (!response.ok) {
            return;
          }
          const payload = (await response.json()) as { bots?: BotSummary[] };
          if (Array.isArray(payload.bots)) {
            setBots(payload.bots);
          }
        } catch {
          return;
        }
      }, 300);
    };

    return addGlobalWsListener((msg) => {
      if (msg.type === "bot_updated") {
        setBots((current) => {
          const exists = current.some((bot) => bot.id === msg.bot.id);
          return exists ? current.map((bot) => (bot.id === msg.bot.id ? msg.bot : bot)) : [...current, msg.bot];
        });
        return;
      }
      if (msg.type === "bot_deleted") {
        setBots((current) => current.filter((bot) => bot.id !== msg.botId));
        return;
      }
      if (msg.type === "bot_run_updated") {
        scheduleRefresh();
      }
    });
  }, []);

  function handleBack() {
    onCloseAction();
    router.push("/");
  }

  return (
    <aside className="flex h-full flex-col bg-transparent text-gray-300">
      <div className="flex flex-col px-4 py-6">
        <div className="mb-8 flex items-center gap-3 px-2">
          <button
            type="button"
            onClick={handleBack}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 transition-all duration-300 hover:bg-white/10"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="h-4 w-4 text-white/60" />
          </button>
          <div className="min-w-0">
            <span className="block text-[20px] font-bold tracking-tight text-white/90">
              Agents
            </span>
            <span className="block text-[11px] text-[#71717a]">
              Bots and delegation
            </span>
          </div>
        </div>

        <div className="space-y-1 overflow-y-auto scrollbar-thin">
          <Link
            href="/agents"
            onClick={onCloseAction}
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-300 ${
              pathname === "/agents"
                ? "bg-white/[0.05] font-semibold text-white"
                : "text-white/30 hover:bg-white/[0.03] hover:text-white/60"
            }`}
          >
            <Bot className="h-4.5 w-4.5" />
            <span className="truncate text-sm">Roster</span>
          </Link>

          {sortBots(bots).map((bot) => {
            const isActive = pathname === `/agents/${bot.id}`;

            return (
              <Link
                key={bot.id}
                href={`/agents/${bot.id}`}
                onClick={onCloseAction}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-300 ${
                  isActive
                    ? "bg-white/[0.05] font-semibold text-white"
                    : "text-white/30 hover:bg-white/[0.03] hover:text-white/60"
                }`}
              >
                <BotAvatar seed={bot.avatarSeed} size={24} className="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{bot.name}</div>
                  {bot.status === "queued" ? (
                    <div className="truncate text-[11px] text-[#71717a]">
                      {botStatusLabel(bot.status)}
                    </div>
                  ) : null}
                </div>
                <BotStatusDot status={bot.status} />
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
