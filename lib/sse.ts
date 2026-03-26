import type { ChatStreamEvent } from "@/lib/types";

export function encodeSseEvent(event: ChatStreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}
