"use client";

import { useEffect, useState } from "react";

import { assertSafeInlineSvg, buildAnimatedBotAvatarUrl } from "@/lib/bot-avatar";

const markupBySeed = new Map<string, string>();
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<void>>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function loadBotAvatarMarkup(seed: string) {
  const cached = markupBySeed.get(seed);
  if (cached) {
    return;
  }

  const existing = inflight.get(seed);
  if (existing) {
    return;
  }

  const request = fetch(buildAnimatedBotAvatarUrl(seed))
    .then(async (response) => (response.ok ? await response.text() : null))
    .then((body) => {
      const safe = assertSafeInlineSvg(body);
      if (safe) {
        markupBySeed.set(seed, safe);
        notifyListeners();
      }
    })
    .catch(() => {})
    .finally(() => {
      inflight.delete(seed);
    });

  inflight.set(seed, request);
}

export function useBotAvatarMarkup(seed: string | null) {
  const [markup, setMarkup] = useState(() => (seed ? markupBySeed.get(seed) ?? null : null));

  useEffect(() => {
    if (!seed) {
      return;
    }

    loadBotAvatarMarkup(seed);
    setMarkup(markupBySeed.get(seed) ?? null);

    const sync = () => setMarkup(markupBySeed.get(seed) ?? null);
    listeners.add(sync);

    return () => {
      listeners.delete(sync);
    };
  }, [seed]);

  return markup;
}
