import type { ProviderToolCall } from "@/lib/types";

const OPEN_TAG = "<tool_call";
const CLOSE_TAG = "</tool_call>";

function longestSuffixPrefix(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1);
  for (let len = max; len > 0; len -= 1) {
    if (marker.startsWith(text.slice(text.length - len))) {
      return len;
    }
  }
  return 0;
}

function coerceToolCallValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function parseToolCallTextBlock(body: string): { name: string; arguments: string } | null {
  if (!body || !body.trim()) {
    return null;
  }

  const funcMatch = body.match(/<function\s*=\s*([^>]*?)\s*>/i);
  if (funcMatch) {
    const name = funcMatch[1].trim();
    if (!name) {
      return null;
    }

    const paramRegex = /<parameter\s*=\s*([^>]*?)\s*>/gi;
    const markers: Array<{ name: string; start: number; valueStart: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = paramRegex.exec(body)) !== null) {
      const paramName = match[1].trim();
      if (!paramName) {
        continue;
      }
      markers.push({
        name: paramName,
        start: match.index,
        valueStart: match.index + match[0].length
      });
    }

    const args: Record<string, unknown> = {};
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const valueEnd = index + 1 < markers.length ? markers[index + 1].start : body.length;
      args[marker.name] = coerceToolCallValue(body.slice(marker.valueStart, valueEnd));
    }

    return { name, arguments: JSON.stringify(args) };
  }

  const jsonStart = body.search(/[{[]/);
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(body.slice(jsonStart).trim());
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.name === "string" &&
        parsed.name.trim()
      ) {
        const rawArguments = parsed.arguments ?? parsed.parameters ?? {};
        return {
          name: String(parsed.name).trim(),
          arguments: JSON.stringify(rawArguments)
        };
      }
    } catch {
      // not a JSON tool call; fall through
    }
  }

  return null;
}

export interface TextToolCallInterceptor {
  feed(text: string): string;
  flush(): string;
  readonly answer: string;
  readonly toolCalls: ProviderToolCall[];
}

export function createTextToolCallInterceptor(): TextToolCallInterceptor {
  let answer = "";
  let pending = "";
  let toolBody = "";
  let restoreBuffer = "";
  let inside = false;
  let needOpenClose = false;
  const toolCalls: ProviderToolCall[] = [];

  function commitToolBody() {
    const parsed = parseToolCallTextBlock(toolBody);
    if (parsed) {
      toolCalls.push({
        id: `text_call_${toolCalls.length}`,
        name: parsed.name,
        arguments: parsed.arguments
      });
    } else {
      restoreBuffer += `<tool_call>${toolBody}</tool_call>`;
    }
    toolBody = "";
  }

  function feed(text: string): string {
    pending += text;
    let emitted = "";

    let guard = 0;
    while (pending && guard++ < 10000) {
      if (needOpenClose) {
        const gt = pending.indexOf(">");
        if (gt === -1) {
          break;
        }
        pending = pending.slice(gt + 1);
        needOpenClose = false;
        inside = true;
        toolBody = "";
        continue;
      }

      if (inside) {
        const closeIdx = pending.indexOf(CLOSE_TAG);
        if (closeIdx === -1) {
          const hold = longestSuffixPrefix(pending, CLOSE_TAG);
          const safeLen = pending.length - hold;
          if (safeLen > 0) {
            toolBody += pending.slice(0, safeLen);
          }
          pending = hold ? pending.slice(safeLen) : "";
          break;
        }
        toolBody += pending.slice(0, closeIdx);
        pending = pending.slice(closeIdx + CLOSE_TAG.length);
        inside = false;
        commitToolBody();
        if (restoreBuffer) {
          emitted += restoreBuffer;
          restoreBuffer = "";
        }
        continue;
      }

      const openIdx = pending.indexOf(OPEN_TAG);
      if (openIdx === -1) {
        const hold = longestSuffixPrefix(pending, OPEN_TAG);
        const safeLen = pending.length - hold;
        if (safeLen > 0) {
          emitted += pending.slice(0, safeLen);
          pending = hold ? pending.slice(safeLen) : "";
        }
        break;
      }

      if (openIdx > 0) {
        emitted += pending.slice(0, openIdx);
      }
      pending = pending.slice(openIdx + OPEN_TAG.length);
      const gt = pending.indexOf(">");
      if (gt === -1) {
        needOpenClose = true;
        break;
      }
      pending = pending.slice(gt + 1);
      inside = true;
      toolBody = "";
    }

    answer += emitted;
    return emitted;
  }

  function flush(): string {
    let emitted = "";

    if (inside) {
      const parsed = parseToolCallTextBlock(toolBody);
      if (parsed) {
        toolCalls.push({
          id: `text_call_${toolCalls.length}`,
          name: parsed.name,
          arguments: parsed.arguments
        });
      } else {
        emitted += `<tool_call>${toolBody}`;
      }
      toolBody = "";
      pending = "";
      inside = false;
    } else if (needOpenClose) {
      emitted += `<tool_call${pending}`;
      pending = "";
      needOpenClose = false;
    } else if (pending) {
      emitted += pending;
      pending = "";
    }

    answer += emitted;
    return emitted;
  }

  return {
    feed,
    flush,
    get answer() {
      return answer;
    },
    get toolCalls() {
      return toolCalls;
    }
  };
}
