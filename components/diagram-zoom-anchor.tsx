"use client";

import { useEffect } from "react";

import { installDiagramZoomAnchor } from "@/lib/diagram-zoom-anchor";

export function DiagramZoomAnchor() {
  useEffect(() => {
    installDiagramZoomAnchor();
  }, []);

  return null;
}
