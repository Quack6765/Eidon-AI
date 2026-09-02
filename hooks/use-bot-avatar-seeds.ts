"use client";

import { useEffect, useState } from "react";

import { addGlobalWsListener } from "@/lib/ws-client";
import type { BotSummary } from "@/lib/types";

const seedByName = new Map<string, string>();
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function normalizeBotName(name: string) {
  return name.trim().toLowerCase();
}

function ingestBots(bots: BotSummary[]) {
  let changed = false;

  bots.forEach((bot) => {
    const key = normalizeBotName(bot.name);

    if (key && seedByName.get(key) !== bot.avatarSeed) {
      seedByName.set(key, bot.avatarSeed);
      changed = true;
    }
  });

  return changed;
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function loadBotSeeds() {
  if (inflight) {
    return;
  }

  inflight = fetch("/api/bots")
    .then(async (response) =>
      response.ok ? ((await response.json()) as { bots?: BotSummary[] }) : null
    )
    .then((payload) => {
      if (payload && Array.isArray(payload.bots) && ingestBots(payload.bots)) {
        notifyListeners();
      }
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
}

export function lookupBotAvatarSeed(botName: string) {
  return seedByName.get(normalizeBotName(botName)) ?? null;
}

export function useBotAvatarSeed(botName: string) {
  const [seed, setSeed] = useState(() => lookupBotAvatarSeed(botName));

  useEffect(() => {
    loadBotSeeds();
    setSeed(lookupBotAvatarSeed(botName));

    const sync = () => setSeed(lookupBotAvatarSeed(botName));
    listeners.add(sync);

    const unsubscribe = addGlobalWsListener((msg) => {
      if (msg.type === "bot_updated" && ingestBots([msg.bot])) {
        notifyListeners();
      }
    });

    return () => {
      listeners.delete(sync);
      unsubscribe();
    };
  }, [botName]);

  return seed;
}
