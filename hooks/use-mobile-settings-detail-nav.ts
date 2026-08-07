"use client";

import { useSyncExternalStore } from "react";

import {
  backMobileSettingsDetailNav,
  getMobileSettingsDetailNavSnapshot,
  subscribeMobileSettingsDetailNav
} from "@/lib/mobile-settings-detail-nav";

export function useMobileSettingsDetailNav() {
  const detail = useSyncExternalStore(
    subscribeMobileSettingsDetailNav,
    getMobileSettingsDetailNavSnapshot,
    getMobileSettingsDetailNavSnapshot
  );

  return { detail, back: backMobileSettingsDetailNav };
}
