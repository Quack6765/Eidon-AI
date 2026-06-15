"use client";

import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

function matchMediaSupported(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function getInitialMobile(): boolean {
  if (!matchMediaSupported()) {
    return false;
  }
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(getInitialMobile);

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

  return isMobile;
}
