"use client";

import { useEffect } from "react";

const IOS_PWA_CLASS = "ios-pwa";

function isIosStandalone(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (navigator as { standalone?: boolean }).standalone === true;
}

export function useIosPwa() {
  useEffect(() => {
    if (!isIosStandalone()) {
      return;
    }

    const root = document.documentElement;
    root.classList.add(IOS_PWA_CLASS);

    let frameHandle: number | null = null;
    let lastHeight = 0;

    const applyHeight = () => {
      frameHandle = null;
      const height = Math.round(window.innerHeight);
      if (height === lastHeight) {
        return;
      }
      lastHeight = height;
      root.style.setProperty("--ios-app-height", `${height}px`);
    };

    const scheduleApply = () => {
      if (frameHandle !== null) {
        return;
      }
      frameHandle = window.requestAnimationFrame(applyHeight);
    };

    applyHeight();
    window.addEventListener("resize", scheduleApply);
    window.addEventListener("orientationchange", scheduleApply);
    window.visualViewport?.addEventListener("resize", scheduleApply);

    return () => {
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
      }
      root.classList.remove(IOS_PWA_CLASS);
      root.style.removeProperty("--ios-app-height");
      window.removeEventListener("resize", scheduleApply);
      window.removeEventListener("orientationchange", scheduleApply);
      window.visualViewport?.removeEventListener("resize", scheduleApply);
    };
  }, []);
}
