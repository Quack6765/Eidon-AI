export function countMarkerRuns(text: string, marker: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text.startsWith(marker, i)) {
      count++;
      i += marker.length;
      while (text.startsWith(marker, i)) i += marker.length;
    } else {
      i++;
    }
  }
  return count;
}

export function pipeDensity(text: string): number {
  if (!text) return 0;
  const pipes = (text.match(/\|/g) || []).length;
  return pipes / text.length;
}

const TERMINATORS = new Set([".", "!", "?"]);
export function endsWithSentenceTerminator(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  return TERMINATORS.has(trimmed[trimmed.length - 1]);
}
