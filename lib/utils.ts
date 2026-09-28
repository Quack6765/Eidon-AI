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
