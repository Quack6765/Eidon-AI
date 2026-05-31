"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";
const COLLAPSE_DELAY_MS = 150;

function matchMediaSupported(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function getInitialMobile(): boolean {
  if (!matchMediaSupported()) {
    return false;
  }
  return window.matchMedia(MOBILE_QUERY).matches;
}

type UseCollapsibleToolbarOptions = { enabled: boolean };

export function useCollapsibleToolbar({ enabled }: UseCollapsibleToolbarOptions) {
  const [isMobile, setIsMobile] = useState<boolean>(getInitialMobile);
  const [expanded, setExpanded] = useState(false);

  const isInputFocusedRef = useRef(false);
  const openControlCountRef = useRef(0);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!matchMediaSupported()) {
      return;
    }
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const cancelScheduledCollapse = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const scheduleCollapse = useCallback(() => {
    cancelScheduledCollapse();
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = null;
      if (!isInputFocusedRef.current && openControlCountRef.current === 0) {
        setExpanded(false);
      }
    }, COLLAPSE_DELAY_MS);
  }, [cancelScheduledCollapse]);

  const onFocus = useCallback(() => {
    isInputFocusedRef.current = true;
    cancelScheduledCollapse();
    setExpanded(true);
  }, [cancelScheduledCollapse]);

  const onBlur = useCallback(() => {
    isInputFocusedRef.current = false;
    scheduleCollapse();
  }, [scheduleCollapse]);

  const onControlOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        openControlCountRef.current += 1;
        cancelScheduledCollapse();
        setExpanded(true);
      } else {
        openControlCountRef.current = Math.max(0, openControlCountRef.current - 1);
        scheduleCollapse();
      }
    },
    [cancelScheduledCollapse, scheduleCollapse]
  );

  useEffect(() => () => cancelScheduledCollapse(), [cancelScheduledCollapse]);

  const showToolbar = !enabled || !isMobile || expanded;

  return {
    showToolbar,
    inputFocusProps: { onFocus, onBlur },
    onControlOpenChange
  };
}
