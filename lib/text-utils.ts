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

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
