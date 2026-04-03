import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeLineBreaks(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/(?:\\\\)+r(?:\\\\)+n/g, "\n")
    .replace(/(?:\\\\)+n/g, "\n")
    .replace(/(?:\\\\)+r/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");
}

export function normalizeMarkdownLineBreaks(text: string) {
  return normalizeLineBreaks(text).replace(/\n{3,}/g, (match) => {
    const extras = match.length - 2;
    return "\n\n" + "\u00A0\n\n".repeat(extras);
  });
}

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
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
