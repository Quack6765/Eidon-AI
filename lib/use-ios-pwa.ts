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

    return () => {
      root.classList.remove(IOS_PWA_CLASS);
    };
  }, []);
}
