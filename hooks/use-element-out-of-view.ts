"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";

export function useElementOutOfView<T extends HTMLElement>(ref: RefObject<T | null>, enabled: boolean) {
  const [outOfView, setOutOfView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === "undefined") {
      setOutOfView(false);
      return;
    }

    const scroller = element.closest(".conversation-scroller");
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setOutOfView(!entry.isIntersecting);
      },
      {
        root: scroller instanceof HTMLElement ? scroller : null,
        threshold: 0
      }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, ref]);

  return outOfView;
}
