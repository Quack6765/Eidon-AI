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
