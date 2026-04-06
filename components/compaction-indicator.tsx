"use client";

import React from "react";

export function CompactionIndicator() {
  return (
    <div
      className="compaction-indicator flex w-full items-center gap-3 py-1.5"
      data-testid="compaction-indicator"
      aria-live="polite"
    >
      <span className="compaction-indicator__line" aria-hidden="true" />
      <span className="compaction-indicator__label">Compacting</span>
      <span className="compaction-indicator__line" aria-hidden="true" />
    </div>
  );
}