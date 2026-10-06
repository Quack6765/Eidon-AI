import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function shouldAutofocusTextInput() {
  if (typeof window === "undefined") {
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) {
    return false;
  }

  if (typeof window.matchMedia !== "function") {
    return true;
  }

  return !window.matchMedia("(pointer: coarse)").matches;
}

export function nowIso() {
  return new Date().toISOString();
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function formatDurationSeconds(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const AT_BOTTOM_TOLERANCE_PX = 8;

type ScrollGeometry = {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
};

export function isScrolledToBottom(element: ScrollGeometry) {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= AT_BOTTOM_TOLERANCE_PX;
}
