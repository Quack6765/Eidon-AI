"use client";

import { Globe, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";

const DEFAULT_WIDTH = 16;
const DEFAULT_HEIGHT = 9;
const HEADER_HEIGHT = "2rem";

export function ComputerLiveOverlay({
  container,
  frameUrl,
  viewport,
  url,
  onReturn,
  onDismiss
}: {
  container: HTMLElement | null;
  frameUrl: string | null;
  viewport: { width: number; height: number } | null;
  url: string | null;
  onReturn: () => void;
  onDismiss: () => void;
}) {
  if (!container) return null;

  const width = viewport?.width ?? DEFAULT_WIDTH;
  const height = viewport?.height ?? DEFAULT_HEIGHT;
  const card: CSSProperties = {
    width: `min(44vw, 260px, calc(26vh * ${width} / ${height}))`
  };

  return createPortal(
    <div
      className="absolute top-3 right-6 z-30 animate-fade-in pointer-coarse:right-4"
      data-testid="computer-live-overlay"
    >
      <div
        className="overflow-hidden rounded-xl border border-white/8 bg-black/40 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-colors duration-150 hover:border-white/16"
        style={card}
        data-testid="computer-live-overlay-card"
      >
        <div
          className="flex items-center gap-1.5 border-b border-white/6 bg-[#121214] pr-1 pl-2"
          style={{ height: HEADER_HEIGHT }}
          data-testid="computer-live-overlay-header"
        >
          <Globe className="h-3 w-3 shrink-0 text-indigo-300" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/88">Browser</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-300/90">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Live
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Hide the live browser tile for this run"
            title="Hide for this run"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 pointer-coarse:h-7 pointer-coarse:w-7"
            data-testid="computer-live-overlay-dismiss"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={onReturn}
          aria-label="Return to the live browser view"
          title={url ? `Return to the live browser view — ${url}` : "Return to the live browser view"}
          className="relative block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          style={{ aspectRatio: `${width} / ${height}` }}
          data-testid="computer-live-overlay-frame"
        >
          {frameUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Frames are in-memory blob URLs from the live browser stream that next/image cannot load.
            <img src={frameUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] text-white/40">
              Waiting for the browser…
            </span>
          )}
        </button>
      </div>
    </div>,
    container
  );
}
