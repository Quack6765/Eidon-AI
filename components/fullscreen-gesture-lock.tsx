"use client";

import { useEffect } from "react";

import { installFullscreenGestureLock } from "@/lib/fullscreen-gesture-lock";

export function FullscreenGestureLock() {
  useEffect(() => {
    installFullscreenGestureLock();
  }, []);

  return null;
}
