import type { ChatStreamEvent } from "@/lib/types";

const SSE_PRELUDE_PADDING = " ".repeat(2048);
const SSE_FLUSH_PADDING = " ".repeat(512);

export function encodeSseEvent(event: ChatStreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function encodeSsePrelude() {
  return `: ${SSE_PRELUDE_PADDING}\n\n`;
}

export function encodeSseFlushMarker() {
  return `: ${SSE_FLUSH_PADDING}\n\n`;
}
