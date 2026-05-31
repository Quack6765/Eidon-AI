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

    const applyHeight = () => {
      root.style.setProperty("--ios-app-height", `${window.innerHeight}px`);
    };

    applyHeight();
    window.addEventListener("resize", applyHeight);
    window.addEventListener("orientationchange", applyHeight);

    return () => {
      root.classList.remove(IOS_PWA_CLASS);
      root.style.removeProperty("--ios-app-height");
      window.removeEventListener("resize", applyHeight);
      window.removeEventListener("orientationchange", applyHeight);
    };
  }, []);
}
