"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function SettingsSplitPane({
  listPanel,
  detailPanel,
  isDetailVisible,
  onBackAction,
  listHeader,
}: {
  listPanel: ReactNode;
  detailPanel: ReactNode;
  isDetailVisible: boolean;
  onBackAction: () => void;
  listHeader: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col border border-white/6 bg-white/[0.02] md:h-[calc(100dvh-6rem)] md:flex-row md:overflow-hidden md:rounded-xl">
      <div
        className={`min-h-0 w-full border-b border-white/6 bg-[#0e0e0e] ${
          isDetailVisible ? "hidden md:flex" : "flex"
        } flex-col md:w-[280px] md:flex-shrink-0 md:border-b-0 md:border-r`}
      >
        <div className="flex items-center justify-between px-4 py-3 md:p-4 md:pb-2">
          {listHeader}
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-1">
          {listPanel}
        </div>
      </div>

      <div
        className={`min-h-0 flex-1 bg-[#0a0a0a] ${
          isDetailVisible ? "flex flex-col" : "hidden md:flex md:flex-col"
        }`}
      >
        <div className="md:hidden p-3 border-b border-white/6">
          <button
            onClick={onBackAction}
            className="flex items-center gap-1.5 text-[0.78rem] text-[#71717a] hover:text-[#f4f4f5] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to list
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 md:p-8">
          {detailPanel}
        </div>
      </div>
    </div>
  );
}
