"use client";

import { useEffect } from "react";

import { installPointerCaptureGuard } from "@/lib/pointer-capture-guard";

export function PointerCaptureGuard() {
  useEffect(() => {
    installPointerCaptureGuard();
  }, []);

  return null;
}
