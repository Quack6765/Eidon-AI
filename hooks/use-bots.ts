"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { addGlobalWsListener } from "@/lib/ws-client";
import type { BotRun, BotSummary } from "@/lib/types";

export type BotLimits = { maxBots: number };

export type BotsPayload = {
  bots: BotSummary[];
  runs: BotRun[];
  limits: BotLimits;
};

function upsertBot(current: BotSummary[], bot: BotSummary) {
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
  const refreshTimerRef = useRef<number | null>(null);

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
    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) {
        return;
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void refresh();
      }, 250);
    };

    return addGlobalWsListener((msg) => {
      if (msg.type === "bot_updated") {
        setBots((current) => upsertBot(current, msg.bot));
        scheduleRefresh();
        return;
      }
      if (msg.type === "bot_deleted") {
        setBots((current) => current.filter((bot) => bot.id !== msg.botId));
        scheduleRefresh();
        return;
      }
      if (msg.type === "bot_run_updated") {
        scheduleRefresh();
      }
    });
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  return { bots, runs, limits, isLoading, refresh, setBots, setRuns };
}
