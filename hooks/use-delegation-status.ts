"use client";

import { useEffect, useState } from "react";

import { addGlobalWsListener } from "@/lib/ws-client";
import type { ServerMessage } from "@/lib/ws-protocol";
import type { BotRun, BotSummary, TurnActivity } from "@/lib/types";

export type DelegationStatus = {
  run: BotRun;
  activity: TurnActivity | null;
};

const botsById = new Map<string, BotSummary>();
const runsById = new Map<string, BotRun>();
const activityByConversationId = new Map<string, TurnActivity>();
const listeners = new Set<() => void>();
let loaded = false;
let inflight: Promise<void> | null = null;

function normalizeBotName(name: string) {
  return name.trim().toLowerCase();
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function ingestBotsPayload(payload: {
  bots?: BotSummary[];
  runs?: BotRun[];
  activities?: Record<string, TurnActivity>;
}) {
  payload.bots?.forEach((bot) => botsById.set(bot.id, bot));
  payload.runs?.forEach((run) => runsById.set(run.id, run));
  if (payload.activities) {
    Object.entries(payload.activities).forEach(([conversationId, activity]) => {
      activityByConversationId.set(conversationId, activity);
    });
  }
  loaded = true;
  notifyListeners();
}

export function applyDelegationWsMessage(msg: ServerMessage) {
  if (msg.type === "bot_updated") {
    botsById.set(msg.bot.id, msg.bot);
  } else if (msg.type === "bot_run_updated") {
    runsById.set(msg.run.id, msg.run);
  } else if (msg.type === "bot_activity") {
    if (msg.activity) {
      activityByConversationId.set(msg.conversationId, msg.activity);
    } else {
      activityByConversationId.delete(msg.conversationId);
    }
  } else {
    return;
  }
  notifyListeners();
}

function loadDelegationStatus() {
  if (loaded || inflight) {
    return;
  }

  inflight = fetch("/api/bots")
    .then(async (response) =>
      response.ok
        ? ((await response.json()) as { bots?: BotSummary[]; runs?: BotRun[]; activities?: Record<string, TurnActivity> })
        : null
    )
    .then((payload) => {
      if (payload) ingestBotsPayload(payload);
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
}

export function resolveDelegationStatus(messageId: string, botName: string): DelegationStatus | null {
  const key = normalizeBotName(botName);
  const bot = [...botsById.values()].find((candidate) => normalizeBotName(candidate.name) === key);
  if (!bot) return null;

  let run: BotRun | null = null;
  for (const candidate of runsById.values()) {
    if (candidate.parentMessageId !== messageId || candidate.botId !== bot.id) continue;
    if (!run || candidate.createdAt > run.createdAt) run = candidate;
  }
  if (!run) return null;

  return { run, activity: activityByConversationId.get(bot.homeConversationId) ?? null };
}

export function useDelegationStatus(messageId: string, botName: string, enabled: boolean) {
  const [status, setStatus] = useState<DelegationStatus | null>(() =>
    enabled ? resolveDelegationStatus(messageId, botName) : null
  );

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }

    loadDelegationStatus();
    const sync = () => setStatus(resolveDelegationStatus(messageId, botName));
    sync();
    listeners.add(sync);
    const unsubscribe = addGlobalWsListener(applyDelegationWsMessage);

    return () => {
      listeners.delete(sync);
      unsubscribe();
    };
  }, [messageId, botName, enabled]);

  return status;
}

export function useTicker(intervalMs: number, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const handle = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(handle);
  }, [intervalMs, enabled]);

  return now;
}

export function formatElapsedMinutes(fromIso: string, now: number) {
  const minutes = Math.floor(Math.max(0, now - Date.parse(fromIso)) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function describeDelegationStatus(status: DelegationStatus | null, now: number) {
  if (!status) return null;
  const { run, activity } = status;
  if (run.status === "queued") {
    return { text: "queued", stalled: false };
  }
  if (run.status !== "running") {
    return null;
  }
  const since = activity?.startedAt ?? run.startedAt ?? run.createdAt;
  const parts = [`working ${formatElapsedMinutes(since, now)}`];
  if (activity?.currentAction) parts.push(activity.currentAction);
  if (activity?.stalled) parts.push(`no activity for ${formatElapsedMinutes(activity.lastActivityAt, now)}`);
  return { text: parts.join(" · "), stalled: Boolean(activity?.stalled) };
}

export function resetDelegationStatusForTests() {
  botsById.clear();
  runsById.clear();
  activityByConversationId.clear();
  loaded = false;
  inflight = null;
}
