const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

function longestSuffixPrefix(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1);
  for (let len = max; len > 0; len -= 1) {
    if (marker.startsWith(text.slice(text.length - len))) {
      return len;
    }
  }
  return 0;
}

export interface ThinkingDelimiterResult {
  answer: string;
  thinking: string;
}

export interface ThinkingDelimiterInterceptor {
  feed(text: string): ThinkingDelimiterResult;
  flush(): ThinkingDelimiterResult;
}

export function createThinkingDelimiterInterceptor(): ThinkingDelimiterInterceptor {
  let pending = "";
  let inside = false;

  function feed(text: string): ThinkingDelimiterResult {
    pending += text;
    let answer = "";
    let thinking = "";

    let guard = 0;
    while (pending && guard++ < 10000) {
      if (inside) {
        const closeIdx = pending.indexOf(THINK_CLOSE);
        if (closeIdx === -1) {
          const hold = longestSuffixPrefix(pending, THINK_CLOSE);
          const safeLen = pending.length - hold;
          if (safeLen > 0) {
            thinking += pending.slice(0, safeLen);
          }
          pending = hold ? pending.slice(safeLen) : "";
          break;
        }
        thinking += pending.slice(0, closeIdx);
        pending = pending.slice(closeIdx + THINK_CLOSE.length);
        inside = false;
        continue;
      }

      const openIdx = pending.indexOf(THINK_OPEN);
      if (openIdx === -1) {
        const hold = longestSuffixPrefix(pending, THINK_OPEN);
        const safeLen = pending.length - hold;
        if (safeLen > 0) {
          answer += pending.slice(0, safeLen);
        }
        pending = hold ? pending.slice(safeLen) : "";
        break;
      }

      if (openIdx > 0) {
        answer += pending.slice(0, openIdx);
      }
      pending = pending.slice(openIdx + THINK_OPEN.length);
      inside = true;
    }

    return { answer, thinking };
  }

  function flush(): ThinkingDelimiterResult {
    let answer = "";
    const thinking = "";

    if (inside) {
      pending = "";
      inside = false;
    } else if (pending) {
      answer = pending;
      pending = "";
    }

    return { answer, thinking };
  }

  return { feed, flush };
}

export function stripThinkingDelimiters(text: string): string {
  if (!text) {
    return text;
  }
  const interceptor = createThinkingDelimiterInterceptor();
  const { answer } = interceptor.feed(text);
  const tail = interceptor.flush();
  return `${answer}${tail.answer}`;
}
