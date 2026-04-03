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
    <div className="flex rounded-2xl border border-white/6 overflow-hidden bg-white/[0.02] h-[calc(100dvh-6rem)]">
      {/* Left: List panel */}
      <div
        className={`w-full md:w-[280px] md:flex-shrink-0 md:border-r border-white/6 bg-[#0e0e0e] flex flex-col ${
          isDetailVisible ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="p-4 pb-2 flex items-center justify-between">
          {listHeader}
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-1">
          {listPanel}
        </div>
      </div>

      {/* Right: Detail panel */}
      <div
        className={`flex-1 overflow-y-auto bg-[#0a0a0a] ${
          isDetailVisible ? "flex flex-col" : "hidden md:flex md:flex-col"
        }`}
      >
        {/* Mobile back button */}
        <div className="md:hidden p-3 border-b border-white/6">
          <button
            onClick={onBackAction}
            className="flex items-center gap-1.5 text-[0.78rem] text-[#71717a] hover:text-[#f4f4f5] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to list
          </button>
        </div>
        <div className="p-6 md:p-8">
          {detailPanel}
        </div>
      </div>
    </div>
  );
}
