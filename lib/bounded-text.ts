export const TRUNCATION_MARKER = "\n...[truncated]";
export const MAX_RUNTIME_TOOL_RESULT_CHARS = 32_000;

export function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= TRUNCATION_MARKER.length) {
    return TRUNCATION_MARKER.slice(0, maxChars);
  }

  return `${value.slice(0, maxChars - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

export function appendBoundedText(current: string, chunk: string, maxChars: number) {
  if (current.length >= maxChars) {
    return { value: current, truncated: true };
  }

  const remaining = maxChars - current.length;
  return {
    value: current + chunk.slice(0, remaining),
    truncated: chunk.length > remaining
  };
}
