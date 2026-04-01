import type { ChatStreamEvent } from "@/lib/types";

function findEarliestControlPrefixIndex(buffer: string, controlPrefixes: string[]) {
  const indexes = controlPrefixes
    .map((prefix) => buffer.indexOf(prefix))
    .filter((index) => index >= 0);

  if (!indexes.length) {
    return -1;
  }

  return Math.min(...indexes);
}

function getBufferedSuffixLength(buffer: string, controlPrefixes: string[]) {
  if (!buffer.trim()) {
    return buffer.length;
  }

  let keepLength = 0;

  for (const prefix of controlPrefixes) {
    const maxLength = Math.min(prefix.length - 1, buffer.length);

    for (let length = maxLength; length > 0; length -= 1) {
      if (prefix.startsWith(buffer.slice(-length))) {
        keepLength = Math.max(keepLength, length);
        break;
      }
    }
  }

  return keepLength;
}

export function createGuardedAnswerEmitter(controlPrefixes: string[]) {
  let hiddenControlDetected = false;
  let pendingBuffer = "";

  return {
    push(text: string): ChatStreamEvent[] {
      if (!text || hiddenControlDetected) {
        return [];
      }

      pendingBuffer += text;

      const controlIndex = findEarliestControlPrefixIndex(pendingBuffer, controlPrefixes);

      if (controlIndex >= 0) {
        const visibleText = pendingBuffer.slice(0, controlIndex);
        pendingBuffer = pendingBuffer.slice(controlIndex);
        hiddenControlDetected = true;

        return visibleText ? [{ type: "answer_delta", text: visibleText }] : [];
      }

      const bufferedSuffixLength = getBufferedSuffixLength(pendingBuffer, controlPrefixes);

      if (bufferedSuffixLength >= pendingBuffer.length) {
        return [];
      }

      const visibleText = pendingBuffer.slice(0, pendingBuffer.length - bufferedSuffixLength);
      pendingBuffer = pendingBuffer.slice(pendingBuffer.length - bufferedSuffixLength);

      return visibleText ? [{ type: "answer_delta", text: visibleText }] : [];
    },
    flush(): ChatStreamEvent[] {
      if (!pendingBuffer.length || hiddenControlDetected) {
        return [];
      }

      const flushed = [{ type: "answer_delta" as const, text: pendingBuffer }];
      pendingBuffer = "";
      return flushed;
    }
  };
}
