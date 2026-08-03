export function longestMarkerPrefixAtSuffix(text: string, marker: string) {
  const max = Math.min(text.length, marker.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (marker.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}
