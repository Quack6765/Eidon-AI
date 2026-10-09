"use client";

import { useCallback, useEffect, useState } from "react";

import { upsertBotRun } from "@/components/agents/bot-runs";
import { addGlobalWsListener } from "@/lib/ws-client";
import type { BotRun, BotSummary } from "@/lib/types";

export type BotLimits = { maxBots: number };

const MAX_RECENT_RUNS = 20;

export type BotsPayload = {
  bots: BotSummary[];
  runs: BotRun[];
  limits: BotLimits;
};

export function upsertBot(current: BotSummary[], bot: BotSummary) {
  const index = current.findIndex((entry) => entry.id === bot.id);
  if (index === -1) {
    return [...current, bot];
  }
  const next = [...current];
  next[index] = bot;
  return next;
}

export function useBots(initial?: BotsPayload) {
  const [bots, setBots] = useState<BotSummary[]>(initial?.bots ?? []);
  const [runs, setRuns] = useState<BotRun[]>(initial?.runs ?? []);
  const [limits, setLimits] = useState<BotLimits>(initial?.limits ?? { maxBots: 20 });
  const [isLoading, setIsLoading] = useState(!initial);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/bots");
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as Partial<BotsPayload>;
      if (Array.isArray(payload.bots)) {
        setBots(payload.bots);
      }
      if (Array.isArray(payload.runs)) {
        setRuns(payload.runs);
      }
      if (payload.limits && typeof payload.limits.maxBots === "number") {
        setLimits({ maxBots: payload.limits.maxBots });
      }
    } catch {
      return;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initial) {
      return;
    }
    void refresh();
  }, [initial, refresh]);

  useEffect(() => {
    return addGlobalWsListener((msg) => {
      if (msg.type === "bot_updated") {
        setBots((current) => upsertBot(current, msg.bot));
        return;
      }
      if (msg.type === "bot_deleted") {
        setBots((current) => current.filter((bot) => bot.id !== msg.botId));
        setRuns((current) => current.filter((run) => run.botId !== msg.botId));
        return;
      }
      if (msg.type === "bot_run_updated") {
        setRuns((current) => upsertBotRun(current, msg.run, MAX_RECENT_RUNS));
      }
    }, { onReconnect: () => void refresh() });
  }, [refresh]);

  return { bots, runs, limits, isLoading, refresh, setBots, setRuns };
}
