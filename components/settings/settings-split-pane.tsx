"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function SettingsSplitPane({
  listPanel,
  detailPanel,
  isDetailVisible,
  onBackAction,
  listHeader,
  backLabel = "Settings",
  detailTitle,
  detailFooter,
}: {
  listPanel: ReactNode;
  detailPanel: ReactNode;
  isDetailVisible: boolean;
  onBackAction: () => void;
  listHeader: ReactNode;
  backLabel?: string;
  detailTitle?: string;
  detailFooter?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-white/[0.06] bg-white/[0.015] md:h-full md:flex-row">
      <div
        className={`min-h-0 w-full border-b border-white/[0.06] bg-[#0e0e0e] ${
          isDetailVisible ? "hidden md:flex" : "flex"
        } flex-1 flex-col md:w-[320px] md:flex-none md:border-b-0 md:border-r`}
      >
        <div className="flex min-h-[72px] items-center justify-between border-b border-white/[0.05] px-4 py-3 md:px-5">
          {listHeader}
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3 md:px-4">
          {listPanel}
        </div>
      </div>

      <div
        className={`min-h-0 min-w-0 flex-1 bg-[#0a0a0a] ${
          isDetailVisible ? "flex flex-col" : "hidden md:flex md:flex-col"
        }`}
      >
        <div className="grid min-h-[52px] grid-cols-[1fr_auto_1fr] items-center border-b border-white/[0.06] px-2 md:hidden">
          <button
            type="button"
            onClick={onBackAction}
            className="flex min-h-11 items-center gap-1.5 justify-self-start rounded-lg px-2 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-white/[0.04] hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45"
            aria-label={`Back to ${backLabel}`}
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </button>
          <span className="max-w-[42vw] truncate text-sm font-semibold text-[var(--text)]">
            {detailTitle}
          </span>
          <span />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 md:px-9 md:py-8">
          {detailPanel}
        </div>
        {detailFooter ? (
          <div className="border-t border-white/[0.07] bg-[#0c0c0c]/95 px-4 py-3 backdrop-blur-md sm:px-6 md:px-9">
            {detailFooter}
          </div>
        ) : null}
      </div>
    </div>
  );
}
