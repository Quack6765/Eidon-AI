import type { ChatStreamEvent } from "@/lib/types";

function shouldBufferForControlPrefix(answer: string, controlPrefixes: string[]) {
  const normalized = answer.trimStart();

  if (!normalized) {
    return true;
  }

  return controlPrefixes.some(
    (prefix) => prefix.startsWith(normalized) || normalized.startsWith(prefix)
  );
}

export function createGuardedAnswerEmitter(controlPrefixes: string[]) {
  let streamingUnlocked = false;
  let pendingTexts: string[] = [];

  return {
    push(text: string): ChatStreamEvent[] {
      if (!text) {
        return [];
      }

      if (streamingUnlocked) {
        return [{ type: "answer_delta", text }];
      }

      pendingTexts.push(text);

      if (shouldBufferForControlPrefix(pendingTexts.join(""), controlPrefixes)) {
        return [];
      }

      streamingUnlocked = true;
      const flushed = pendingTexts.map((pendingText) => ({
        type: "answer_delta" as const,
        text: pendingText
      }));
      pendingTexts = [];
      return flushed;
    },
    flush(): ChatStreamEvent[] {
      if (!pendingTexts.length) {
        return [];
      }

      streamingUnlocked = true;
      const flushed = pendingTexts.map((pendingText) => ({
        type: "answer_delta" as const,
        text: pendingText
      }));
      pendingTexts = [];
      return flushed;
    }
  };
}
